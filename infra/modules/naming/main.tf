# =============================================================================
# main.tf (naming module)
# -----------------------------------------------------------------------------
# Pure computation: no providers, no resources, no random suffix. The same four
# inputs always produce the same names, which is what lets the app stack find
# the foundation stack's resources without reading its remote state.
#
# Convention: <company_loc>-<app>-<type>-<environment>-<short_loc>
#   e.g. use2-homemaint-vnet-main-use2
# Storage accounts and Key Vaults cannot be that long (24 characters), so they
# use the same tokens without hyphens: use2homemaintstmainuse2.
# =============================================================================

terraform {
  required_version = ">= 1.5.0"
}

locals {
  # Standard hyphenated name for a resource type code.
  n = { for t in [
    "id", "vnet", "law", "appi", "cae", "ca", "ai", "ag", "bud",
    "pep-blob", "pep-vault", "pep-ai", "lock-st", "lock-kv",
  ] : t => "${var.company_loc}-${var.app}-${t}-${var.environment}-${var.short_loc}" }

  # Compact (no hyphen) names for the two 24-character resources.
  storage_account = "${var.company_loc}${var.app}st${var.environment}${var.short_loc}"
  key_vault       = "${var.company_loc}${var.app}kv${var.environment}${var.short_loc}"

  base = "${var.company_loc}-${var.app}-${var.environment}-${var.short_loc}"
}
