# =============================================================================
# variables.tf (foundation stack)
# -----------------------------------------------------------------------------
# No variable value is ever committed (the repo is public). Every value arrives
# as a TF_VAR_* environment variable from GitHub variables/secrets; see
# infra/README.md and infra/environments/main.example.tfvars for the list.
# =============================================================================

# --- OIDC / Azure auth (GitHub *variables*; harmless without a federated credential)
variable "arm_client_id" {
  description = "Azure AD application (client) ID used for OIDC auth."
  type        = string
}

variable "arm_tenant_id" {
  description = "Azure AD tenant ID."
  type        = string
}

variable "arm_subscription_id" {
  description = "Azure subscription ID to deploy into."
  type        = string
}

# --- Naming (see modules/naming) ----------------------------------------------
variable "company_loc" {
  description = "Company/location short code used in resource naming."
  type        = string
}

variable "app" {
  description = "Application short name used in resource naming."
  type        = string
  default     = "homemaint"
}

variable "environment" {
  description = "Deployment environment used in resource naming."
  type        = string
  default     = "main"
}

variable "short_loc" {
  description = "Short region code used in naming (e.g. use2)."
  type        = string
}

variable "location" {
  description = "Azure region (long form, e.g. eastus2). Must support GZRS and Container Apps workload profiles."
  type        = string
}

# --- Networking ---------------------------------------------------------------
variable "private_networking" {
  description = <<-EOT
    true (default): VNet, private endpoints and private DNS zones; storage and Key Vault have no public network
    path. false: no VNet or private endpoints and the data services accept public connections (still Entra-only
    auth). Private endpoints cost roughly USD 7 per month each, which is a large share of a small budget.
  EOT
  type        = bool
  default     = true
}

variable "vnet_address_space" {
  description = "Address space of the VNet (only used when private_networking is true)."
  type        = list(string)
  default     = ["10.42.0.0/24"]
}

variable "aca_subnet_prefix" {
  description = "Subnet for the Container Apps environment, delegated to Microsoft.App/environments (/27 is the minimum for workload profiles)."
  type        = string
  default     = "10.42.0.0/27"
}

variable "pe_subnet_prefix" {
  description = "Subnet for private endpoints."
  type        = string
  default     = "10.42.0.32/27"
}

# --- Protection, cost and alerting ---------------------------------------------
variable "enable_locks" {
  description = "Put CanNotDelete locks on the storage account and Key Vault. destroy-all removes them first, in dependency order."
  type        = bool
  default     = true
}

variable "monthly_budget" {
  description = "Monthly budget in the billing currency for the three resource groups this project owns (foundation, app and the platform-managed Container Apps group). Alerts at 50%, 80% and 100% (forecast and actual)."
  type        = number
  default     = 75
}

variable "alert_emails" {
  description = "Addresses that receive budget notifications. Sensitive so they never appear in plan output on a public repo."
  type        = list(string)
  sensitive   = true

  validation {
    condition     = length(var.alert_emails) > 0
    error_message = "Provide at least one alert email address."
  }
}
