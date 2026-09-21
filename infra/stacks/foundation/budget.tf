# =============================================================================
# budget.tf (foundation stack)
# -----------------------------------------------------------------------------
# One subscription-scoped budget filtered to the three resource groups this
# project owns (foundation, app, and the platform-managed group the Container
# Apps environment creates), so a single amount covers the whole bill.
#
# Why not azurerm_consumption_budget_resource_group: it takes exactly one group,
# so two would be needed (splitting the amount) and the platform-managed group
# would be missed. Why not a tag filter: resources inside the platform-managed
# group are not tagged by Terraform. The subscription-scoped resource needs the
# deploy identity to be allowed to write budgets at subscription scope (Contributor
# includes it; the README lists it).
#
# A budget only alerts. It does not stop spending: destroy-app.yml is the stop.
# Notifications: 50% actual, 80% actual, 100% forecasted, 100% actual.
# =============================================================================

resource "azurerm_consumption_budget_subscription" "main" {
  name            = module.naming.budget
  subscription_id = "/subscriptions/${var.arm_subscription_id}"

  amount     = var.monthly_budget
  time_grain = "Monthly"

  time_period {
    # Must be the first day of a month. Computed from the apply date and then frozen
    # by ignore_changes below (changing it would force a new budget).
    start_date = formatdate("YYYY-MM-01'T'00:00:00'Z'", timestamp())
  }

  filter {
    dimension {
      name     = "ResourceGroupName"
      operator = "In"
      values = [
        module.naming.resource_group_foundation,
        module.naming.resource_group_app,
        module.naming.resource_group_aca_infra,
      ]
    }
  }

  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = var.alert_emails
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = var.alert_emails
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    contact_emails = var.alert_emails
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = var.alert_emails
  }

  lifecycle {
    ignore_changes = [time_period]
  }
}
