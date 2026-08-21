/**
 * Deploy-time configuration, read from the environment at synth. Synth and
 * the template tests run with the placeholder values; a real deploy exports
 * the real ones first (see infra/README.md). Placeholders are shaped like
 * their real counterparts so a forgotten export fails at the AWS boundary,
 * loudly, not silently mid-render.
 */

export interface InfraConfig {
  /** Bearer token for every broker request; HMAC key for every callback. */
  brokerToken: string
  /** The web app's broker-hook route, e.g. https://app/api/hooks/broker. */
  callbackUrl: string
  r2: {
    endpoint: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
  }
  remotion: {
    /** The deployed Remotion Lambda's real (version-encoded) name. */
    functionName: string
    /** The deployed site's serve URL. */
    serveUrl: string
  }
  /** Remotion's render output bucket (remotionlambda-*), from its deploy. */
  renderBucket: string
  /** Alarm + budget notifications; omit to skip email subscriptions. */
  alertEmail: string | undefined
  dailyBudgetUsd: number
  renderCap: number
  /**
   * Renderer chunks per render. Small because the account's Lambda
   * concurrency quota is 10; raise with the quota.
   */
  renderFanout: number
  /**
   * media-utils Lambda memory. Spec section 8 says 10240; new AWS accounts
   * cap functions at 3008 MB until a quota increase lands, so this is
   * overridable per deploy rather than a reason not to deploy at all.
   */
  mediaLambdaMemoryMb: number
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): InfraConfig {
  const read = (name: string, placeholder: string) => {
    const value = env[name]
    return value !== undefined && value !== '' ? value : placeholder
  }
  return {
    brokerToken: read('BROKER_TOKEN', 'set-me-before-deploy'),
    callbackUrl: read('CALLBACK_URL', 'https://set-me.example.com/api/hooks/broker'),
    r2: {
      endpoint: read('R2_ENDPOINT', 'https://set-me.r2.cloudflarestorage.com'),
      accessKeyId: read('R2_ACCESS_KEY_ID', 'set-me'),
      secretAccessKey: read('R2_SECRET_ACCESS_KEY', 'set-me'),
      bucket: read('R2_BUCKET', 'boom-busters'),
    },
    remotion: {
      functionName: read('REMOTION_FUNCTION_NAME', 'remotion-render-set-me'),
      serveUrl: read('REMOTION_SERVE_URL', 'https://set-me.s3.amazonaws.com/sites/boom-busters'),
    },
    renderBucket: read('RENDER_BUCKET', 'remotionlambda-unset'),
    alertEmail: env['ALERT_EMAIL'] !== '' ? env['ALERT_EMAIL'] : undefined,
    dailyBudgetUsd: Number(read('DAILY_BUDGET_USD', '25')),
    renderCap: Number(read('RENDER_CAP', '2')),
    renderFanout: Number(read('RENDER_FANOUT', '4')),
    mediaLambdaMemoryMb: Number(read('MEDIA_LAMBDA_MEMORY_MB', '10240')),
  }
}
