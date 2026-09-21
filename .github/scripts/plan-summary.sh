#!/usr/bin/env bash
# Prints a Markdown summary of a saved Terraform plan (./tfplan): counts and resource addresses only,
# never attribute values, so it is safe to write to the job summary of a public repository.
# usage: plan-summary.sh "<title>"   (run in the stack directory, after `terraform plan -out=tfplan`)
set -euo pipefail

echo "### ${1:-Terraform plan}"
terraform show -json tfplan | jq -r '
  [(.resource_changes // [])[] | select(.change.actions != ["no-op"])] as $c
  | if ($c | length) == 0 then "No changes."
    else "\($c | length) resource(s) to change:\n"
         + ($c | map("- `\(.change.actions | join("/"))` \(.address)") | join("\n"))
    end'
