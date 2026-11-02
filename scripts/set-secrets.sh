#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-eu-west-1}"
PREFIX="/authenticate"
export AWS_CLI_AUTO_PROMPT=off

command -v aws >/dev/null || { echo "AWS CLI is required." >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js is required." >&2; exit 1; }

echo "Store auth.dliu.com Microsoft Entra credentials in AWS SSM ($REGION)."
read -r -p "Directory (tenant) ID: " TENANT_ID
read -r -p "Application (client) ID: " CLIENT_ID
read -r -s -p "Client secret VALUE (hidden): " CLIENT_SECRET
printf '\n'

GUID='^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$'
[[ "$TENANT_ID" =~ $GUID && "$CLIENT_ID" =~ $GUID ]] || {
  echo "Tenant ID and client ID must be UUIDs." >&2
  exit 1
}
[[ -n "$CLIENT_SECRET" ]] || { echo "Client secret value is required." >&2; exit 1; }

umask 077
INPUT="$(mktemp "${TMPDIR:-/tmp}/authenticate-credentials.XXXXXX")"
trap 'rm -f -- "$INPUT"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

put() {
  # AWS CLI on macOS cannot reliably read /dev/stdin; keep credentials in a private, short-lived file.
  printf '%s' "$3" |
    node -e '
      const fs = require("node:fs");
      process.stdout.write(JSON.stringify({
        Name: process.argv[1],
        Type: process.argv[2],
        Value: fs.readFileSync(0, "utf8"),
        Overwrite: true,
      }));
    ' "$PREFIX/$1" "$2" > "$INPUT"
  aws ssm put-parameter --region "$REGION" --cli-input-json "file://$INPUT" --no-cli-pager >/dev/null
  printf 'Saved %s/%s (%s).\n' "$PREFIX" "$1" "$2"
}

put entra-tenant-id String "$TENANT_ID"
put entra-client-id String "$CLIENT_ID"
put entra-client-secret SecureString "$CLIENT_SECRET"
unset CLIENT_SECRET
echo "Credentials uploaded."
