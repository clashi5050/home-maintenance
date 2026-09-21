# =============================================================================
# main.tf (app stack)
# -----------------------------------------------------------------------------
# The rebuildable half: the Container App, its sign-in configuration, the
# optional Foundry account for Claude, and the alerts. It is safe to destroy at
# any time (destroy-app.yml is also the emergency cost stop): all data lives in
# the foundation stack's storage account and survives.
#
# There is no remote-state coupling. Names come from modules/naming (same four
# inputs as the foundation stack); the identity, environment, workspace and DNS
# zones are looked up by name below, which also makes this stack fail early and
# clearly if the foundation stack has not been applied.
#
# Files: container_app.tf, auth.tf, foundry.tf, alerts.tf, outputs.tf.
# =============================================================================

module "naming" {
  source = "../../modules/naming"

  company_loc = var.company_loc
  app         = var.app
  environment = var.environment
  short_loc   = var.short_loc
}

locals {
  common_tags = {
    environment = var.environment
    app         = var.app
    managed-by  = "terraform"
    repo        = "home-maintenance"
    pattern     = "container-app-app"
  }

  foundation_rg = module.naming.resource_group_foundation
}

resource "azurerm_resource_group" "app" {
  name     = module.naming.resource_group_app
  location = var.location
  tags     = local.common_tags
}

# -----------------------------------------------------------------------------
# Foundation lookups (read-only)
# -----------------------------------------------------------------------------
data "azurerm_user_assigned_identity" "app" {
  name                = module.naming.identity
  resource_group_name = local.foundation_rg
}

data "azurerm_container_app_environment" "main" {
  name                = module.naming.container_app_environment
  resource_group_name = local.foundation_rg
}

data "azurerm_log_analytics_workspace" "main" {
  name                = module.naming.log_analytics
  resource_group_name = local.foundation_rg
}

data "azurerm_application_insights" "main" {
  count = var.enable_app_insights_env ? 1 : 0

  name                = module.naming.app_insights
  resource_group_name = local.foundation_rg
}

# The Key Vault private endpoint is owned by the foundation stack. Reading it here makes the
# Key Vault secret reference below depend on it existing (and gives a clear error if not).
data "azurerm_private_endpoint_connection" "key_vault" {
  count = var.private_networking ? 1 : 0

  name                = module.naming.private_endpoint_vault
  resource_group_name = local.foundation_rg
}

# Only needed for the Foundry account's private endpoint.
data "azurerm_subnet" "pe" {
  count = var.private_networking && var.enable_claude ? 1 : 0

  name                 = "pe"
  virtual_network_name = module.naming.vnet
  resource_group_name  = local.foundation_rg
}

data "azurerm_private_dns_zone" "cognitiveservices" {
  count = var.private_networking && var.enable_claude ? 1 : 0

  name                = "privatelink.cognitiveservices.azure.com"
  resource_group_name = local.foundation_rg
}

data "azurerm_private_dns_zone" "aiservices" {
  count = var.private_networking && var.enable_claude ? 1 : 0

  name                = "privatelink.services.ai.azure.com"
  resource_group_name = local.foundation_rg
}
