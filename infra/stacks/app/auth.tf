# =============================================================================
# auth.tf (app stack)
# -----------------------------------------------------------------------------
# Built-in authentication (Container Apps "easy auth") with Google as the only
# provider. Declared with azapi because azurerm_container_app has no authConfigs.
# Type: Microsoft.App/containerApps/authConfigs, name must be "current".
# API version 2025-07-01 is a stable version in azapi 2.12's embedded schema, and
# the body below was checked against that schema by `terraform validate`
# (schema validation stays ON for this resource).
#
# Unauthenticated requests are redirected to Google. The paths in excludedPaths
# are served without a login (health probes and the public policy pages/assets).
# The app still enforces its own ALLOWED_EMAILS list (server/auth.js); this layer
# only proves who the caller is.
#
# Manual step after the first apply: add the redirect URI
#   https://<container_app_fqdn>/.auth/login/google/callback
# to the Google OAuth client (the fqdn is the `container_app_fqdn` output).
# =============================================================================

resource "azapi_resource" "auth" {
  type      = "Microsoft.App/containerApps/authConfigs@2025-07-01"
  name      = "current"
  parent_id = azurerm_container_app.app.id

  body = {
    properties = {
      platform = {
        enabled = true
      }

      globalValidation = {
        unauthenticatedClientAction = "RedirectToLoginPage"
        redirectToProvider          = "google"
        # Only the health check is served without a login (and only /healthz: the app answers it before it
        # looks at any identity header). Add public pages here only once they exist, and make the app ignore
        # identity headers on those paths, so a forged header can never be mistaken for a sign-in.
        excludedPaths = [
          "/healthz",
        ]
      }

      identityProviders = {
        google = {
          enabled = true
          registration = {
            clientId = var.google_client_id
            # Name of the Container App secret (container_app.tf), never the value.
            clientSecretSettingName = "google-client-secret"
          }
          login = {
            scopes = ["openid", "profile", "email"]
          }
        }
      }

      login = {
        preserveUrlFragmentsForLogins = true
      }

      httpSettings = {
        requireHttps = true
      }
    }
  }
}
