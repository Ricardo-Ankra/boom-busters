import { getVoiceTake, isMockKey } from '@boom-busters/db'
import {
  encodeWav,
  mockNarrationPcm,
  mockProvidersEnabled,
  mockTakeSeed,
  NARRATION_SAMPLE_RATE,
} from '@boom-busters/providers'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { presignGet } from '@/lib/storage'
import { takeUnit } from '@/lib/take-unit'

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
  const take = await getVoiceTake(db, id)
  if (!take) return new Response('No such take', { status: 404 })

  if (take.r2Key === null) {
    // Claimed but never filled: the run died between reserving the row and
    // storing the audio. Saying so beats a 404 that reads as "wrong link".
    return new Response('This take has no audio yet.', { status: 409 })
  }

  if (isMockKey(take.r2Key)) {
    /**
     * A `mock://` take on a live deployment is not a mock take — it is a take
     * that was bought from a vendor and then not stored, because the runner
     * used to fall back to this key whenever R2 was missing. Regenerating the
     * mock here would answer with tone bursts under the waveform of the real
     * narration, which is what made the fault so hard to see: the screen looked
     * right and the speaker did not.
     *
     * `takeStorage` stops any new take reaching this state. The ones already in
     * the table say what happened instead of impersonating audio.
     */
    if (!mockProvidersEnabled()) {
      return new Response(
        'This take has no audio. It was synthesised before R2 was configured, so the vendor was ' +
          'paid and the result was never stored. Flag it for a retake, or re-run the voice stage ' +
          'once storage is set up.',
        { status: 409 },
      )
    }

    // The mock's bytes are a function of the unit text, so the regenerated
    // audio has the length and shape of what the take claims to hold.
    const unit = await takeUnit(db, take)
    if (!unit) {
      return new Response('The section this take was read from no longer exists.', {
        status: 409,
      })
    }

    const wav = encodeWav(
      mockNarrationPcm(
        unit.text,
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
