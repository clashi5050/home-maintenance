# =============================================================================
# keyvault.tf (foundation stack)
# -----------------------------------------------------------------------------
# Key Vault for the two secrets the app platform needs (see infra/README.md):
#   - google-client-secret   Google OAuth client secret used by built-in sign-in
#   - (optional) others the owner adds later
# Terraform NEVER creates secrets: that is a data-plane operation, and secret
# values would end up in state. The owner adds them over the ARM control plane
# (README, "Adding Key Vault secrets"). Authorization is RBAC only; the app
# identity gets Key Vault Secrets User in rbac.tf.
# =============================================================================

resource "azurerm_key_vault" "main" {
  name                = module.naming.key_vault
  location            = azurerm_resource_group.foundation.location
  resource_group_name = azurerm_resource_group.foundation.name
  tenant_id           = var.arm_tenant_id
  sku_name            = "standard"

  rbac_authorization_enabled = true
  purge_protection_enabled   = true
  soft_delete_retention_days = 90

  public_network_access_enabled = !var.private_networking

  network_acls {
    default_action = var.private_networking ? "Deny" : "Allow"
    bypass         = "AzureServices"
  }

  tags = local.common_tags
}

resource "azurerm_private_endpoint" "vault" {
  count = var.private_networking ? 1 : 0

  name                = module.naming.private_endpoint_vault
  location            = azurerm_resource_group.foundation.location
  resource_group_name = azurerm_resource_group.foundation.name
  subnet_id           = azurerm_subnet.pe[0].id

  private_service_connection {
    name                           = "psc-vault"
    private_connection_resource_id = azurerm_key_vault.main.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.this["vault"].id]
  }

  tags = local.common_tags
}

resource "azurerm_monitor_diagnostic_setting" "key_vault" {
  name                       = "to-log-analytics"
  target_resource_id         = azurerm_key_vault.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "AuditEvent"
  }
}

# Same lock/ordering reasoning as the storage account lock.
resource "azurerm_management_lock" "key_vault" {
  count = var.enable_locks ? 1 : 0

  name       = module.naming.lock_key_vault
  scope      = azurerm_key_vault.main.id
  lock_level = "CanNotDelete"
  notes      = "Holds the app's sign-in secret. destroy-all removes this lock first."

  depends_on = [
    azurerm_monitor_diagnostic_setting.key_vault,
    azurerm_private_endpoint.vault,
    azurerm_role_assignment.key_vault_secrets_user,
  ]
}
