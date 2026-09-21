# =============================================================================
# versions.tf (foundation stack)
# -----------------------------------------------------------------------------
# Provider pins, remote-state backend and provider configuration.
#
# Backend: partial configuration. Storage account/container/resource group are
# fixed in backend.hcl (committed). `key` and `subscription_id` still vary per
# invocation and are passed at init time, NOT committed (this repo is public and
# the state subscription id is treated as sensitive):
#   terraform init -backend-config=backend.hcl \
#     -backend-config="key=${environment}-${short_loc}-${app}-foundation.tfstate" \
#     -backend-config="subscription_id=${TFSTATE_SUBSCRIPTION_ID}"
# Auth is OIDC only; ARM_CLIENT_ID / ARM_TENANT_ID / ARM_USE_OIDC come from the
# workflow environment.
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 5.6"
    }
  }

  backend "azurerm" {
    use_oidc = true
  }
}

provider "azurerm" {
  # data_plane_available = false: the storage account has shared-key access
  # switched off and (by default) no public network path, so Terraform must only
  # ever use the ARM control plane. Containers are created with storage_account_id
  # for the same reason.
  # purge_soft_delete_on_destroy = false / recover_soft_deleted_key_vaults = true:
  # the vault has purge protection, so a destroyed vault is recovered, not purged,
  # when the stack is applied again.
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
    # Beyond the brief: without this a destroyed workspace stays soft-deleted for 14 days and its
    # name cannot be reused, which would make destroy-all -> apply fail. destroy-all is deliberate.
    log_analytics_workspace {
      permanently_delete_on_destroy = true
    }
  }

  use_oidc        = true
  client_id       = var.arm_client_id
  tenant_id       = var.arm_tenant_id
  subscription_id = var.arm_subscription_id

  # Resource providers are registered once by hand (see infra/README.md); the
  # deploy identity is not given permission to register them.
  resource_provider_registrations = "none"
}
