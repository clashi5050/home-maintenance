# Infrastructure runbook (Azure)

Terraform and GitHub Actions for running Home Maintenance on Azure Container Apps. Everything here was
authored and checked **offline** (`terraform fmt`, `init -backend=false`, `validate`, provider schema
lookups). Nothing has been planned or applied against a real subscription; see "Unverified" at the end.

The repository is **public**. No subscription id, tenant id, client id, email, secret or `.tfvars` value is
committed. Values reach Terraform as `TF_VAR_*` from GitHub variables and secrets.

## Layout

```
infra/
  modules/naming/        pure computation of every resource name (no providers, no random suffix)
  stacks/foundation/     long-lived: identity, network, storage, Key Vault, monitoring, Container Apps env, budget
  stacks/app/            rebuildable: Container App, sign-in, alerts, optional Foundry + Claude
  environments/          main.example.tfvars (placeholders only)
.github/workflows/       terraform-pr, terraform-apply, destroy-app, destroy-all, docker (build + Trivy), codeql
```

Both stacks call `modules/naming` with the same four values (`company_loc`, `app`, `environment`,
`short_loc`), so the app stack finds foundation resources by name and never reads the foundation's state.

| Stack | Resource group | Owns | Safe to destroy? |
|---|---|---|---|
| foundation | `rg-<company_loc>-<app>-<env>-<short_loc>` | managed identity, VNet + private DNS + private endpoints, storage account (`documents`, `replica`), Key Vault, Log Analytics, App Insights, Container Apps environment, budget, locks, role assignments | Rarely. Holds the data. Only via `destroy-all`. |
| app | `rg-<...>-app` | Container App, Google sign-in (`authConfigs`), alerts, diagnostic settings, optional Foundry account + Claude deployment | Any time. `destroy-app` is also the emergency cost stop. |

The environment also makes a platform-managed group `rg-<...>-acainfra`; do not put anything in it.

## Cost: read before applying

`private_networking = true` (the default) creates private endpoints for blob and Key Vault (and Foundry when
enabled). Private endpoints are billed per hour (about USD 0.01/h each, roughly USD 7 a month each; **pricing
not verified here**), plus four private DNS zones, plus the Container App (0.5 vCPU / 1 GiB, always on, idle
rate when quiet), Log Analytics (capped at 0.5 GB/day) and storage. That can consume most of the default USD 25
budget. A VNet-integrated environment may also bill a load balancer and public IP in the `acainfra` group
(**unverified**). `AZ_PRIVATE_NETWORKING=false` removes the VNet and private endpoints (data services then accept
public connections, still Entra-only).

Never add to the Container Apps environment: a private endpoint on the environment itself, a Dedicated
workload profile, or planned maintenance. Each starts a Dedicated Plan management fee (about USD 73 a month).
A budget alerts; it does not stop spending. `destroy-app` does.

## One-time setup (owner)

### 1. Azure

Register resource providers once (the deploy identity is deliberately not allowed to; the provider block sets
`resource_provider_registrations = "none"`): `Microsoft.App`, `Microsoft.OperationalInsights`,
`Microsoft.Insights`, `Microsoft.Network`, `Microsoft.Storage`, `Microsoft.KeyVault`,
`Microsoft.ManagedIdentity`, `Microsoft.CognitiveServices`, `Microsoft.Consumption`,
`Microsoft.MarketplaceOrdering` (only for Claude). Check with `az provider list` (not run by the author).

Deploy identity (the app registration behind `ARM_CLIENT_ID`), at **subscription scope**:

* `Contributor`. Needed at subscription scope because Terraform creates the resource groups themselves; a
  role on a resource group cannot exist before that group does. It also covers the subscription budget.
* Permission to write role assignments **and locks**. `Contributor` excludes `Microsoft.Authorization/*/Write`.
  `Role Based Access Control Administrator` allows role assignments but not locks (locks are
  `Microsoft.Authorization/locks`); `User Access Administrator` includes `Microsoft.Authorization/*`, so it
  covers both. Simplest: `User Access Administrator`. Tighter: `Role Based Access Control Administrator`
  with a condition limiting it to the roles this repo assigns (Storage Blob Data Contributor, Key Vault
  Secrets User, Cognitive Services User) for `ServicePrincipal` principals, plus a small custom role that
  allows `Microsoft.Authorization/locks/*`. (Role facts checked against Microsoft Learn; whether the tighter
  variant applies cleanly was not tested.)
* Access to the Terraform state storage account, as in the showcase site (its backend has no
  `use_azuread_auth`, so the identity needs to list keys or you add that option).

Federated credentials on that app registration (subject, issuer `https://token.actions.githubusercontent.com`,
audience `api://AzureADTokenExchange`):

| Used by | Subject |
|---|---|
| terraform-apply.yml | `repo:<owner>/<repo>:environment:azure-main` |
| destroy-app.yml, destroy-all.yml | `repo:<owner>/<repo>:environment:azure-destroy` |
| terraform-pr.yml (plan) | `repo:<owner>/<repo>:pull_request` |

**Recommendation:** put the `pull_request` subject on a *separate, read-only* app registration (Reader on the
subscription, plus the same state access) and set its client id as the variable `ARM_PLAN_CLIENT_ID`. Anyone
who can push a branch to this repo can change the PR workflow, and whatever identity holds the
`pull_request` subject runs their code. If you skip this, the PR plan uses the deploy identity.

### 2. GitHub

Environments (Settings > Environments), each with **required reviewers** and, if you like, "deployment
branches: main only":

* `azure-main`: gate for `terraform-apply.yml` (two jobs, so two approvals per run).
* `azure-destroy`: gate for both destroy workflows.

Repository **variables**:

| Variable | Notes |
|---|---|
| `ARM_CLIENT_ID`, `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID` | required |
| `AZ_COMPANY_LOC`, `AZ_SHORT_LOC`, `AZ_LOCATION` | required (naming and region; the region must support GZRS, Container Apps workload profiles and, for Claude, the model) |
| `GOOGLE_CLIENT_ID` | required (not a secret) |
| `ARM_PLAN_CLIENT_ID` | optional, see above |
| `AZ_APP` (default `homemaint`), `AZ_ENVIRONMENT` (default `main`) | optional |
| `AZ_PRIVATE_NETWORKING` (default `true`), `AZ_MONTHLY_BUDGET` (default `25`) | optional |
| `GOOGLE_SECRET_SOURCE` (`keyvault` default, or `inline`) | optional |
| `ENABLE_CLAUDE` (default `false`), `CLAUDE_ORGANIZATION_NAME`, `CLAUDE_COUNTRY_CODE`, `CLAUDE_INDUSTRY`, `CLAUDE_MODEL_NAME`, `CLAUDE_MODEL_VERSION` | optional; see "Claude" |

Repository **secrets** (repository level, **not** environment level: the PR plan job has no environment):

| Secret | Notes |
|---|---|
| `TFSTATE_SUBSCRIPTION_ID` | subscription that holds the state storage account |
| `ALLOWED_EMAILS` | comma-separated Google accounts allowed in |
| `ALERT_EMAILS` | JSON array, e.g. `["me@example.com"]` |
| `GOOGLE_CLIENT_SECRET` | only when `GOOGLE_SECRET_SOURCE=inline` (it then lands in Terraform state) |

Also: make the GHCR package `home-maintenance` **public** (the Container App has no registry credentials and
pulls anonymously), and turn on Dependabot alerts and code scanning.

Terraform state can contain sensitive values (the `allowed-emails` secret, an inline Google secret). Keep the
state storage account private and encrypted.

## Order of apply (first time)

1. Merge to `main`. `Build image` publishes the image; `Terraform apply` starts. Approve the **foundation** job.
2. The **app** job then waits for approval. **Do not approve it yet** (reject it): the Key Vault secret does not
   exist and the Container App would fail to create.
3. Add the Google client secret to Key Vault (next section).
4. In the Google Cloud console, create the OAuth client and add the redirect URI
   `https://<container-app-name>.<default-domain>/.auth/login/google/callback`. The default domain is the
   foundation output `container_app_environment_default_domain` (printed at the end of the foundation apply);
   the app name is `<company_loc>-<app>-ca-<environment>-<short_loc>`. After the app stack is applied the
   `google_redirect_uri` output gives it directly.
5. Run **Terraform apply** by hand (Actions > Run workflow). Foundation is a no-op; approve the app job.
6. Smoke test (below).

Later: infrastructure changes to `infra/**` on `main` apply automatically after approval. A change to the
application code alone does **not** (no `infra/**` change), so roll out a new image by running **Terraform
apply** by hand: it deploys the image built from the commit it runs on. Paste an older digest into
`image_digest` to roll back.

## Adding Key Vault secrets (control plane, never Terraform)

Terraform never creates secrets (data plane, and the value would end up in state). With private networking the
vault's data plane is unreachable from the internet, so add secrets through ARM, which is always reachable:

```sh
# secret.json (do NOT commit; delete afterwards): {"properties":{"value":"<the Google client secret>"}}
az rest --method put \
  --url "https://management.azure.com/subscriptions/<sub-id>/resourceGroups/<foundation-rg>/providers/Microsoft.KeyVault/vaults/<vault-name>/secrets/google-client-secret?api-version=2026-02-01" \
  --body @secret.json
```

The portal's "Deploy a custom template" with a `Microsoft.KeyVault/vaults/secrets` resource works too.
`2026-02-01` is a stable version in Microsoft Learn's reference (checked). **Unverified:** which role your own
account needs for this ARM call (expected `Microsoft.KeyVault/vaults/secrets/write` through `Contributor` or
`Key Vault Contributor` on the vault, not a data-plane role). The name must match
`google_client_secret_kv_name` (default `google-client-secret`).

## Smoke test after the first app apply

1. `https://<fqdn>/healthz` returns 200 with no login. The site root redirects to Google.
2. **Key Vault reference over the private endpoint (UNVERIFIED).** The Container App resolves
   `google-client-secret` from Key Vault with the managed identity, through the vault's private endpoint. If the
   revision fails to provision with a Key Vault error, set `GOOGLE_SECRET_SOURCE=inline` and `GOOGLE_CLIENT_SECRET`,
   re-apply, and read the trade-off (the secret then lives in Terraform state).
3. Sign in with an address in `ALLOWED_EMAILS`; then with one that is not (expect the app's "Not on the list").
4. Upload a document (blob access by managed identity through the blob private endpoint).
5. The `replica` container gains `db/home-maintenance` and `locks/writer.lock`. Restart the revision: the app
   comes back with its data.
6. Log Analytics receives `ContainerAppConsoleLogs`; a test restart triggers the restart alert.

## Destroy paths

* **Emergency stop / rebuild: `Destroy app (emergency cost stop)`.** Type `destroy-app`; approve in
  `azure-destroy`. Removes only the app stack. Data, identity, Key Vault and the environment stay. Bring the
  app back with **Terraform apply**.
* **Everything: `Destroy everything`.** Type `destroy-everything` **and** tick `i_have_a_final_export`;
  approve twice (app, then foundation). The locks are Terraform resources depending on what they protect, so
  they are removed first. The Key Vault stays soft-deleted for 90 days (purge protection); applying again
  recovers it (`recover_soft_deleted_key_vaults = true`). Foundry accounts and Log Analytics workspaces are
  purged on destroy so their names can be reused.

### Data export (do this before `destroy-everything`)

Documents: download the `documents` container (for example `az storage blob download-batch --auth-mode login`
with your own account holding `Storage Blob Data Reader`). Database: restore the Litestream replica
(`replica` container, path `db/home-maintenance`) with `litestream restore` using an `abs` replica config, or
copy the container. With private networking the storage account has no public path: temporarily allow your IP in
the storage account's Networking blade (Terraform reverts it on the next apply) or run from inside the VNet.
These export steps were **not tested**.

## Claude on Foundry (optional, off by default)

Turning on `ENABLE_CLAUDE` creates an AIServices account (Entra-only, no keys, private endpoint) and a Claude
deployment through `azapi`. **Applying accepts Anthropic's Marketplace terms on your behalf.** The three
`modelProviderData` values are your own attestation, have no defaults, and are never invented: set
`CLAUDE_ORGANIZATION_NAME`, `CLAUDE_COUNTRY_CODE` (two letters) and `CLAUDE_INDUSTRY` (lower case) yourself, or
the apply stops with a clear message. Pick a region that hosts Claude. The subscription needs quota and a
billing method for Marketplace models.

`CLAUDE_MODEL_NAME` defaults to `claude-opus-5`. `CLAUDE_MODEL_VERSION` defaults to `1` (what the
Azure-Samples/claude sample uses): **the version string that selects the Hosted-on-Azure variant is
unverified**; if the apply is rejected, read the live catalog and set it. Capacity is 25 (25K TPM).

The app does not use this yet: `server/assistant.js` authenticates only with `ANTHROPIC_API_KEY` /
`ANTHROPIC_AUTH_TOKEN`, and the account has key auth disabled. The identity already holds Cognitive Services
User, so the code change is to obtain an Entra token and use the `foundry_endpoint` output.

## Working locally

* Do not run `plan`/`apply` from a laptop against the shared state unless you mean to. CI uses Terraform
  **1.16.3**; a state file written by a newer Terraform cannot be read by an older one, so a local 1.5.x can no
  longer use this remote state once CI has applied. Local checks that need no state still work:
  `terraform init -backend=false && terraform validate` in each stack.
* The provider lock file is git-ignored: one written on Windows only has Windows hashes and would break
  `init` on the Linux runners. To commit one, generate it for every platform
  (`terraform providers lock -platform=linux_amd64 -platform=windows_amd64 -platform=darwin_arm64` in each
  stack), then remove `.terraform.lock.hcl` from `.gitignore`.
* Storage account and Key Vault names are globally unique. If a name is taken, `apply` fails; change
  `AZ_COMPANY_LOC` or `AZ_APP`.

## CI notes

* **Pull requests** (`terraform-pr.yml`): fmt, validate, checkov, trivy config; plan only for same-repo,
  non-Dependabot PRs. The plan is **not** printed or commented: it is uploaded as a redacted artifact (7 days).
  Artifacts of a public repo are readable by any signed-in GitHub user, which is why ids are redacted and
  `alert_emails`/`allowed_emails` are Terraform-sensitive. The app plan is allowed to fail until the foundation
  stack exists.
* **Images** (`docker.yml`): Trivy scans the amd64 image before anything is pushed and fails on fixable
  HIGH/CRITICAL findings. Exceptions go in `.trivyignore` with a reason and expiry.
* Actions are pinned by commit SHA (version in the comment). Dependabot updates them.
* `.checkov.yaml` skips are each justified in that file. It was written without running checkov.

## Unverified

Not run against Azure or CI, and therefore not confirmed: any `plan`/`apply`; checkov and trivy results (neither
tool was available, so `.checkov.yaml` check ids are from memory); Key Vault secret references over a private
endpoint; that Claude `claude-opus-5` and its version string exist as written; the `2025-10-01-preview`
deployments API accepting `modelProviderData` (taken from the Azure-Samples sample); private endpoint and
load balancer prices; whether a Terraform plan can read the Key Vault resource through its private endpoint
without contacting the data plane; the tighter RBAC option; the export steps; GHCR anonymous pulls (needs the package public).
