import type { Palette } from './palettes'
import { GRID, POINT_COUNT } from './mesh/mesh'
import type { PointState } from './state'

/** Small seeded PRNG, so a seed always reproduces the same layout */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const newSeed = () => Math.floor(Math.random() * 1_000_000)

/** Even grid with jittered interior, a dominant base colour and a few accent colours */
export function randomPoints(colors: string[], seed: number): PointState[] {
  const rand = mulberry32(seed)
  const base = colors[0] ?? '#888888'
  const accents = colors.length > 1 ? colors.slice(1) : [base]
  const step = 100 / (GRID - 1)
  const points: PointState[] = []

  for (let index = 0; index < POINT_COUNT; index++) {
    const col = index % GRID
    const row = Math.floor(index / GRID)
    const edgeX = col === 0 || col === GRID - 1
    const edgeY = row === 0 || row === GRID - 1
    const jitter = (amount: number) => (rand() * 2 - 1) * amount
    points.push({
      x: edgeX ? col * step : col * step + jitter(10),
      y: edgeY ? row * step : row * step + jitter(10),
      color: base,
    })
  }

  // A few accent points make the colour blobs; the rest keeps the base colour
  const accentCount = 5 + Math.floor(rand() * 5)
  const order = [...points.keys()].sort(() => rand() - 0.5)
  for (const index of order.slice(0, accentCount)) {
    points[index].color = accents[Math.floor(rand() * accents.length)]
  }
  return points
}

export function paletteLayout(palette: Palette): PointState[] | null {
  if (!palette.layout) return null
  return palette.layout.map(([x, y, colorIndex]) => ({
    x,
    y,
    color: palette.colors[colorIndex] ?? palette.colors[0],
  }))
}
