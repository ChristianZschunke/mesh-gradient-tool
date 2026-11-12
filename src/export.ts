import { MeshRenderer, getMeshLimits, hexToRgb, type MeshParams } from './mesh/mesh'
import type { ExportFormat, ExportSettings, GradientState } from './state'

export const MIME: Record<ExportFormat, string> = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  png: 'image/png',
}
export const EXTENSION: Record<ExportFormat, string> = { jpeg: 'jpg', webp: 'webp', png: 'png' }

export function toMeshParams(state: GradientState): MeshParams {
  return {
    points: state.points.map((p) => ({ x: p.x, y: p.y, color: hexToRgb(p.color) })),
    lockBorder: state.lockBorder,
    grain: state.grain,
    seed: state.seed,
  }
}

/** Returns an error message when the output size cannot be produced, else null */
export function checkSize(width: number, height: number): string | null {
  const limits = getMeshLimits()
  if (!limits) return 'WebGL2 is not available in this browser.'
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return 'Width and height must be whole numbers of at least 1 px.'
  }
  if (width > limits.maxSide || height > limits.maxSide) {
    return `Too large: this browser/GPU renders at most ${limits.maxSide} px per side.`
  }
  if (width * height > 268_000_000) {
    return 'Too large: more than 268 megapixels cannot be encoded.'
  }
  return null
}

/** Draws a 2D canvas of the given size and checks that the browser really allocated it */
function createOutputCanvas(width: number, height: number) {
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d', { alpha: false })
  if (!ctx) return null
  ctx.fillStyle = '#fff'
  ctx.fillRect(width - 1, height - 1, 1, 1)
  // Browsers silently hand out dead canvases above their area limit (e.g. Safari)
  if (ctx.getImageData(width - 1, height - 1, 1, 1).data[3] !== 255) return null
  return { out, ctx }
}

/**
 * Renders a fresh frame at the target size on an offscreen canvas and encodes it.
 * The GL canvas is copied into a 2D canvas in the same task as the draw, so the
 * (cleared-after-present) WebGL back buffer is never read late.
 */
export async function renderToBlob(
  state: GradientState,
  settings: ExportSettings,
): Promise<{ blob: Blob; width: number; height: number }> {
  const width = state.width * settings.scale
  const height = state.height * settings.scale
  const problem = checkSize(width, height)
  if (problem) throw new Error(problem)

  const target = createOutputCanvas(width, height)
  if (!target) {
    throw new Error(
      `This browser cannot allocate a ${width} × ${height} canvas. Try a smaller size or 1x scale.`,
    )
  }

  const glCanvas = document.createElement('canvas')
  glCanvas.width = width
  glCanvas.height = height
  const renderer = new MeshRenderer(glCanvas)
  try {
    renderer.render(toMeshParams(state))
    target.ctx.drawImage(glCanvas, 0, 0)
  } finally {
    renderer.dispose()
  }

  const mime = MIME[settings.format]
  const blob = await new Promise<Blob | null>((resolve) =>
    target.out.toBlob(resolve, mime, settings.format === 'png' ? undefined : settings.quality),
  )
  if (!blob) throw new Error('The browser could not encode the image (size too large?).')
  if (blob.type !== mime) {
    throw new Error(`This browser cannot encode ${settings.format.toUpperCase()} (it produced ${blob.type}).`)
  }
  return { blob, width, height }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
