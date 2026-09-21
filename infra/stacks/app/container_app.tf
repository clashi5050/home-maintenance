# =============================================================================
# container_app.tf (app stack)
# -----------------------------------------------------------------------------
# The single-replica web app.
#
# SINGLE WRITER: the app keeps SQLite on ephemeral disk and Litestream copies it
# to Blob Storage, with a blob lease as the single-writer lock. min_replicas =
# max_replicas = 1 and revision_mode = Single: never scale this out. (During a
# deploy Azure briefly runs the old and new revision together; server/bootstrap.js
# makes the new one wait for the lock, which is why the pod may take a while to
# start serving.)
#
# No registry block: the GHCR image is public and referenced by digest.
# No volumes: ephemeral disk only; durability comes from Litestream + Blob.
# =============================================================================

locals {
  identity_id = data.azurerm_user_assigned_identity.app.id

  # https://<vault>.vault.azure.net/secrets/<name>  (no version: always the latest)
  google_secret_kv_url = "https://${module.naming.key_vault}.vault.azure.net/secrets/${var.google_client_secret_kv_name}"
}

resource "azurerm_container_app" "app" {
  name                         = module.naming.container_app
  resource_group_name          = azurerm_resource_group.app.name
  container_app_environment_id = data.azurerm_container_app_environment.main.id
  workload_profile_name        = "Consumption"
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [local.identity_id]
  }

  # --- Secrets -----------------------------------------------------------------
  secret {
    name  = "allowed-emails"
    value = var.allowed_emails
  }

  # The Google client secret: from Key Vault (default) ...
  dynamic "secret" {
    for_each = var.google_secret_source == "keyvault" ? [1] : []

    content {
      name                = "google-client-secret"
      key_vault_secret_id = local.google_secret_kv_url
      identity            = local.identity_id
    }
  }

  # ... or inline (fallback; the value then lives in Terraform state).
  dynamic "secret" {
    for_each = var.google_secret_source == "inline" ? [1] : []

    content {
      name  = "google-client-secret"
      value = var.google_client_secret
    }
  }

  dynamic "secret" {
    for_each = var.enable_app_insights_env ? [1] : []

    content {
      name  = "appinsights-connection-string"
      value = data.azurerm_application_insights.main[0].connection_string
    }
  }

  # --- Ingress: public, protected by built-in sign-in (auth.tf) ------------------
  ingress {
    external_enabled           = true
    target_port                = 8080
    allow_insecure_connections = false

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 1
    max_replicas = 1

    # Time for bootstrap.js to stop the app, take a last Litestream copy and release the lock.
    termination_grace_period_seconds = 60

    container {
      name   = "app"
      image  = var.image
      cpu    = 0.5
      memory = "1Gi"

      command = ["node", "--disable-warning=ExperimentalWarning", "server/bootstrap.js"]

      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name  = "DATA_DIR"
        value = "/data"
      }
      env {
        name  = "TZ"
        value = "America/New_York"
      }
      env {
        name  = "SEED"
        value = "false"
      }

      # Sign-in is done by the platform (auth.tf); the app trusts its X-MS-CLIENT-PRINCIPAL headers.
      env {
        name  = "AUTH_MODE"
        value = "easyauth"
      }
      env {
        name        = "ALLOWED_EMAILS"
        secret_name = "allowed-emails"
      }

      # Documents in Blob Storage, reached with the managed identity (no keys).
      env {
        name  = "STORAGE_BACKEND"
        value = "azure-blob"
      }
      env {
        name  = "AZURE_STORAGE_ACCOUNT"
        value = module.naming.storage_account
      }
      env {
        name  = "AZURE_STORAGE_CONTAINER"
        value = "documents"
      }
      # DefaultAzureCredential needs this to pick the user-assigned identity.
      env {
        name  = "AZURE_CLIENT_ID"
        value = data.azurerm_user_assigned_identity.app.client_id
      }

      # SQLite replica + writer lock.
      env {
        name  = "LITESTREAM_ENABLED"
        value = "true"
      }
      env {
        name  = "LITESTREAM_CONTAINER"
        value = "replica"
      }
      env {
        name  = "LITESTREAM_ACCOUNT"
        value = module.naming.storage_account
      }

      dynamic "env" {
        for_each = var.enable_app_insights_env ? [1] : []

        content {
          name        = "APPLICATIONINSIGHTS_CONNECTION_STRING"
          secret_name = "appinsights-connection-string"
        }
      }

      # /healthz is answered by bootstrap.js while it waits for the writer lock and restores the
      # database, then by the app itself, so the same probe covers both phases.
      startup_probe {
        transport               = "HTTP"
        port                    = 8080
        path                    = "/healthz"
        interval_seconds        = 10
        timeout                 = 5
        failure_count_threshold = 10
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 8080
        path                    = "/healthz"
        interval_seconds        = 30
        timeout                 = 5
        failure_count_threshold = 3
      }

      readiness_probe {
        transport               = "HTTP"
        port                    = 8080
        path                    = "/healthz"
        interval_seconds        = 10
        timeout                 = 5
        failure_count_threshold = 3
        success_count_threshold = 1
      }
    }
  }

  tags = local.common_tags

  # The Key Vault secret reference needs the vault reachable through its private endpoint
  # (created by the foundation stack). UNVERIFIED end to end: smoke-test after the first apply.
  depends_on = [data.azurerm_private_endpoint_connection.key_vault]
}

# Container app metrics (replica count, restarts, requests) to Log Analytics.
# The container app itself supports metrics only; logs are on the environment (foundation stack).
resource "azurerm_monitor_diagnostic_setting" "container_app" {
  name                       = "to-log-analytics"
  target_resource_id         = azurerm_container_app.app.id
  log_analytics_workspace_id = data.azurerm_log_analytics_workspace.main.id

  enabled_metric {
    category = "AllMetrics"
  }
}
