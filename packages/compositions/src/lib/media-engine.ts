import { getRemotionEnvironment } from 'remotion'

/**
 * Which media engine a tag should use (decision 156).
 *
 * Offline, the render keeps the core tags: `OffthreadVideo` extracts frames
 * server-side and `<Audio>` is mixed by the renderer — the pixel goldens
 * pin that path and it has shipped every master so far.
 *
 * In the @remotion/player those same tags are HTML5 media elements kept in
 * sync by corrective seeking (video, 0.45 s drift threshold) and a pool of
 * five shared audio tags whose src is swapped at every Sequence boundary.
 * With 37 narration paragraphs and 50-odd slots, every swap and every
 * corrective seek is a small audible or visible glitch — the residue that
 * survived premounting, half-resolution and full buffering. @remotion/media
 * decodes with WebCodecs instead: video painted frame-exact onto a canvas,
 * audio scheduled sample-accurately through Web Audio, buffer-state
 * integration by default, and automatic fallback to the core tags when a
 * codec, CORS or the browser refuses.
 */
export function mediaEngine(): 'core-tags' | 'webcodecs' {
  return getRemotionEnvironment().isRendering ? 'core-tags' : 'webcodecs'
}
