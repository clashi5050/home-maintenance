# =============================================================================
# network.tf (foundation stack)
# -----------------------------------------------------------------------------
# Everything here exists only when var.private_networking is true.
#   - VNet 10.42.0.0/24 with two /27 subnets:
#       aca  delegated to Microsoft.App/environments (Container Apps environment)
#       pe   private endpoints
#   - Private DNS zones for blob, Key Vault and the Foundry (AIServices) account,
#     each linked to the VNet without auto-registration.
# The Foundry zones are created here (not in the app stack) so the app stack can
# be destroyed and rebuilt without touching DNS.
# No NAT gateway, firewall or route tables: none are needed and each costs money.
# No NSGs are attached: the Container Apps subnet must accept platform and
# internet-facing ingress traffic, and the private endpoint subnet is only
# reachable from inside the VNet. See .checkov.yaml for the recorded reasoning.
# =============================================================================

locals {
  private_dns_zones = var.private_networking ? {
    blob              = "privatelink.blob.core.windows.net"
    vault             = "privatelink.vaultcore.azure.net"
    cognitiveservices = "privatelink.cognitiveservices.azure.com"
    aiservices        = "privatelink.services.ai.azure.com"
  } : {}
}

resource "azurerm_virtual_network" "main" {
  count = var.private_networking ? 1 : 0

  name                = module.naming.vnet
  location            = azurerm_resource_group.foundation.location
  resource_group_name = azurerm_resource_group.foundation.name
  address_space       = var.vnet_address_space
  tags                = local.common_tags
}

resource "azurerm_subnet" "aca" {
  count = var.private_networking ? 1 : 0

  name                 = "aca"
  resource_group_name  = azurerm_resource_group.foundation.name
  virtual_network_name = azurerm_virtual_network.main[0].name
  address_prefixes     = [var.aca_subnet_prefix]

  delegation {
    name = "Microsoft.App.environments"

    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "pe" {
  count = var.private_networking ? 1 : 0

  name                 = "pe"
  resource_group_name  = azurerm_resource_group.foundation.name
  virtual_network_name = azurerm_virtual_network.main[0].name
  address_prefixes     = [var.pe_subnet_prefix]
}

resource "azurerm_private_dns_zone" "this" {
  for_each = local.private_dns_zones

  name                = each.value
  resource_group_name = azurerm_resource_group.foundation.name
  tags                = local.common_tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "this" {
  for_each = local.private_dns_zones

  name                  = "link-${each.key}"
  resource_group_name   = azurerm_resource_group.foundation.name
  private_dns_zone_name = azurerm_private_dns_zone.this[each.key].name
  virtual_network_id    = azurerm_virtual_network.main[0].id
  registration_enabled  = false
  tags                  = local.common_tags
}
