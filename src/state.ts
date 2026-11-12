import { DEFAULT_PALETTE, PALETTES } from './palettes'
import { paletteLayout, randomPoints } from './random'
import { POINT_COUNT } from './mesh/mesh'

export interface PointState {
  x: number
  y: number
  color: string // #rrggbb
}

export interface GradientState {
  width: number
  height: number
  seed: number
  lockBorder: boolean
  /** Dither amplitude in 8-bit steps */
  grain: number
  paletteId: string
  palette: string[]
  points: PointState[]
}

export type ExportFormat = 'jpeg' | 'webp' | 'png'

export interface ExportSettings {
  format: ExportFormat
  quality: number // 0-1
  scale: 1 | 2
}

export const SIZE_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '16:9 Slide · 1920 × 1080', width: 1920, height: 1080 },
  { label: '16:9 Slide 4K · 3840 × 2160', width: 3840, height: 2160 },
  { label: '1:1 Square · 1080 × 1080', width: 1080, height: 1080 },
  { label: '4:5 Portrait · 1080 × 1350', width: 1080, height: 1350 },
  { label: '9:16 Story · 1080 × 1920', width: 1080, height: 1920 },
  { label: 'Link preview · 1200 × 630', width: 1200, height: 630 },
]

export const DEFAULT_EXPORT: ExportSettings = { format: 'jpeg', quality: 0.92, scale: 1 }

export function defaultState(): GradientState {
  const palette = DEFAULT_PALETTE
  return {
    width: 1920,
    height: 1080,
    seed: 2024,
    lockBorder: true,
    grain: 1.5,
    paletteId: palette.id,
    palette: [...palette.colors],
    points: paletteLayout(palette) ?? randomPoints(palette.colors, 2024),
  }
}

// ---- (de)serialisation: JSON file and URL hash --------------------------------

const HEX = /^#[0-9a-fA-F]{6}$/
const num = (value: unknown, fallback: number, lo: number, hi: number) => {
  const n = typeof value === 'number' && isFinite(value) ? value : fallback
  return Math.min(Math.max(n, lo), hi)
}

/** Validates untrusted input (hash, file); returns null if it is not a gradient */
export function sanitizeState(input: unknown): GradientState | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (!Array.isArray(raw.points) || raw.points.length !== POINT_COUNT) return null
  const points: PointState[] = []
  for (const item of raw.points) {
    const p = item as Record<string, unknown>
    if (!p || typeof p.color !== 'string' || !HEX.test(p.color)) return null
    points.push({
      x: num(p.x, 50, -50, 150),
      y: num(p.y, 50, -50, 150),
      color: p.color.toLowerCase(),
    })
  }
  const palette = Array.isArray(raw.palette)
    ? raw.palette
        .filter((c): c is string => typeof c === 'string' && HEX.test(c))
        .map((c) => c.toLowerCase())
        .slice(0, 24)
    : []
  const known = PALETTES.some((p) => p.id === raw.paletteId)
  return {
    width: Math.round(num(raw.width, 1920, 1, 32768)),
    height: Math.round(num(raw.height, 1080, 1, 32768)),
    seed: Math.round(num(raw.seed, 0, 0, 4294967295)),
    lockBorder: raw.lockBorder !== false,
    grain: num(raw.grain, 1, 0, 8),
    paletteId: known ? (raw.paletteId as string) : 'custom',
    palette: palette.length ? palette : [...new Set(points.map((p) => p.color))],
    points,
  }
}

const round = (v: number) => Math.round(v * 100) / 100

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

/** Compact form for the URL hash: [w, h, seed, lock, grain, paletteId, palette[], points[x,y,color][]] */
export function encodeHash(state: GradientState): string {
  const compact = [
    state.width,
    state.height,
    state.seed,
    state.lockBorder ? 1 : 0,
    state.grain,
    state.paletteId,
    state.palette.map((c) => c.slice(1)),
    state.points.map((p) => [round(p.x), round(p.y), p.color.slice(1)]),
  ]
  return 'g=' + toBase64Url(JSON.stringify(compact))
}

export function decodeHash(hash: string): GradientState | null {
  const match = /^#?g=([A-Za-z0-9_-]+)$/.exec(hash)
  if (!match) return null
  try {
    const c = JSON.parse(fromBase64Url(match[1])) as unknown[]
    const points = (c[7] as unknown[][]).map((p) => ({ x: p[0], y: p[1], color: '#' + p[2] }))
    return sanitizeState({
      width: c[0],
      height: c[1],
      seed: c[2],
      lockBorder: c[3] === 1,
      grain: c[4],
      paletteId: c[5],
      palette: (c[6] as string[]).map((h) => '#' + h),
      points,
    })
  } catch {
    return null
  }
}

export function toJsonFile(state: GradientState, exportSettings: ExportSettings): string {
  return JSON.stringify(
    { app: 'mesh-gradient-tool', version: 1, gradient: state, export: exportSettings },
    null,
    2,
  )
}

export function fromJsonFile(
  text: string,
): { state: GradientState; export?: Partial<ExportSettings> } | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown>
    const state = sanitizeState(data.gradient ?? data)
    if (!state) return null
    const e = data.export as Partial<ExportSettings> | undefined
    return { state, export: e && typeof e === 'object' ? e : undefined }
  } catch {
    return null
  }
}
