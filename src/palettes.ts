/**
 * Palettes. To add one, append an entry below:
 *  - `colors`: hex colours; the first one is the dominant base of random layouts
 *  - `layout` (optional): a hand-made arrangement, one entry per grid point in
 *    row-major order: [x %, y %, index into `colors`]. Without it, the preset
 *    is laid out by the seeded randomizer.
 */
export interface Palette {
  id: string
  name: string
  colors: string[]
  layout?: [x: number, y: number, colorIndex: number][]
}

export const PALETTES: Palette[] = [
  {
    id: 'galvany',
    name: 'GALVANY Brand',
    // neutral-200, secondary-600, primary-700, primary-100, amber
    colors: ['#E8E8EE', '#FFC474', '#FF432B', '#FFD8DE', '#FFA31B'],
    layout: [
      [0, 0, 0], [33, 0, 0], [67, 0, 1], [100, 0, 0],
      [0, 33, 0], [33, 33, 0], [84, 52, 2], [100, 30, 0],
      [0, 67, 0], [33, 70, 0], [76, 92, 0], [100, 74, 4],
      [0, 100, 3], [33, 100, 0], [66, 100, 0], [100, 100, 0],
    ],
  },
]

export const DEFAULT_PALETTE = PALETTES[0]
