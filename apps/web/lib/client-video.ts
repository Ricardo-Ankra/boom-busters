import { denseFrameTimes, overviewFrameTimes } from '@boom-busters/schemas'

/**
 * Frames taken from a clip in the owner's browser (spec 2026-11-04, section
 * 7.2). The browser decodes the video; the server never does, because the
 * app's Chromium build is not assumed to decode H.264 and the scrubber is the
 * marking UI anyway. The seek and the draw are behind `FrameGrabber` so jsdom
 * can stand in for them; the clocks, the sizes and the sequencing run for real.
 */

/** A frame's size once its width is held to `maxWidth`: never enlarged, both sides even. */
export function fittedWidth(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  const scale = width > maxWidth ? maxWidth / width : 1
  const even = (value: number) => Math.max(2, Math.floor((value * scale) / 2) * 2)
  return { width: even(width), height: even(height) }
}

export interface FrameGrabber {
  seek(atMs: number): Promise<void>
  draw(size: { width: number; height: number }): Promise<Blob>
}

/** How long a seek may take before the clip is judged stuck. */
const SEEK_MAX_MS = 5000
const FRAME_JPEG_QUALITY = 0.85

/** The real browser's grabber: a `<video>` seeked and painted to a canvas. */
export function browserGrabber(video: HTMLVideoElement, canvas: HTMLCanvasElement): FrameGrabber {
  return {
    seek(atMs) {
      return new Promise((resolve, reject) => {
        const target = atMs / 1000
        const timer = setTimeout(() => {
          video.removeEventListener('seeked', done)
          reject(new Error(`the clip did not seek to ${target.toFixed(2)} s`))
        }, SEEK_MAX_MS)
        const done = () => {
          clearTimeout(timer)
          resolve()
        }
        video.addEventListener('seeked', done, { once: true })
        video.currentTime = target
      })
    },
    draw(size) {
      canvas.width = size.width
      canvas.height = size.height
      const context = canvas.getContext('2d')
      if (!context) return Promise.reject(new Error('the browser gave no canvas to draw on'))
      context.drawImage(video, 0, 0, size.width, size.height)
      return new Promise((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('the frame could not be encoded'))),
          'image/jpeg',
          FRAME_JPEG_QUALITY,
        ),
      )
    },
  }
}

export interface GrabbedFrame {
  atMs: number
  blob: Blob
  width: number
  height: number
}

/**
 * One frame per time, in order. A seek that fails stops the grab and the
 * error says how many frames were taken, so the marker can refuse to save a
 * partial set and the owner can choose another window.
 */
export async function grabFrames(
  grabber: FrameGrabber,
  times: readonly number[],
  size: { width: number; height: number },
  onProgress?: (done: number, total: number) => void,
): Promise<GrabbedFrame[]> {
  const frames: GrabbedFrame[] = []
  for (const atMs of times) {
    try {
      await grabber.seek(atMs)
      const blob = await grabber.draw(size)
      frames.push({ atMs, blob, width: size.width, height: size.height })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Only ${frames.length} of ${times.length} frames could be taken (${reason}); choose another window`,
      )
    }
    onProgress?.(frames.length, times.length)
  }
  return frames
}

/** A clip's length and size, read from its metadata on an object URL. */
export function readVideoMeta(
  file: File,
): Promise<{ durationMs: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    const finish = () => URL.revokeObjectURL(url)
    video.addEventListener(
      'loadedmetadata',
      () => {
        finish()
        resolve({
          durationMs: Math.round(video.duration * 1000),
          width: video.videoWidth,
          height: video.videoHeight,
        })
      },
      { once: true },
    )
    video.addEventListener(
      'error',
      () => {
        finish()
        reject(new Error('The browser could not read that clip.'))
      },
      { once: true },
    )
    video.src = url
  })
}

/** The two frame sets a clip's reference needs: the browser takes them, the finalise recomputes them. */
export function referenceFrameSets(
  window: { startMs: number; endMs: number },
  durationMs: number,
): { dense: number[]; overview: number[] } {
  return {
    dense: denseFrameTimes(window.startMs, window.endMs),
    overview: overviewFrameTimes(durationMs),
  }
}
