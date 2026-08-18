# infra — boom-busters broker & media-utils (CDK)

Two stacks into the existing Reelscript AWS account, everything tagged
`project=boom-busters`:

- **boom-busters-media-utils** — FFmpeg layer + Whisper.cpp Lambda
  (10,240 MB / 10 GB disk / 15 min): `qc`, `loudnorm`, `transcribe`,
  `upload-youtube`, invoked asynchronously by the broker, completing via
  HMAC-signed webhooks into the web app.
- **boom-busters-broker** — bearer-token Lambda Function URL: `POST
/renders` (validates + materialises the timeline, starts Remotion
  Lambda), `POST /renders/:id/cancel` (tombstone, §8.1), `GET /renders/:id`
  (progress proxy), `POST /webhooks/remotion` (signature-verified,
  normalised into one callback), `POST /media/*` (async dispatch). Alarms:
  errors, 5xx, signature failures, render concurrency > cap, daily budget.

Everything decision-shaped lives in `lambdas/*/core.ts` / `commands.ts` and
is unit-tested offline (`pnpm test`), including full CDK template
assertions. The `handler.ts` files are thin AWS adapters.

## Deploy order (needs AWS credentials for the Reelscript account)

```sh
cd infra

# 0. One-time: fetch the ffmpeg static binary into the layer
#    (see layers/ffmpeg/README.md), and bootstrap CDK if the account
#    has never used it: pnpm exec cdk bootstrap

# 1. Deploy the Remotion render function + compositions site
AWS_REGION=eu-west-1 pnpm deploy:remotion
#    → prints REMOTION_FUNCTION_NAME and REMOTION_SERVE_URL

# 2. Export the real configuration
export BROKER_TOKEN=...            # openssl rand -hex 32; also goes in the app env as AWS_BROKER_TOKEN
export CALLBACK_URL=https://<app>/api/hooks/broker
export R2_ENDPOINT=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=...
export REMOTION_FUNCTION_NAME=...  # from step 1
export REMOTION_SERVE_URL=...      # from step 1
export ALERT_EMAIL=...             # alarm + budget notifications
export RENDER_BUCKET=...           # remotionlambda-... bucket from step 1

# 3. Deploy the stacks
pnpm deploy

# 4. One-time: upload whisper.cpp assets to the WhisperAssets bucket
#    (Linux `main` binary + ggml-base.en.bin, keys boom-busters/whisper/*)

# 5. Point the app at the broker: AWS_BROKER_URL=<BrokerUrl output>,
#    AWS_BROKER_TOKEN=<BROKER_TOKEN>
```

Cancelling a render is honest, not magical (§8.1): Remotion Lambda cannot
abort mid-flight, so cancel tombstones the ID; when the webhook eventually
arrives the artefacts are deleted and no completion event is emitted. The
wasted spend is bounded (≤ one master ≈ $0.25) and the UI says so.
