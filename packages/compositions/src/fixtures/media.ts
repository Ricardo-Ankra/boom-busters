/**
 * Deterministic fixture media, generated in code — no binary files in the
 * repo, no network in Studio or snapshot tests. Images are inline SVG data
 * URIs; audio is a base64 WAV of silence.
 */

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** A moody documentary-ish frame: skyline bars against a dusk gradient. */
export const FIXTURE_IMAGE_SKYLINE = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">` +
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#1a2033"/><stop offset="0.7" stop-color="#3d2f3a"/>` +
    `<stop offset="1" stop-color="#59372e"/></linearGradient></defs>` +
    `<rect width="1920" height="1080" fill="url(#sky)"/>` +
    `<g fill="#0d1017">` +
    `<rect x="120" y="520" width="140" height="560"/><rect x="300" y="420" width="180" height="660"/>` +
    `<rect x="530" y="580" width="120" height="500"/><rect x="700" y="360" width="220" height="720"/>` +
    `<rect x="980" y="470" width="150" height="610"/><rect x="1180" y="300" width="200" height="780"/>` +
    `<rect x="1430" y="520" width="160" height="560"/><rect x="1650" y="430" width="150" height="650"/>` +
    `</g>` +
    `<circle cx="1500" cy="230" r="90" fill="#e8b26a" opacity="0.85"/>` +
    `</svg>`,
)

/** A second frame so consecutive slots visibly change: a harbour at night. */
export const FIXTURE_IMAGE_HARBOUR = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">` +
    `<rect width="1920" height="1080" fill="#0c1220"/>` +
    `<rect y="700" width="1920" height="380" fill="#0a0e18"/>` +
    `<g stroke="#2c4a6e" stroke-width="14"><line x1="200" y1="700" x2="380" y2="360"/>` +
    `<line x1="820" y1="700" x2="1000" y2="300"/><line x1="1500" y1="700" x2="1620" y2="420"/></g>` +
    `<g fill="#e8b26a" opacity="0.7"><circle cx="380" cy="350" r="16"/>` +
    `<circle cx="1000" cy="290" r="16"/><circle cx="1620" cy="410" r="16"/></g>` +
    `</svg>`,
)

/** One second of 8 kHz mono silence as a data URI — fixture narration/music. */
export function silentWavDataUri(): string {
  const sampleRate = 8000
  const numSamples = sampleRate
  const dataSize = numSamples * 2
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataSize, true)

  let binary = ''
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }
  return `data:audio/wav;base64,${btoa(binary)}`
}

export const FIXTURE_AUDIO_SILENCE = silentWavDataUri()
