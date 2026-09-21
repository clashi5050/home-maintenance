# =============================================================================
# aca_env.tf (foundation stack)
# -----------------------------------------------------------------------------
# Container Apps environment on the Consumption workload profile.
#
# COST TRAPS, DO NOT ADD (each one starts a Dedicated Plan management fee of
# roughly USD 73 per month, per the Container Apps billing page):
#   - a private endpoint ON THE ENVIRONMENT itself,
#   - a Dedicated workload profile (D4, E4, ...),
#   - planned maintenance windows.
# Private endpoints for storage/Key Vault/Foundry are separate resources in the
# pe subnet and do not trigger it.
#
# The workload profile must be declared at creation: an environment created
# without one can never get one added and would have to be rebuilt.
#
# internal_load_balancer_enabled stays false: the web app must be reachable from
# the internet, protected by its built-in Google sign-in (app stack).
#
# Logs go to Azure Monitor and from there to Log Analytics through the diagnostic
# setting below. Sending logs straight to Log Analytics would need the workspace
# shared key and is not supported through Private Link.
# =============================================================================

resource "azurerm_container_app_environment" "main" {
  name                = module.naming.container_app_environment
  location            = azurerm_resource_group.foundation.location
  resource_group_name = azurerm_resource_group.foundation.name

  logs_destination = "azure-monitor"

  infrastructure_subnet_id = var.private_networking ? azurerm_subnet.aca[0].id : null
  # Deterministic name so the budget can include the platform-managed group's cost.
  infrastructure_resource_group_name = module.naming.resource_group_aca_infra

  # The provider accepts these two only together with infrastructure_subnet_id. Without a
  # VNet the environment is public and not zone redundant anyway, so they are left unset.
  internal_load_balancer_enabled = var.private_networking ? false : null
  zone_redundancy_enabled        = var.private_networking ? false : null
  public_network_access          = "Enabled"
  mutual_tls_enabled             = false

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }

  tags = local.common_tags
}

# Required when logs_destination is azure-monitor: without it, no logs are stored.
resource "azurerm_monitor_diagnostic_setting" "container_app_environment" {
  name                       = "to-log-analytics"
  target_resource_id         = azurerm_container_app_environment.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "ContainerAppConsoleLogs"
  }

  enabled_log {
    category = "ContainerAppSystemLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}
