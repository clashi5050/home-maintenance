# =============================================================================
# versions.tf (app stack)
# -----------------------------------------------------------------------------
# Provider pins, remote-state backend and provider configuration. Same partial
# backend pattern as the foundation stack, with its own state key:
#   terraform init -backend-config=backend.hcl \
#     -backend-config="key=${environment}-${short_loc}-${app}-app.tfstate" \
#     -backend-config="subscription_id=${TFSTATE_SUBSCRIPTION_ID}"
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.81"
    }
    azapi = {
      source  = "Azure/azapi"
      version = "~> 2.12"
    }
  }

  backend "azurerm" {
    use_oidc = true
  }
}

provider "azurerm" {
  # See the foundation stack for why each feature flag is set. cognitive_account
  # purge_soft_delete_on_destroy = true matters here: a destroyed Foundry account
  # would otherwise sit soft-deleted, holding its custom subdomain and model quota,
  # and block the next apply of destroy-app -> apply.
  features {
    storage {
      data_plane_available = false
    }
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
    cognitive_account {
      purge_soft_delete_on_destroy = true
    }
  }

  use_oidc        = true
  client_id       = var.arm_client_id
  tenant_id       = var.arm_tenant_id
  subscription_id = var.arm_subscription_id

  resource_provider_registrations = "none"
}

provider "azapi" {
  use_oidc        = true
  client_id       = var.arm_client_id
  tenant_id       = var.arm_tenant_id
  subscription_id = var.arm_subscription_id
}
