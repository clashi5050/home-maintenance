# =============================================================================
# outputs.tf (app stack)
# -----------------------------------------------------------------------------
# Nothing sensitive is output.
# =============================================================================

output "resource_group_name" {
  description = "App resource group."
  value       = azurerm_resource_group.app.name
}

output "container_app_name" {
  description = "Container App name."
  value       = azurerm_container_app.app.name
}

output "container_app_fqdn" {
  description = "Public hostname of the app. Add https://<this>/.auth/login/google/callback as a redirect URI on the Google OAuth client."
  value       = azurerm_container_app.app.ingress[0].fqdn
}

output "google_redirect_uri" {
  description = "Redirect URI to register with the Google OAuth client."
  value       = "https://${azurerm_container_app.app.ingress[0].fqdn}/.auth/login/google/callback"
}

output "foundry_endpoint" {
  description = "Endpoint of the Foundry account (null unless enable_claude)."
  value       = var.enable_claude ? azurerm_cognitive_account.foundry[0].endpoint : null
}

output "claude_deployment_name" {
  description = "Name of the Claude deployment (null unless enable_claude)."
  value       = var.enable_claude ? azapi_resource.claude[0].name : null
}
