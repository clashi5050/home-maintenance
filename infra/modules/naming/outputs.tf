# =============================================================================
# outputs.tf (naming module)
# -----------------------------------------------------------------------------
# The length limits are enforced as output preconditions rather than by silently
# truncating: a truncated name could collide with a different deployment's, and
# storage account / Key Vault names are globally unique.
# =============================================================================

output "base" {
  description = "<company_loc>-<app>-<environment>-<short_loc>, the stem of the resource group names."
  value       = local.base
}

# --- Resource groups ---------------------------------------------------------
output "resource_group_foundation" {
  description = "Foundation resource group (long-lived)."
  value       = "rg-${local.base}"
}

output "resource_group_app" {
  description = "App resource group (safe to destroy and rebuild)."
  value       = "rg-${local.base}-app"
}

output "resource_group_aca_infra" {
  description = "Platform-managed resource group the Container Apps environment creates for its own infrastructure."
  value       = "rg-${local.base}-acainfra"
}

# --- Foundation resources ----------------------------------------------------
output "identity" {
  description = "User-assigned managed identity used by the app."
  value       = local.n["id"]
}

output "vnet" {
  description = "Virtual network."
  value       = local.n["vnet"]
}

output "log_analytics" {
  description = "Log Analytics workspace."
  value       = local.n["law"]
}

output "app_insights" {
  description = "Workspace-based Application Insights."
  value       = local.n["appi"]
}

output "container_app_environment" {
  description = "Container Apps environment."
  value       = local.n["cae"]
}

output "storage_account" {
  description = "Storage account (3-24 lower-case alphanumeric)."
  value       = local.storage_account

  precondition {
    condition     = length(local.storage_account) <= 24
    error_message = "The storage account name would be longer than 24 characters. Shorten company_loc, app, environment or short_loc."
  }
}

output "key_vault" {
  description = "Key Vault (3-24 characters)."
  value       = local.key_vault

  precondition {
    condition     = length(local.key_vault) <= 24
    error_message = "The Key Vault name would be longer than 24 characters. Shorten company_loc, app, environment or short_loc."
  }
}

output "private_endpoint_blob" {
  description = "Private endpoint for blob storage."
  value       = local.n["pep-blob"]
}

output "private_endpoint_vault" {
  description = "Private endpoint for Key Vault."
  value       = local.n["pep-vault"]
}

output "lock_storage" {
  description = "Delete lock on the storage account."
  value       = local.n["lock-st"]
}

output "lock_key_vault" {
  description = "Delete lock on the Key Vault."
  value       = local.n["lock-kv"]
}

output "budget" {
  description = "Consumption budget."
  value       = local.n["bud"]
}

# --- App resources -----------------------------------------------------------
output "container_app" {
  description = "Container App (2-32 characters, lower-case letters, digits and hyphens)."
  value       = local.n["ca"]

  precondition {
    condition     = length(local.n["ca"]) <= 32
    error_message = "The Container App name would be longer than 32 characters. Shorten company_loc, app, environment or short_loc."
  }
}

output "ai_account" {
  description = "Foundry (AIServices) account name. Also used as the custom subdomain, which must be globally unique."
  value       = local.n["ai"]
}

output "private_endpoint_ai" {
  description = "Private endpoint for the Foundry account."
  value       = local.n["pep-ai"]
}

output "action_group" {
  description = "Monitor action group that emails the alert recipients."
  value       = local.n["ag"]
}
