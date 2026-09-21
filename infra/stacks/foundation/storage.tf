# =============================================================================
# storage.tf (foundation stack)
# -----------------------------------------------------------------------------
# The app's data: uploaded documents (container `documents`) and the Litestream
# replica of the SQLite database plus the single-writer lock blob (container
# `replica`). Entra-only: shared keys are off, so nothing in Terraform, the app
# or CI ever holds a storage key.
#
# Terraform only talks to the ARM control plane here (provider feature
# storage.data_plane_available = false, containers created by storage_account_id),
# so `plan`/`apply` from a GitHub runner work even with no public network path.
# =============================================================================

resource "azurerm_storage_account" "main" {
  name                = module.naming.storage_account
  location            = azurerm_resource_group.foundation.location
  resource_group_name = azurerm_resource_group.foundation.name

  account_tier             = "Standard"
  account_kind             = "StorageV2"
  account_replication_type = "GZRS"

  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true
  # Explicit on purpose: the provider default for this is true in 4.81.
  allow_nested_items_to_be_public   = false
  cross_tenant_replication_enabled  = false
  local_user_enabled                = false
  sftp_enabled                      = false
  infrastructure_encryption_enabled = true

  public_network_access_enabled = !var.private_networking

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 30
    }

    container_delete_retention_policy {
      days = 30
    }
  }

  # With private networking the only way in is the private endpoint. Without it,
  # the account is reachable publicly but every request still needs an Entra token.
  network_rules {
    default_action = var.private_networking ? "Deny" : "Allow"
    bypass         = ["AzureServices"]
  }

  tags = local.common_tags
}

# Containers are private and created through ARM (storage_account_id), never the data plane.
resource "azurerm_storage_container" "documents" {
  name                  = "documents"
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}

resource "azurerm_storage_container" "replica" {
  name                  = "replica"
  storage_account_id    = azurerm_storage_account.main.id
  container_access_type = "private"
}

locals {
  # ARM ids of the containers, used as role assignment scopes. Built from the account id
  # because azurerm_storage_container.resource_manager_id is deprecated in 4.81 (and `id`
  # is the data plane URL there). The container name reference keeps the ordering implicit.
  container_id_documents = "${azurerm_storage_account.main.id}/blobServices/default/containers/${azurerm_storage_container.documents.name}"
  container_id_replica   = "${azurerm_storage_account.main.id}/blobServices/default/containers/${azurerm_storage_container.replica.name}"
}

# Retention for noncurrent data. Versioning and soft delete keep 30 days of history; this
# policy removes old versions and snapshots after 30 days. There is deliberately no
# base_blob action: current blobs are never deleted or tiered by policy.
resource "azurerm_storage_management_policy" "main" {
  storage_account_id = azurerm_storage_account.main.id

  rule {
    name    = "expire-old-versions-and-snapshots"
    enabled = true

    filters {
      blob_types = ["blockBlob"]
    }

    actions {
      version {
        delete_after_days_since_creation = 30
      }
      snapshot {
        delete_after_days_since_creation_greater_than = 30
      }
    }
  }
}

resource "azurerm_private_endpoint" "blob" {
  count = var.private_networking ? 1 : 0

  name                = module.naming.private_endpoint_blob
  location            = azurerm_resource_group.foundation.location
  resource_group_name = azurerm_resource_group.foundation.name
  subnet_id           = azurerm_subnet.pe[0].id

  private_service_connection {
    name                           = "psc-blob"
    private_connection_resource_id = azurerm_storage_account.main.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.this["blob"].id]
  }

  tags = local.common_tags
}

# Blob service logs and transaction metrics to Log Analytics.
resource "azurerm_monitor_diagnostic_setting" "blob" {
  name                       = "to-log-analytics"
  target_resource_id         = "${azurerm_storage_account.main.id}/blobServices/default"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "StorageRead"
  }

  enabled_log {
    category = "StorageWrite"
  }

  enabled_log {
    category = "StorageDelete"
  }

  enabled_metric {
    category = "Transaction"
  }
}

# CanNotDelete lock. It depends on everything scoped under, or attached to, the account (containers,
# lifecycle policy, diagnostics, role assignments, the private endpoint connection): on destroy Terraform removes
# dependents first, so the lock is deleted before those children, and destroy-all
# is never blocked by a lock that is still in place.
resource "azurerm_management_lock" "storage" {
  count = var.enable_locks ? 1 : 0

  name       = module.naming.lock_storage
  scope      = azurerm_storage_account.main.id
  lock_level = "CanNotDelete"
  notes      = "Holds the app's documents and database replica. destroy-all removes this lock first."

  depends_on = [
    azurerm_storage_container.documents,
    azurerm_storage_container.replica,
    azurerm_storage_management_policy.main,
    azurerm_monitor_diagnostic_setting.blob,
    azurerm_private_endpoint.blob,
    azurerm_role_assignment.documents_blob_contributor,
    azurerm_role_assignment.replica_blob_contributor,
  ]
}
