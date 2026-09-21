# =============================================================================
# backend.hcl (foundation stack)
# -----------------------------------------------------------------------------
# Fixed remote state backend, the same shared state store the showcase site's
# Terraform uses (copied from ai-showcase-site/Terraform/backend.hcl; change these
# three lines if you want a different state account). Committed so they do not
# need to be re-supplied on every `terraform init`.
# Two values still vary and are passed separately via -backend-config, NOT here:
#   - key: <environment>-<short_loc>-<app>-foundation.tfstate
#   - subscription_id: subscription that holds the state storage account, supplied
#     from the TFSTATE_SUBSCRIPTION_ID GitHub secret.
#   terraform init -backend-config=backend.hcl \
#     -backend-config="key=${environment}-${short_loc}-${app}-foundation.tfstate" \
#     -backend-config="subscription_id=${TFSTATE_SUBSCRIPTION_ID}"
# =============================================================================
resource_group_name  = "tfstatelab"
storage_account_name = "tfstatestoragelab2"
container_name       = "tfstate"

# Entra ID access to the state blobs, not the storage account key. With key access, any identity that
# can list the account's keys can read and overwrite EVERY project's state on this shared account
# (including secrets kept in state). With this on, each identity only needs a role on the `tfstate`
# container: Storage Blob Data Contributor for the deploy and destroy identity, Storage Blob Data
# Reader for the read-only pull-request plan identity (see infra/README.md).
use_azuread_auth = true
