import { WAVEFORM_BUCKETS } from '@boom-busters/schemas'

/**
 * PCM in, a stored artefact out — in pure TypeScript, with no FFmpeg.
 *
 * This is the one place in the app that touches audio bytes, and it exists
 * because of a sequencing problem worth stating plainly. Design principle 2
 * says "the web layer never streams, transforms or holds a video/audio byte;
 * all media flows R2/S3 ↔ Lambda". The Lambda that principle refers to —
 * media-utils, with its FFmpeg layer — is deployed in M6. Voice is M4.
 *
 * So the choice was: hold a paragraph of narration in the Vercel function for
 * as long as it takes to write it to R2, or defer the entire voice stage until
 * M6 and reorder the milestones. This does the former, and keeps it to the
 * smallest possible surface:
 *
 *  - **Ask both vendors for raw PCM.** Then a container is a 44-byte header,
 *    the duration is a division, and the waveform is a scan — no decoder, no
 *    binary dependency, nothing that could fail on a cold start.
 *  - **The browser never gets bytes from the app.** It gets a presigned R2 URL
 *    and fetches the audio directly, which is the part of principle 2 that
 *    actually protects the web layer.
 *  - **Loudness normalisation is not done here.** It needs FFmpeg, so it stays
 *    where the spec puts it — media-utils, at -16 LUFS mono — and the voice
 *    runner records that it was skipped rather than pretending it happened.
 */

/**
 * 24 kHz mono, which is what both adapters ask for.
 *
 * It is Gemini's TTS output rate, ElevenLabs offers it as `pcm_24000`, and it
 * is comfortably above what speech needs. Fixing it here rather than per-take
 * means a project whose voice provider changed mid-way still has takes that
 * can be concatenated without a resample.
 */
export const NARRATION_SAMPLE_RATE = 24_000

const BYTES_PER_SAMPLE = 2

export function pcmDurationMs(byteLength: number, sampleRate: number, channels = 1): number {
  return Math.round((byteLength / (BYTES_PER_SAMPLE * channels) / sampleRate) * 1000)
}

/**
 * Wrap PCM in a canonical 44-byte RIFF/WAVE header.
 *
 * WAV rather than MP3 deliberately, despite the size. The takes are read by
 * Whisper for alignment and concatenated by FFmpeg at assembly (M6), and both
 * prefer uncompressed input; re-encoding narration to MP3 to save bandwidth on
 * a single-user review screen would cost quality at the one point in the
 * pipeline where quality cannot be recovered.
 */
export function encodeWav(
  pcm: Buffer,
  options: { sampleRate: number; channels?: number } = { sampleRate: NARRATION_SAMPLE_RATE },
): Buffer {
  const channels = options.channels ?? 1
  const byteRate = options.sampleRate * channels * BYTES_PER_SAMPLE
  const header = Buffer.alloc(44)

  header.write('RIFF', 0, 'ascii')
  // Everything after this field: the 36 remaining header bytes plus the data.
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')

  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // PCM fmt chunk length
  header.writeUInt16LE(1, 20) // format 1 = uncompressed PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(options.sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(channels * BYTES_PER_SAMPLE, 32) // block align
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34) // bits per sample

  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)

  return Buffer.concat([header, pcm])
}

/**
 * The waveform strip on each review row: peak amplitude per bucket, 0–100.
 *
 * **Scaled against full scale, not against the take's own loudest moment.**
 * Per-take normalisation would draw every paragraph the same height, which
 * would hide the one thing the strip is genuinely useful for before M6's
 * loudness pass exists: spotting the paragraph that came back noticeably
 * quieter or louder than its neighbours. A flat, dead-quiet take should look
 * flat and dead quiet.
 */
export function waveformPeaks(pcm: Buffer, buckets: number = WAVEFORM_BUCKETS): number[] {
  const samples = Math.floor(pcm.length / BYTES_PER_SAMPLE)
  if (samples === 0 || buckets <= 0) return []

  const width = Math.max(1, Math.ceil(samples / buckets))
  const peaks: number[] = []

  for (let start = 0; start < samples; start += width) {
    let peak = 0
    const end = Math.min(start + width, samples)

    for (let i = start; i < end; i += 1) {
      const sample = Math.abs(pcm.readInt16LE(i * BYTES_PER_SAMPLE))
      if (sample > peak) peak = sample
    }

    // 32768 is full scale for signed 16-bit; a peak of 32767 reads as 100.
    peaks.push(Math.min(100, Math.round((peak / 32_768) * 100)))
  }

  return peaks
}
