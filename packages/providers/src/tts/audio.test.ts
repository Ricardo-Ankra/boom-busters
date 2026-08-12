import { describe, expect, it } from 'vitest'
import { encodeWav, NARRATION_SAMPLE_RATE, pcmDurationMs, waveformPeaks } from './audio'

/** A second of a full-scale square-ish wave, for peaks that are easy to reason about. */
function pcm(samples: number[]): Buffer {
  const buffer = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, index * 2))
  return buffer
}

describe('pcmDurationMs', () => {
  it('reads a duration from the byte count', () => {
    // One second at 24 kHz, 16-bit mono = 48,000 bytes.
    expect(pcmDurationMs(48_000, NARRATION_SAMPLE_RATE)).toBe(1000)
  })

  it('accounts for channels', () => {
    expect(pcmDurationMs(96_000, NARRATION_SAMPLE_RATE, 2)).toBe(1000)
  })

  it('is zero for no audio, rather than NaN', () => {
    expect(pcmDurationMs(0, NARRATION_SAMPLE_RATE)).toBe(0)
  })
})

describe('encodeWav', () => {
  const audio = pcm([0, 1000, -1000, 0])
  const wav = encodeWav(audio, { sampleRate: NARRATION_SAMPLE_RATE })

  it('writes a 44-byte canonical header and keeps the samples intact', () => {
    expect(wav.length).toBe(44 + audio.length)
    expect(wav.subarray(44)).toEqual(audio)
  })

  it('declares RIFF/WAVE with a PCM fmt chunk', () => {
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ')
    expect(wav.readUInt32LE(16)).toBe(16)
    expect(wav.readUInt16LE(20)).toBe(1) // uncompressed
  })

  /**
   * The two length fields are what a player trusts. Getting either wrong
   * produces audio that plays and then cuts off, which is the kind of bug that
   * survives a listen-through of the first paragraph.
   */
  it('sets both length fields consistently', () => {
    expect(wav.readUInt32LE(4)).toBe(36 + audio.length)
    expect(wav.toString('ascii', 36, 40)).toBe('data')
    expect(wav.readUInt32LE(40)).toBe(audio.length)
  })

  it('derives byte rate and block align from the format', () => {
    expect(wav.readUInt16LE(22)).toBe(1) // channels
    expect(wav.readUInt32LE(24)).toBe(NARRATION_SAMPLE_RATE)
    expect(wav.readUInt32LE(28)).toBe(NARRATION_SAMPLE_RATE * 2)
    expect(wav.readUInt16LE(32)).toBe(2)
    expect(wav.readUInt16LE(34)).toBe(16)
  })

  it('handles stereo, even though narration is mono', () => {
    const stereo = encodeWav(audio, { sampleRate: 48_000, channels: 2 })
    expect(stereo.readUInt16LE(22)).toBe(2)
    expect(stereo.readUInt32LE(28)).toBe(48_000 * 2 * 2)
    expect(stereo.readUInt16LE(32)).toBe(4)
  })

  it('produces a valid empty file rather than throwing on silence', () => {
    const empty = encodeWav(Buffer.alloc(0), { sampleRate: NARRATION_SAMPLE_RATE })
    expect(empty.length).toBe(44)
    expect(empty.readUInt32LE(40)).toBe(0)
  })
})

describe('waveformPeaks', () => {
  it('scales against full scale, not against the take itself', () => {
    // A quiet take must look quiet — that is the whole point of the strip
    // before M6's loudness pass exists.
    const quiet = waveformPeaks(pcm(Array.from({ length: 100 }, () => 3_276)), 4)
    expect(quiet.every((peak) => peak === 10)).toBe(true)

    const loud = waveformPeaks(pcm(Array.from({ length: 100 }, () => 32_767)), 4)
    expect(loud.every((peak) => peak === 100)).toBe(true)
  })

  it('takes the peak of each bucket, not its average', () => {
    // One loud sample in an otherwise silent bucket is a transient, and hiding
    // it would hide exactly the pops a review is meant to catch.
    expect(waveformPeaks(pcm([0, 0, 0, 32_767]), 1)).toEqual([100])
  })

  it('uses the absolute value, so a negative trough is not read as silence', () => {
    expect(waveformPeaks(pcm([-32_768, 0]), 1)).toEqual([100])
  })

  it('never returns more buckets than asked for', () => {
    const peaks = waveformPeaks(pcm(Array.from({ length: 1_000 }, () => 100)), 16)
    expect(peaks.length).toBeLessThanOrEqual(16)
  })

  it('returns nothing for empty audio', () => {
    expect(waveformPeaks(Buffer.alloc(0))).toEqual([])
    expect(waveformPeaks(pcm([1, 2, 3]), 0)).toEqual([])
  })

  it('draws silence as a flat zero line rather than as nothing', () => {
    expect(waveformPeaks(pcm(Array.from({ length: 64 }, () => 0)), 4)).toEqual([0, 0, 0, 0])
  })
})
