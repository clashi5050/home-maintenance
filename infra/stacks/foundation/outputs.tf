# =============================================================================
# outputs.tf (foundation stack)
# -----------------------------------------------------------------------------
# The app stack does NOT read these (no remote-state coupling): it rebuilds the
# same names from modules/naming and looks the identity up by name. They exist
# for the owner and for the runbook. Nothing sensitive is output.
# =============================================================================

output "resource_group_name" {
  description = "Foundation resource group."
  value       = azurerm_resource_group.foundation.name
}

output "identity_name" {
  description = "App user-assigned managed identity."
  value       = azurerm_user_assigned_identity.app.name
}

output "identity_client_id" {
  description = "Client id of the app identity (AZURE_CLIENT_ID for DefaultAzureCredential)."
  value       = azurerm_user_assigned_identity.app.client_id
}

output "storage_account_name" {
  description = "Storage account holding documents and the database replica."
  value       = azurerm_storage_account.main.name
}

output "key_vault_name" {
  description = "Key Vault name; add secrets over ARM (see README)."
  value       = azurerm_key_vault.main.name
}

output "key_vault_id" {
  description = "Key Vault resource id."
  value       = azurerm_key_vault.main.id
}

output "log_analytics_workspace_name" {
  description = "Log Analytics workspace."
  value       = azurerm_log_analytics_workspace.main.name
}

output "container_app_environment_name" {
  description = "Container Apps environment the app stack deploys into."
  value       = azurerm_container_app_environment.main.name
}

output "container_app_environment_default_domain" {
  description = "Default domain of the environment (the app's URL is <app>.<this>)."
  value       = azurerm_container_app_environment.main.default_domain
}

output "private_networking" {
  description = "Whether the VNet, private endpoints and private DNS zones exist. The app stack must be given the same value."
  value       = var.private_networking
}
