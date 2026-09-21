# =============================================================================
# alerts.tf (app stack)
# -----------------------------------------------------------------------------
# An action group that emails var.alert_emails and two metric alerts on the
# Container App. Metric names are from the Azure Monitor supported-metrics list
# for Microsoft.App/containerapps: RestartCount ("Total Replica Restart Count",
# cumulative since the replica was created) and Replicas ("Replica Count").
#
# Limits worth knowing:
#   - RestartCount is cumulative, so once a replica has restarted the alert stays
#     fired until that replica is replaced (a deploy does that). One email per
#     firing, not one per restart.
#   - Metric alerts do not fire on missing data. If the app is scaled to zero
#     replicas the Replicas metric may stop reporting rather than report 0;
#     treat this alert as a best effort, not as an uptime monitor.
# =============================================================================

resource "azurerm_monitor_action_group" "alerts" {
  name                = module.naming.action_group
  resource_group_name = azurerm_resource_group.app.name
  short_name          = substr(var.app, 0, 12)

  # One receiver per address. alert_emails is sensitive, so the count is unwrapped
  # (a count reveals nothing) and each address is read by index.
  dynamic "email_receiver" {
    for_each = toset([for i in range(nonsensitive(length(var.alert_emails))) : tostring(i)])

    content {
      name                    = "recipient-${email_receiver.key}"
      email_address           = var.alert_emails[tonumber(email_receiver.key)]
      use_common_alert_schema = true
    }
  }

  tags = local.common_tags
}

resource "azurerm_monitor_metric_alert" "restarts" {
  name                = "${module.naming.container_app}-restarts"
  resource_group_name = azurerm_resource_group.app.name
  scopes              = [azurerm_container_app.app.id]
  description         = "The app container restarted (crash loop, out of memory, failed probe)."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"

  criteria {
    metric_namespace = "Microsoft.App/containerApps"
    metric_name      = "RestartCount"
    aggregation      = "Maximum"
    operator         = "GreaterThan"
    threshold        = 0
  }

  action {
    action_group_id = azurerm_monitor_action_group.alerts.id
  }

  tags = local.common_tags
}

resource "azurerm_monitor_metric_alert" "replicas" {
  name                = "${module.naming.container_app}-replicas"
  resource_group_name = azurerm_resource_group.app.name
  scopes              = [azurerm_container_app.app.id]
  description         = "Fewer than one replica is running: the app is down."
  severity            = 1
  frequency           = "PT5M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.App/containerApps"
    metric_name      = "Replicas"
    aggregation      = "Minimum"
    operator         = "LessThan"
    threshold        = 1
  }

  action {
    action_group_id = azurerm_monitor_action_group.alerts.id
  }

  tags = local.common_tags
}
