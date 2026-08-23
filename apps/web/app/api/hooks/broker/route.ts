import {
  BROKER_SIGNATURE_HEADER,
  BrokerCallbackSchema,
  requireEnv,
  verifyBrokerSignature,
} from '@boom-busters/schemas'
import { inngest } from '@/inngest/client'

/**
 * The single callback route for everything asynchronous on AWS (decision
 * 132): the broker's normalised render outcomes and every media-utils job
 * completion arrive here, HMAC-signed with the broker token. Verified
 * payloads become Inngest events; anything else is rejected and logged —
 * signature failures feed the section 12 possible-probe alarm on the
 * broker's side, and the same suspicion applies here.
 *
 * This route is unauthenticated by design (Lambdas cannot sign in); the
 * HMAC over the exact raw body IS the authentication. It must therefore
 * never leak why a rejection happened beyond a status code.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.text()
  const signature = request.headers.get(BROKER_SIGNATURE_HEADER) ?? ''

  const { AWS_BROKER_TOKEN } = requireEnv('broker')
  if (!verifyBrokerSignature(body, AWS_BROKER_TOKEN, signature)) {
    console.error(JSON.stringify({ event: 'broker-hook-signature-rejected' }))
    return Response.json({ error: 'bad signature' }, { status: 401 })
  }

  let parsed
  try {
    parsed = BrokerCallbackSchema.parse(JSON.parse(body))
  } catch {
    // Signed but unreadable: a version skew between app and Lambdas. Log
    // loudly, 200 quietly — retrying a payload that cannot parse helps no
    // one, and the waiting run's timeout will surface the failure.
    console.error(JSON.stringify({ event: 'broker-hook-unparseable' }))
    return Response.json({ ok: true })
  }

  if (parsed.source === 'broker') {
    // ONE event whatever the outcome. Two names forced the runners into two
    // waitForEvent steps, and Promise.all over them only settled when the
    // event that never fired hit its timeout — every render sat "rendering"
    // for the full window after finishing (found in production 2026-08-23).
    await inngest.send({
      name: 'render/settled',
      data: {
        projectId: parsed.projectId,
        renderId: parsed.renderId,
        result: parsed.result,
        ...(parsed.result === 'completed'
          ? { outputS3Key: parsed.outputS3Key ?? '', costUsd: parsed.costUsd ?? 0 }
          : {
              reason: parsed.reason ?? 'error',
              ...(parsed.message !== undefined ? { message: parsed.message } : {}),
            }),
      },
    })
  } else {
    await inngest.send({
      name: 'media/job.completed',
      data: {
        projectId: parsed.projectId,
        jobId: parsed.jobId,
        kind: parsed.kind,
        ok: parsed.ok,
        ...(parsed.result !== undefined ? { result: parsed.result } : {}),
        ...(parsed.error !== undefined ? { error: parsed.error } : {}),
      },
    })
  }

  return Response.json({ ok: true })
}
