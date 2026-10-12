#!/usr/bin/env bash
# Redeploys the Remotion function and site, then the broker stack, carrying
# every live value forward (decision 287's recipe, written down for decision
# 295). Run from Git Bash at the repo root:
#
#   bash infra/scripts/redeploy-lambda.sh
#
# Reads REMOTION_FUNCTION_NAME, REMOTION_SERVE_URL, RENDER_BUCKET,
# CALLBACK_URL, SENTRY_DSN, RENDER_CAP, RENDER_FANOUT and
# MEDIA_LAMBDA_MEMORY_MB from the live broker Lambda, never prints a secret,
# refuses to deploy if any required value is empty, prefers the function
# name and serve URL deploy:remotion prints (they change with Remotion's
# version), then deploys the broker stack and verifies the result.
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-reelscript}"
export AWS_REGION="${AWS_REGION:-eu-west-1}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

live="$(aws lambda get-function-configuration --function-name boom-busters-broker \
  --region "$AWS_REGION" --query 'Environment.Variables' --output json)"
read_live() { node -e "const v=JSON.parse(process.argv[1]);process.stdout.write(v[process.argv[2]]??'')" "$live" "$1"; }

export REMOTION_FUNCTION_NAME="$(read_live REMOTION_FUNCTION_NAME)"
export REMOTION_SERVE_URL="$(read_live REMOTION_SERVE_URL)"
export RENDER_BUCKET="$(read_live RENDER_BUCKET)"
export CALLBACK_URL="$(read_live CALLBACK_URL)"
export SENTRY_DSN="$(read_live SENTRY_DSN)"
export RENDER_CAP="$(read_live RENDER_CAP)"
export RENDER_FANOUT="$(read_live RENDER_FANOUT)"
export MEDIA_LAMBDA_MEMORY_MB="$(read_live MEDIA_LAMBDA_MEMORY_MB)"
export SENTRY_RELEASE="$(git rev-parse --short HEAD)"

for name in REMOTION_FUNCTION_NAME REMOTION_SERVE_URL RENDER_BUCKET CALLBACK_URL SENTRY_DSN; do
  if [ -z "${!name}" ]; then echo "refusing to deploy: $name is empty on the live Lambda" >&2; exit 1; fi
done
: "${RENDER_CAP:=2}"; : "${RENDER_FANOUT:=150}"; : "${MEDIA_LAMBDA_MEMORY_MB:=3008}"
echo "live values read: function=$REMOTION_FUNCTION_NAME bucket=$RENDER_BUCKET cap=$RENDER_CAP fanout=$RENDER_FANOUT memory=$MEDIA_LAMBDA_MEMORY_MB sentry_dsn=<${#SENTRY_DSN} chars> release=$SENTRY_RELEASE"

echo; echo "== deploy:remotion (the render function and the compositions site)"
remotion_out="$(pnpm --filter @boom-busters/infra deploy:remotion 2>&1 | tee /dev/stderr)"
new_fn="$(printf '%s\n' "$remotion_out" | sed -n 's/^  REMOTION_FUNCTION_NAME=//p' | tail -1)"
new_url="$(printf '%s\n' "$remotion_out" | sed -n 's/^  REMOTION_SERVE_URL=//p' | tail -1)"
if [ -n "$new_fn" ]; then export REMOTION_FUNCTION_NAME="$new_fn"; fi
if [ -n "$new_url" ]; then export REMOTION_SERVE_URL="$new_url"; fi

echo; echo "== deploy:stacks boom-busters-broker"
pnpm --filter @boom-busters/infra deploy:stacks boom-busters-broker

echo; echo "== verify"
aws lambda get-function-configuration --function-name boom-busters-broker --region "$AWS_REGION" \
  --query 'Environment.Variables' --output json | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);
console.log('release', v.SENTRY_RELEASE, '| cap', v.RENDER_CAP, '| fanout', v.RENDER_FANOUT, '| serve', v.REMOTION_SERVE_URL, '| function', v.REMOTION_FUNCTION_NAME, '| sentry_dsn', (v.SENTRY_DSN||'').length, 'chars')})"
