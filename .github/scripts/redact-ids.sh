#!/usr/bin/env bash
# Reads text on stdin and writes it to stdout with the Azure identifiers replaced by placeholders.
# The identifiers arrive as environment variables (GitHub variables/secrets); nothing is hard-coded
# here because the repository is public. Used to make Terraform plan output safe to keep as an artifact.
set -euo pipefail

expressions=()
add() { # add <value> <placeholder>: skip empty values (an empty sed pattern is an error)
  # Case-insensitive (I): Azure often returns identifiers in lower case even when they were given in upper case.
  if [ -n "${1:-}" ]; then expressions+=(-e "s/$1/$2/gI"); fi
}

add "${ARM_SUBSCRIPTION_ID:-}" '<subscription-id>'
add "${ARM_TENANT_ID:-}" '<tenant-id>'
add "${ARM_CLIENT_ID:-}" '<client-id>'
add "${TFSTATE_SUBSCRIPTION_ID:-}" '<state-subscription-id>'

if [ "${#expressions[@]}" -eq 0 ]; then
  cat
else
  sed "${expressions[@]}"
fi
