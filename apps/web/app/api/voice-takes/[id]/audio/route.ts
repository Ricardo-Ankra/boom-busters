import { isMockKey, takeWithParagraph } from '@boom-busters/db'
import {
  encodeWav,
  mockNarrationPcm,
  mockTakeSeed,
  NARRATION_SAMPLE_RATE,
} from '@boom-busters/providers'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { presignGet } from '@/lib/storage'

/**
 * Where the voice review screen gets its audio.
 *
 * **A redirect, not a proxy.** Design principle 2 keeps media out of the web
 * layer: the response is a 302 to a short-lived presigned R2 URL, and the
 * browser fetches the bytes from R2 directly. Streaming sixty paragraphs of
 * narration through a Vercel function to a listen-through would be the app
 * holding audio for no reason, at Vercel bandwidth prices.
 *
 * **Except in mock mode**, where there is nothing to redirect to. A
 * `MOCK_PROVIDERS=1` run has no bucket, so the take's key says `mock://` and
 * the bytes are regenerated here from the same deterministic function that
 * produced them — which is what lets an E2E actually play a take, flag it, and
 * hear that the retake is different.
 */

export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const found = await takeWithParagraph(db, id)
  if (!found) return new Response('No such take', { status: 404 })

  const { take, text } = found

  if (take.r2Key === null) {
    // Claimed but never filled: the run died between reserving the row and
    // storing the audio. Saying so beats a 404 that reads as "wrong link".
    return new Response('This take has no audio yet.', { status: 409 })
  }

  if (isMockKey(take.r2Key)) {
    if (text === undefined) {
      return new Response('The paragraph this take was read from no longer exists.', {
        status: 409,
      })
    }

    const wav = encodeWav(
      mockNarrationPcm(
        text,
        mockTakeSeed(take.voiceId, `${take.idempotencyKey}#${take.takeNumber}`),
      ),
      { sampleRate: NARRATION_SAMPLE_RATE },
    )

    return new Response(new Uint8Array(wav), {
      headers: {
        'content-type': 'audio/wav',
        'content-length': String(wav.length),
        // Deterministic bytes, so the browser may keep them. Private because
        // the route is session-checked and this is project content.
        'cache-control': 'private, max-age=3600',
      },
    })
  }

  return Response.redirect(await presignGet(take.r2Key), 302)
}
