# =============================================================================
# variables.tf (naming module)
# -----------------------------------------------------------------------------
# The four inputs every name is built from. Both stacks pass the same four
# values, so both compute identical names with no shared state between them.
# Everything is lower case on purpose: Azure treats several of these names as
# case-insensitive, and Cost Management filters on resource group names are
# safest when they are already lower case.
# =============================================================================

variable "company_loc" {
  description = "Company/location short code, first token of every name (e.g. use2). Must start with a letter."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,7}$", var.company_loc))
    error_message = "company_loc must be 2-8 lower-case letters/digits and start with a letter."
  }
}

variable "app" {
  description = "Application short name (e.g. homemaint)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{2,12}$", var.app))
    error_message = "app must be 2-12 lower-case letters/digits."
  }
}

variable "environment" {
  description = "Deployment environment (e.g. main, dev)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{2,8}$", var.environment))
    error_message = "environment must be 2-8 lower-case letters/digits."
  }
}

variable "short_loc" {
  description = "Short region code (e.g. use2)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]{2,8}$", var.short_loc))
    error_message = "short_loc must be 2-8 lower-case letters/digits."
  }
}
