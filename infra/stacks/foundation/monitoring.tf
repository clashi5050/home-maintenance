# =============================================================================
# monitoring.tf (foundation stack)
# -----------------------------------------------------------------------------
# One Log Analytics workspace (the destination for every diagnostic setting in
# both stacks) and a workspace-based Application Insights.
# daily_quota_gb = 0.5 is a cost guard: when the cap is hit, ingestion stops
# until the next day (and logs after that point are lost) instead of the bill
# growing.
# =============================================================================

resource "azurerm_log_analytics_workspace" "main" {
  name                = module.naming.log_analytics
  location            = azurerm_resource_group.foundation.location
  resource_group_name = azurerm_resource_group.foundation.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = 0.5
  tags                = local.common_tags
}

resource "azurerm_application_insights" "main" {
  name                = module.naming.app_insights
  location            = azurerm_resource_group.foundation.location
  resource_group_name = azurerm_resource_group.foundation.name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  retention_in_days   = 30
  tags                = local.common_tags
}
