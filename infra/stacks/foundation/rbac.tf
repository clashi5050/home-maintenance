# =============================================================================
# rbac.tf (foundation stack)
# -----------------------------------------------------------------------------
# Least privilege for the app identity, each assignment at the narrowest scope:
#   - Storage Blob Data Contributor on the `documents` container only
#   - Storage Blob Data Contributor on the `replica` container only
#     (Litestream replica and the writer lock blob)
#   - Key Vault Secrets User on the vault (read secret values, nothing else)
# principal_type is set so Azure does not need to look the principal up in Entra
# right after the identity is created (avoids the "principal does not exist" race).
# =============================================================================

resource "azurerm_role_assignment" "documents_blob_contributor" {
  scope                = local.container_id_documents
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
  description          = "App identity: read/write uploaded documents"
}

resource "azurerm_role_assignment" "replica_blob_contributor" {
  scope                = local.container_id_replica
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
  description          = "App identity: Litestream replica and writer lock"
}

resource "azurerm_role_assignment" "key_vault_secrets_user" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
  principal_type       = "ServicePrincipal"
  description          = "App identity: read secrets referenced by the Container App"
}
