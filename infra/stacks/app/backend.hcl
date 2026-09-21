# =============================================================================
# backend.hcl (app stack)
# -----------------------------------------------------------------------------
# Same fixed state store as the foundation stack (copied from the showcase site's
# backend.hcl). The state KEY differs and is passed at init time, with the state
# subscription id (TFSTATE_SUBSCRIPTION_ID secret):
#   terraform init -backend-config=backend.hcl \
#     -backend-config="key=${environment}-${short_loc}-${app}-app.tfstate" \
#     -backend-config="subscription_id=${TFSTATE_SUBSCRIPTION_ID}"
# =============================================================================
resource_group_name  = "tfstatelab"
storage_account_name = "tfstatestoragelab2"
container_name       = "tfstate"

# Entra ID access to the state blobs, not the account key (see the foundation stack's backend.hcl).
use_azuread_auth = true
