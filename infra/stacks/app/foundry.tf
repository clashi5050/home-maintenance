# =============================================================================
# foundry.tf (app stack)
# -----------------------------------------------------------------------------
# Optional: a Microsoft Foundry (AIServices) account and a Claude deployment for
# the app's assistant. EVERYTHING here is behind var.enable_claude (default false).
#
# READ THIS BEFORE TURNING IT ON
#   Creating the deployment accepts Anthropic's Marketplace terms on your behalf
#   (https://www.anthropic.com/legal/commercial-terms). The three modelProviderData
#   values (organization name, country, industry) are your own attestation to
#   those terms. They have no defaults and are never invented: they come only from
#   claude_organization_name / claude_country_code / claude_industry, and a
#   precondition stops the apply if any is missing.
#
# Entra only: local (key) auth is disabled, the app identity gets Cognitive
# Services User and calls the account with a token. Note that server/assistant.js
# currently authenticates with ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN only, so the
# app code needs a change before it can use this account; that is outside this
# stack (see infra/README.md).
#
# Why azapi for the deployment: azurerm_cognitive_deployment cannot send
# modelProviderData (hashicorp/terraform-provider-azurerm issue 31140), so this
# follows the Azure-Samples/claude infra-terraform sample: type ...deployments,
# sku GlobalStandard, schema validation off so modelProviderData is accepted.
# =============================================================================

locals {
  claude_org_ok      = trimspace(coalesce(var.claude_organization_name, "")) != ""
  claude_country_ok  = trimspace(coalesce(var.claude_country_code, "")) != ""
  claude_industry_ok = trimspace(coalesce(var.claude_industry, "")) != ""

  # Preview API version taken from the Azure-Samples/claude sample, which is what accepts
  # modelProviderData. Not verified against the REST reference here.
  claude_deployment_api = "Microsoft.CognitiveServices/accounts/deployments@2025-10-01-preview"
}

resource "azurerm_cognitive_account" "foundry" {
  count = var.enable_claude ? 1 : 0

  name                = module.naming.ai_account
  location            = azurerm_resource_group.app.location
  resource_group_name = azurerm_resource_group.app.name
  kind                = "AIServices"
  sku_name            = "S0"

  # Required for private endpoints and for Entra token auth to a custom endpoint.
  custom_subdomain_name = module.naming.ai_account

  local_auth_enabled            = false
  public_network_access_enabled = !var.private_networking

  network_acls {
    default_action = "Deny"
    ip_rules       = var.ai_allowed_ip_ranges
  }

  tags = local.common_tags

  lifecycle {
    precondition {
      condition     = local.claude_org_ok && local.claude_country_ok && local.claude_industry_ok
      error_message = "enable_claude is true, but claude_organization_name, claude_country_code and claude_industry are not all set. They are your own attestation to Anthropic's terms and are never defaulted."
    }
  }
}

resource "azurerm_private_endpoint" "foundry" {
  count = var.enable_claude && var.private_networking ? 1 : 0

  name                = module.naming.private_endpoint_ai
  location            = azurerm_resource_group.app.location
  resource_group_name = azurerm_resource_group.app.name
  subnet_id           = data.azurerm_subnet.pe[0].id

  private_service_connection {
    name                           = "psc-ai"
    private_connection_resource_id = azurerm_cognitive_account.foundry[0].id
    subresource_names              = ["account"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name = "default"
    private_dns_zone_ids = [
      data.azurerm_private_dns_zone.cognitiveservices[0].id,
      data.azurerm_private_dns_zone.aiservices[0].id,
    ]
  }

  tags = local.common_tags
}

# The app identity may call the models (data action Microsoft.CognitiveServices/accounts/MaaS/*).
resource "azurerm_role_assignment" "app_cognitive_services_user" {
  count = var.enable_claude ? 1 : 0

  scope                = azurerm_cognitive_account.foundry[0].id
  role_definition_name = "Cognitive Services User"
  principal_id         = data.azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
  description          = "App identity: call Claude on Foundry"
}

resource "azapi_resource" "claude" {
  count = var.enable_claude ? 1 : 0

  type      = local.claude_deployment_api
  name      = var.claude_model_name
  parent_id = azurerm_cognitive_account.foundry[0].id

  # Needed so modelProviderData (not in the embedded schema) is accepted, as in the sample.
  schema_validation_enabled = false

  body = {
    sku = {
      name     = "GlobalStandard"
      capacity = var.claude_capacity
    }
    properties = {
      model = {
        format  = "Anthropic"
        name    = var.claude_model_name
        version = var.claude_model_version
      }
      modelProviderData = {
        organizationName = var.claude_organization_name
        countryCode      = var.claude_country_code
        industry         = var.claude_industry
      }
      versionUpgradeOption = "OnceNewDefaultVersionAvailable"
      raiPolicyName        = "Microsoft.DefaultV2"
    }
  }

  # Role assignments propagate slowly; creating the deployment (a long-running operation)
  # after them means the app's first call after apply usually works without retries.
  depends_on = [
    azurerm_role_assignment.app_cognitive_services_user,
    azurerm_private_endpoint.foundry,
  ]

  lifecycle {
    precondition {
      condition     = local.claude_org_ok && local.claude_country_ok && local.claude_industry_ok
      error_message = "enable_claude is true, but claude_organization_name, claude_country_code and claude_industry are not all set. They are your own attestation to Anthropic's terms and are never defaulted."
    }
  }
}

# Audit and request logs to Log Analytics.
resource "azurerm_monitor_diagnostic_setting" "foundry" {
  count = var.enable_claude ? 1 : 0

  name                       = "to-log-analytics"
  target_resource_id         = azurerm_cognitive_account.foundry[0].id
  log_analytics_workspace_id = data.azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "Audit"
  }

  enabled_log {
    category = "RequestResponse"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}
