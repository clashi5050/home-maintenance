# =============================================================================
# main.example.tfvars
# -----------------------------------------------------------------------------
# PLACEHOLDERS ONLY. This repository is public: never put real values here and never commit a copy
# of this file with real values. *.tfvars and *.auto.tfvars are git-ignored (only *.example.tfvars
# is allowed) for exactly that reason.
#
# In CI none of this file is used: every value arrives as a TF_VAR_* environment variable from GitHub
# variables and secrets (see the table in infra/README.md). This file is for running Terraform by hand:
#   cp infra/environments/main.example.tfvars infra/environments/main.tfvars   # git-ignored
#   (edit main.tfvars, then)  terraform -chdir=infra/stacks/foundation plan -var-file=../../environments/main.tfvars
# A variable that a stack does not declare is ignored with a warning, so one file serves both stacks.
# =============================================================================

# --- Azure auth (both stacks) -------------------------------------------------
arm_client_id       = "00000000-0000-0000-0000-000000000000"
arm_tenant_id       = "00000000-0000-0000-0000-000000000000"
arm_subscription_id = "00000000-0000-0000-0000-000000000000"

# --- Naming (both stacks; must be identical) -----------------------------------
# Names come out as <company_loc>-<app>-<type>-<environment>-<short_loc>, e.g. xxxx-homemaint-vnet-main-xxxx.
# The storage account and Key Vault names drop the hyphens and must fit in 24 characters in total.
company_loc = "xxxx"
short_loc   = "yyyy"
location    = "region-name"
# app         = "homemaint"   # default
# environment = "main"        # default

# --- Networking (both stacks; must be identical) --------------------------------
# private_networking = true   # default. false = no VNet/private endpoints (cheaper, publicly reachable data services)

# --- Foundation stack ------------------------------------------------------------
# enable_locks   = true       # default
# monthly_budget = 25         # default
alert_emails = ["alerts@example.invalid"]

# --- App stack ---------------------------------------------------------------------
image            = "ghcr.io/OWNER/home-maintenance@sha256:0000000000000000000000000000000000000000000000000000000000000000"
allowed_emails   = "person1@example.invalid,person2@example.invalid"
google_client_id = "0000000000-placeholder.apps.googleusercontent.com"
# google_secret_source         = "keyvault"   # default; "inline" is the fallback
# google_client_secret_kv_name = "google-client-secret"
# google_client_secret         = "..."        # only with google_secret_source = "inline"; never commit it

# --- Claude on Foundry (off by default; read the warning in infra/stacks/app/foundry.tf) ----------
# enable_claude = false
# When enable_claude = true these three are YOUR attestation to Anthropic's terms. There are no defaults.
# claude_organization_name = "Your organization's legal name"
# claude_country_code      = "XX"
# claude_industry          = "lower case industry value"
# claude_model_name        = "claude-opus-5"
# claude_model_version     = "1"      # UNVERIFIED for the Hosted-on-Azure variant, see README
# claude_capacity          = 25
