# =============================================================================
# variables.tf (app stack)
# -----------------------------------------------------------------------------
# No variable value is ever committed (the repo is public). Values arrive as
# TF_VAR_* environment variables from GitHub variables/secrets.
# The naming and private_networking values MUST equal the foundation stack's.
# =============================================================================

# --- OIDC / Azure auth ----------------------------------------------------------
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

# --- Naming (must match the foundation stack) -------------------------------------
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
  description = "Azure region (long form). Must be the foundation stack's region; the Foundry account also needs a region that hosts Claude."
  type        = string
}

variable "private_networking" {
  description = "Must equal the foundation stack's value. true: the Foundry account gets a private endpoint; false: public access with an IP allow list."
  type        = bool
  default     = true
}

# --- The app itself ----------------------------------------------------------------
variable "image" {
  description = "Container image, referenced by digest so a deploy is exactly one build: ghcr.io/<owner>/home-maintenance@sha256:<digest>."
  type        = string

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "image must be pinned by digest: <registry>/<name>@sha256:<64 hex characters>."
  }
}

variable "allowed_emails" {
  description = "Comma-separated list of Google accounts allowed in (ALLOWED_EMAILS). With no list, nobody gets in."
  type        = string
  sensitive   = true
}

variable "google_client_id" {
  description = "Google OAuth client id for built-in sign-in. Not a secret (it is visible in the login redirect)."
  type        = string
}

variable "google_secret_source" {
  description = <<-EOT
    Where the Google client secret comes from.
    keyvault (default): a Container App secret that references the Key Vault secret named by
      google_client_secret_kv_name, read with the app's managed identity.
      UNVERIFIED over a private endpoint: smoke-test after the first apply (see infra/README.md).
    inline (fallback): the value of var.google_client_secret is stored as a Container App secret.
      It ends up in Terraform state, which is why it is not the default.
  EOT
  type        = string
  default     = "keyvault"

  validation {
    condition     = contains(["keyvault", "inline"], var.google_secret_source)
    error_message = "google_secret_source must be \"keyvault\" or \"inline\"."
  }
}

variable "google_client_secret_kv_name" {
  description = "Name of the Key Vault secret holding the Google client secret (used when google_secret_source = keyvault)."
  type        = string
  default     = "google-client-secret"
}

variable "google_client_secret" {
  description = "Google client secret (used only when google_secret_source = inline)."
  type        = string
  sensitive   = true
  default     = ""
}

variable "enable_app_insights_env" {
  description = "Pass APPLICATIONINSIGHTS_CONNECTION_STRING (from the foundation stack's Application Insights) to the app."
  type        = bool
  default     = false
}

# --- Alerting -----------------------------------------------------------------------
variable "alert_emails" {
  description = "Addresses the alert action group emails. Sensitive so they never appear in plan output on a public repo."
  type        = list(string)
  sensitive   = true

  validation {
    condition     = length(var.alert_emails) > 0
    error_message = "Provide at least one alert email address."
  }
}

# --- Claude on Foundry (all optional, all off by default) ------------------------------
variable "enable_claude" {
  description = "Create the Foundry (AIServices) account and the Claude deployment. Off by default: deploying accepts Anthropic's Marketplace terms on your behalf."
  type        = bool
  default     = false
}

# These three are a legal attestation, not configuration. They are accepted as the
# account holder's own answers when Anthropic's Marketplace terms are accepted by the
# deployment, so there is deliberately NO meaningful default and nothing is ever
# invented: they must come from you. (default = null only makes them optional while
# enable_claude is false; a precondition rejects null/empty when it is true.)
variable "claude_organization_name" {
  description = "Legal name of the organization accepting Anthropic's terms (modelProviderData.organizationName). Required when enable_claude is true."
  type        = string
  default     = null
}

variable "claude_country_code" {
  description = "Two-letter ISO country code of that organization (modelProviderData.countryCode). Required when enable_claude is true."
  type        = string
  default     = null

  validation {
    condition     = var.claude_country_code == null || var.claude_country_code == "" || can(regex("^[A-Z]{2}$", var.claude_country_code))
    error_message = "claude_country_code must be a two-letter upper-case ISO country code such as US."
  }
}

variable "claude_industry" {
  description = "Industry of that organization, lower case as in the Foundry portal dropdown (modelProviderData.industry). Required when enable_claude is true."
  type        = string
  default     = null

  validation {
    condition     = var.claude_industry == null || can(regex("^[^A-Z]*$", var.claude_industry))
    error_message = "claude_industry must be lower case (it has to match the Foundry portal's dropdown values)."
  }
}

variable "claude_model_name" {
  description = "Claude model to deploy. Also used as the deployment name."
  type        = string
  default     = "claude-opus-5"
}

variable "claude_model_version" {
  description = <<-EOT
    Model version string. UNVERIFIED: the value that selects the Hosted-on-Azure variant of the model
    could not be confirmed. "1" is what the Azure-Samples/claude sample uses. If the apply is rejected,
    list the live catalog (Get-ClaudeCatalog.ps1 in that sample) and set the right version here.
  EOT
  type        = string
  default     = "1"
}

variable "claude_capacity" {
  description = "Deployment capacity in thousands of tokens per minute (25 = 25K TPM). Lower it if the subscription quota is smaller."
  type        = number
  default     = 25
}

variable "ai_allowed_ip_ranges" {
  description = "Public IPs/CIDRs allowed to reach the Foundry account. Only relevant when private_networking is false; otherwise access is through the private endpoint."
  type        = list(string)
  default     = []
}
