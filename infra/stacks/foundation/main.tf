# =============================================================================
# main.tf (foundation stack)
# -----------------------------------------------------------------------------
# Long-lived resources: identity, network, storage (the data), Key Vault,
# monitoring, the Container Apps environment and the budget. Rarely destroyed.
# The app stack (infra/stacks/app) sits on top and can be destroyed and rebuilt
# at any time without touching anything here; the data lives in this stack.
#
# Files: network.tf, storage.tf, keyvault.tf, monitoring.tf, aca_env.tf,
# rbac.tf, budget.tf, outputs.tf.
# =============================================================================

module "naming" {
  source = "../../modules/naming"

  company_loc = var.company_loc
  app         = var.app
  environment = var.environment
  short_loc   = var.short_loc
}

locals {
  # Tag standard: environment, app, managed-by, repo, pattern.
  common_tags = {
    environment = var.environment
    app         = var.app
    managed-by  = "terraform"
    repo        = "home-maintenance"
    pattern     = "container-app-foundation"
  }
}

# -----------------------------------------------------------------------------
# Resource group: rg-<company_loc>-<app>-<environment>-<short_loc>
# -----------------------------------------------------------------------------
resource "azurerm_resource_group" "foundation" {
  name     = module.naming.resource_group_foundation
  location = var.location
  tags     = local.common_tags
}

# -----------------------------------------------------------------------------
# User-assigned managed identity for the app. It lives here, not in the app
# stack, so its role assignments survive an app-stack destroy/rebuild and the
# principal id never changes.
# -----------------------------------------------------------------------------
resource "azurerm_user_assigned_identity" "app" {
  name                = module.naming.identity
  location            = azurerm_resource_group.foundation.location
  resource_group_name = azurerm_resource_group.foundation.name
  tags                = local.common_tags
}
