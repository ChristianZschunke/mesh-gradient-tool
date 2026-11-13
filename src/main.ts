import './style.css'
import { MAX_FREE_HANDLES, MeshRenderer, effectivePosition, getMeshLimits, POINT_COUNT } from './mesh/mesh'
import { PALETTES } from './palettes'
import { newSeed, paletteLayout, randomHandles, randomPoints } from './random'
import {
  DEFAULT_EXPORT,
  SIZE_PRESETS,
  decodeHash,
  defaultState,
  encodeHash,
  fromJsonFile,
  sanitizeState,
  toJsonFile,
  type ExportFormat,
  type ExportSettings,
  type GradientState,
} from './state'
import { EXTENSION, checkSize, download, renderToBlob, toMeshParams } from './export'

// ---- state --------------------------------------------------------------------

let state: GradientState = decodeHash(location.hash) ?? defaultState()
let exportSettings: ExportSettings = { ...DEFAULT_EXPORT }
let selected = 0

// ---- DOM ----------------------------------------------------------------------

const app = document.getElementById('app')!
app.innerHTML = `
<div class="app">
  <div class="stage" id="stage">
    <div class="frame" id="frame">
      <canvas id="canvas"></canvas>
      <div class="handles" id="handles"></div>
      <div class="handles off" id="freeHandles"></div>
    </div>
    <div class="size-badge" id="badge"></div>
    <button class="drawer-toggle" id="drawerToggle">Gradients</button>
  </div>
  <aside class="panel">
    <header>
      <h1>Mesh Gradient Tool</h1>
      <button id="theme" title="Switch colour scheme" aria-label="Switch colour scheme">Theme</button>
    </header>

    <section>
      <h2>Size</h2>
      <div class="row"><select id="sizePreset"></select></div>
      <div class="row">
        <input type="number" id="width" min="1" step="1" aria-label="Width in px" />
        <span>×</span>
        <input type="number" id="height" min="1" step="1" aria-label="Height in px" />
      </div>
      <p class="hint" id="sizeHint"></p>
    </section>

    <section>
      <h2>Mode</h2>
      <div class="seg" id="mode">
        <button data-v="mesh">Mesh 4×4</button><button data-v="free">Free (experimental)</button>
      </div>
      <p class="hint" id="modeHint"></p>
    </section>

    <section id="freeSection" hidden>
      <h2>Free handle</h2>
      <div class="row">
        <label for="freeColor" id="freeLabel">Handle 1</label>
        <input type="color" id="freeColor" />
        <input type="range" id="freeRadius" min="4" max="90" step="1" class="grow" aria-label="Radius of influence" />
        <span class="value" id="freeRadiusValue"></span>
      </div>
      <div class="row">
        <button id="freeDelete" class="grow">Delete handle</button>
        <label class="inline"><input type="color" id="freeBase" /> Background</label>
      </div>
      <div class="checks">
        <label><input type="checkbox" id="warp" /> Dragging also warps the surface</label>
        <label><input type="checkbox" id="lockFree" /> Lock border</label>
      </div>
      <p class="hint">Double-click empty space to add a handle, right-click a handle to remove it, double-click a handle to pick a palette colour. Middle-drag a handle to change its radius of influence (the ring).</p>
    </section>

    <section>
      <h2>Colours</h2>
      <div class="swatches" id="swatches"></div>
      <div class="row">
        <label for="seed">Seed</label>
        <input type="number" id="seed" min="0" step="1" class="grow" />
        <button id="randomize" title="Random layout from the current palette">Randomize</button>
      </div>
      <p class="hint">Click a swatch to paint the selected point. The seed reproduces a randomized layout.</p>
    </section>

    <section id="meshSection">
      <h2>Selected point</h2>
      <div class="row">
        <label for="pointColor" id="pointLabel">Point 1</label>
        <input type="color" id="pointColor" />
        <input type="number" id="pointX" step="0.5" aria-label="X in percent" class="grow" />
        <input type="number" id="pointY" step="0.5" aria-label="Y in percent" class="grow" />
      </div>
      <div class="checks">
        <label><input type="checkbox" id="lock" /> Lock border (corners fixed, edges slide)</label>
        <label><input type="checkbox" id="showHandles" checked /> Show handles</label>
      </div>
    </section>

    <section>
      <h2>Flip</h2>
      <div class="row">
        <button id="flipH" class="grow">Flip horizontal</button>
        <button id="flipV" class="grow">Flip vertical</button>
      </div>
    </section>

    <section>
      <h2>Grain</h2>
      <div class="row">
        <input type="range" id="grain" min="0" max="4" step="0.1" aria-label="Grain" />
        <span class="value" id="grainValue"></span>
      </div>
      <p class="hint">Dither noise (in 8-bit steps) that hides banding in JPG/WebP.</p>
    </section>

    <section>
      <h2>Export</h2>
      <div class="row">
        <div class="seg" id="format">
          <button data-v="jpeg">JPG</button><button data-v="webp">WebP</button><button data-v="png">PNG</button>
        </div>
      </div>
      <div class="row" id="qualityRow">
        <label for="quality">Quality</label>
        <input type="range" id="quality" min="0.5" max="1" step="0.01" />
        <span class="value" id="qualityValue"></span>
      </div>
      <div class="row">
        <label>Scale</label>
        <div class="seg" id="scale"><button data-v="1">1x</button><button data-v="2">2x</button></div>
      </div>
      <div class="row"><button class="primary" id="export">Export image</button></div>
      <div class="status" id="status" role="status"></div>
    </section>

    <section>
      <h2>Save &amp; share</h2>
      <div class="row">
        <button id="copyLink" class="grow">Copy link</button>
        <button id="saveJson" class="grow">Save JSON</button>
        <button id="loadJson" class="grow">Load JSON</button>
      </div>
      <input type="file" id="file" accept="application/json,.json" hidden />
    </section>
  </aside>
  <aside class="side" id="side" aria-label="Gradients">
    <div class="side-head">
      <div class="tabs" id="tabs" role="tablist">
        <button role="tab" data-tab="starter" aria-selected="true">Starter</button>
        <button role="tab" data-tab="mine" aria-selected="false">Mine</button>
      </div>
      <button class="small drawer-close" id="drawerClose" aria-label="Close">×</button>
    </div>
    <div class="side-body" id="gallery"></div>
    <input type="file" id="presetFile" accept="application/json,.json" hidden />
  </aside>
</div>`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const stage = $('stage')
const frame = $('frame')
const canvas = $<HTMLCanvasElement>('canvas')
const handlesEl = $('handles')
const statusEl = $('status')

let resultUrl = ''
/** Keeps a manual download/open link, in case the browser blocks the automatic download */
function showResult(blob: Blob, name: string) {
  if (resultUrl) URL.revokeObjectURL(resultUrl)
  resultUrl = URL.createObjectURL(blob)
  statusEl.className = 'status ok'
  statusEl.textContent = `${name} · ${(blob.size / 1024).toFixed(0)} KB. `
  const save = document.createElement('a')
  save.href = resultUrl
  save.download = name
  save.textContent = 'Save again'
  const open = document.createElement('a')
  open.href = resultUrl
  open.target = '_blank'
  open.rel = 'noopener'
  open.textContent = 'Open in new tab'
  statusEl.append(save, ' · ', open)
}

function setStatus(text: string, kind: 'ok' | 'err' | '' = '') {
  statusEl.textContent = text
  statusEl.className = 'status ' + kind
}

// ---- renderer + preview -------------------------------------------------------

let renderer: MeshRenderer | null = null
try {
  renderer = new MeshRenderer(canvas, { onRestore: () => scheduleRender() })
} catch (error) {
  stage.innerHTML = `<div class="fallback"><h2>WebGL2 is required</h2><p>${
    (error as Error).message
  }. Try a current version of Chrome, Edge, Firefox or Safari.</p></div>`
}

const PREVIEW_MAX = 2048
let renderQueued = false
function scheduleRender() {
  if (renderQueued) return
  renderQueued = true
  requestAnimationFrame(() => {
    renderQueued = false
    if (!renderer) return
    // Gradient is resolution independent; only the grain pattern depends on pixels
    const k = Math.min(1, PREVIEW_MAX / Math.max(state.width, state.height))
    const w = Math.max(1, Math.round(state.width * k))
    const h = Math.max(1, Math.round(state.height * k))
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    renderer.render(toMeshParams(state))
  })
}

function fitFrame() {
  if (!renderer) return
  const pad = 56
  const maxW = Math.max(120, stage.clientWidth - pad * 2)
  const maxH = Math.max(120, stage.clientHeight - pad * 2)
  const scale = Math.min(maxW / state.width, maxH / state.height)
  frame.style.width = `${Math.round(state.width * scale)}px`
  frame.style.height = `${Math.round(state.height * scale)}px`
  $('badge').textContent = `${state.width} × ${state.height}`
}
new ResizeObserver(fitFrame).observe(stage)

// ---- handles ------------------------------------------------------------------

// Double click a handle: palette swatches pop up next to it
let popover: HTMLDivElement | null = null
function closeColorPopover() {
  popover?.remove()
  popover = null
}
function openColorPopover(
  x: number,
  y: number,
  current: string,
  onPick: (color: string) => void,
  parent: HTMLElement,
) {
  closeColorPopover()
  const box = document.createElement('div')
  box.className = 'color-popover'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'Pick a colour for this point')
  box.style.left = `${Math.min(Math.max(x, 12), 88)}%`
  box.style.top = `${y}%`
  // Above the handle, or below when it sits near the top edge
  box.dataset.placement = y < 22 ? 'below' : 'above'
  state.palette.forEach((color) => {
    const swatch = document.createElement('button')
    swatch.className = 'pop-swatch'
    swatch.style.background = color
    swatch.title = color.toUpperCase()
    swatch.setAttribute('aria-label', `Use ${color}`)
    swatch.setAttribute('aria-pressed', String(color.toLowerCase() === current.toLowerCase()))
    swatch.addEventListener('click', () => {
      closeColorPopover()
      onPick(color.toLowerCase())
    })
    box.appendChild(swatch)
  })
  parent.appendChild(box)
  popover = box
  ;(box.firstElementChild as HTMLElement | null)?.focus()
}
document.addEventListener('pointerdown', (event) => {
  if (popover && !popover.contains(event.target as Node)) closeColorPopover()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeColorPopover()
})

const handleButtons: HTMLButtonElement[] = []
for (let i = 0; i < POINT_COUNT; i++) {
  const button = document.createElement('button')
  button.className = 'handle'
  button.setAttribute('aria-label', `Control point ${i + 1}`)
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    select(i)
    button.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent) => {
      const rect = frame.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100
      const [px, py] = effectivePosition(i, x, y, state.lockBorder)
      state.points[i].x = Math.round(px * 100) / 100
      state.points[i].y = Math.round(py * 100) / 100
      onChange({ palette: false })
    }
    const up = () => {
      button.removeEventListener('pointermove', move)
      button.removeEventListener('pointerup', up)
      button.removeEventListener('pointercancel', up)
    }
    button.addEventListener('pointermove', move)
    button.addEventListener('pointerup', up)
    button.addEventListener('pointercancel', up)
  })
  button.addEventListener('keydown', (event) => {
    const d = event.shiftKey ? 5 : 1
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-d, 0],
      ArrowRight: [d, 0],
      ArrowUp: [0, -d],
      ArrowDown: [0, d],
    }
    const move = delta[event.key]
    if (!move) return
    event.preventDefault()
    const p = state.points[i]
    const [px, py] = effectivePosition(i, p.x + move[0], p.y + move[1], state.lockBorder)
    p.x = px
    p.y = py
    onChange({ palette: false })
  })
  button.addEventListener('dblclick', (event) => {
    event.preventDefault()
    select(i)
    const p = state.points[i]
    const [px, py] = effectivePosition(i, p.x, p.y, state.lockBorder)
    openColorPopover(px, py, p.color, (color) => {
      state.points[i].color = color
      onChange({ palette: false })
    }, handlesEl)
  })
  handlesEl.appendChild(button)
  handleButtons.push(button)
}

function syncHandles() {
  handleButtons.forEach((button, i) => {
    const p = state.points[i]
    const [x, y] = effectivePosition(i, p.x, p.y, state.lockBorder)
    button.style.left = `${x}%`
    button.style.top = `${y}%`
    button.style.background = p.color
    button.classList.toggle('selected', i === selected)
  })
}

function select(i: number) {
  selected = i
  syncHandles()
  syncPoint()
}

// ---- experimental free mode: handles ------------------------------------------

const freeHandlesEl = $('freeHandles')
const freeButtons: HTMLButtonElement[] = []
let selectedFree = 0
const freeRing = document.createElement('div')
freeRing.className = 'ring'
freeHandlesEl.appendChild(freeRing)

const toHex = (c: [number, number, number]) =>
  '#' +
  c
    .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0'))
    .join('')

function pointerPercent(e: { clientX: number; clientY: number }) {
  const rect = frame.getBoundingClientRect()
  return [
    Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)),
    Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)),
  ] as const
}

function moveFreeHandle(i: number, x: number, y: number) {
  const h = state.handles[i]
  if (!h) return
  h.x = Math.round(x * 100) / 100
  h.y = Math.round(y * 100) / 100
  // Without warp the handle only moves its colour blob: the rest position follows
  if (!state.warp) {
    h.x0 = h.x
    h.y0 = h.y
  }
  onChange({ palette: false })
}

function removeFreeHandle(i: number) {
  if (state.handles.length <= 1) return setStatus('Keep at least one handle.', 'err')
  state.handles.splice(i, 1)
  selectedFree = Math.min(selectedFree, state.handles.length - 1)
  onChange({ palette: false })
}

function createFreeButton(i: number) {
  const button = document.createElement('button')
  button.className = 'handle free'
  button.setAttribute('aria-label', `Free handle ${i + 1}`)
  // Middle button: stop the browser's autoscroll
  button.addEventListener('mousedown', (event) => {
    if (event.button === 1) event.preventDefault()
  })
  button.addEventListener('pointerdown', (event) => {
    if (event.button === 1) {
      // Middle-drag resizes the radius: the ring follows the pointer
      event.preventDefault()
      selectFree(i)
      button.setPointerCapture(event.pointerId)
      const resize = (e: PointerEvent) => {
        const h = state.handles[i]
        const rect = frame.getBoundingClientRect()
        const cx = rect.left + (h.x / 100) * rect.width
        const cy = rect.top + (h.y / 100) * rect.height
        const radius = (Math.hypot(e.clientX - cx, e.clientY - cy) / rect.height) * 100
        h.radius = Math.round(Math.min(90, Math.max(4, radius)) * 10) / 10
        onChange({ palette: false })
      }
      const end = () => {
        button.removeEventListener('pointermove', resize)
        button.removeEventListener('pointerup', end)
        button.removeEventListener('pointercancel', end)
      }
      button.addEventListener('pointermove', resize)
      button.addEventListener('pointerup', end)
      button.addEventListener('pointercancel', end)
      return
    }
    if (event.button !== 0) return
    event.preventDefault()
    selectFree(i)
    button.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent) => {
      const [x, y] = pointerPercent(e)
      moveFreeHandle(i, x, y)
    }
    const up = () => {
      button.removeEventListener('pointermove', move)
      button.removeEventListener('pointerup', up)
      button.removeEventListener('pointercancel', up)
    }
    button.addEventListener('pointermove', move)
    button.addEventListener('pointerup', up)
    button.addEventListener('pointercancel', up)
  })
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    removeFreeHandle(i)
  })
  button.addEventListener('keydown', (event) => {
    const d = event.shiftKey ? 5 : 1
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-d, 0],
      ArrowRight: [d, 0],
      ArrowUp: [0, -d],
      ArrowDown: [0, d],
    }
    const step = delta[event.key]
    if (event.key === 'Delete') return removeFreeHandle(i)
    if (!step) return
    event.preventDefault()
    const h = state.handles[i]
    moveFreeHandle(i, Math.min(100, Math.max(0, h.x + step[0])), Math.min(100, Math.max(0, h.y + step[1])))
  })
  button.addEventListener('dblclick', (event) => {
    event.preventDefault()
    event.stopPropagation()
    selectFree(i)
    const h = state.handles[i]
    openColorPopover(h.x, h.y, h.color, (color) => {
      state.handles[i].color = color
      onChange({ palette: false })
    }, freeHandlesEl)
  })
  freeHandlesEl.appendChild(button)
  freeButtons.push(button)
}

// Double click on empty space adds a handle that starts with the colour currently shown there
freeHandlesEl.addEventListener('dblclick', (event) => {
  if (state.mode !== 'free' || event.target !== freeHandlesEl || !renderer) return
  if (state.handles.length >= MAX_FREE_HANDLES) {
    return setStatus(`At most ${MAX_FREE_HANDLES} handles.`, 'err')
  }
  const [x, y] = pointerPercent(event)
  const color = toHex(renderer.sample(toMeshParams(state), x / 100, y / 100))
  state.handles.push({ x0: x, y0: y, x, y, radius: 28, color })
  selectedFree = state.handles.length - 1
  onChange({ palette: false })
})

function selectFree(i: number) {
  selectedFree = i
  onChange({ palette: false })
}

function syncFreeHandles() {
  while (freeButtons.length > state.handles.length) freeButtons.pop()!.remove()
  while (freeButtons.length < state.handles.length) createFreeButton(freeButtons.length)
  freeButtons.forEach((button, i) => {
    const h = state.handles[i]
    button.style.left = `${h.x}%`
    button.style.top = `${h.y}%`
    button.style.background = h.color
    button.classList.toggle('selected', i === selectedFree)
  })
  const sel = state.handles[selectedFree]
  freeRing.style.display = state.mode === 'free' && sel ? 'block' : 'none'
  if (sel) {
    // The influenced area travels with the handle, so the ring sits on the current position
    freeRing.style.left = `${sel.x}%`
    freeRing.style.top = `${sel.y}%`
    freeRing.style.height = `${sel.radius * 2}%`
  }
}

// ---- experimental free mode: panel --------------------------------------------

const freeColor = $<HTMLInputElement>('freeColor')
const freeRadius = $<HTMLInputElement>('freeRadius')
freeColor.addEventListener('input', () => {
  if (state.handles[selectedFree]) state.handles[selectedFree].color = freeColor.value.toLowerCase()
  onChange({ palette: false, freeInputs: false })
})
freeRadius.addEventListener('input', () => {
  if (state.handles[selectedFree]) state.handles[selectedFree].radius = Number(freeRadius.value)
  onChange({ palette: false, freeInputs: false })
})
$('freeDelete').addEventListener('click', () => removeFreeHandle(selectedFree))
$<HTMLInputElement>('freeBase').addEventListener('input', (event) => {
  state.base = (event.target as HTMLInputElement).value.toLowerCase()
  onChange({ palette: false, freeInputs: false })
})
$<HTMLInputElement>('warp').addEventListener('change', (event) => {
  state.warp = (event.target as HTMLInputElement).checked
  onChange({ palette: false })
})
$<HTMLInputElement>('lockFree').addEventListener('change', (event) => {
  state.lockBorder = (event.target as HTMLInputElement).checked
  onChange({ palette: false })
})

/** Free mode needs handles: create them from the palette when switching for the first time */
function regenFree() {
  if (state.mode !== 'free') return
  state.handles = randomHandles(state.palette, state.seed)
  state.base = state.palette[0]
  selectedFree = 0
}
$('mode').addEventListener('click', (event) => {
  const v = (event.target as HTMLElement).dataset.v
  if (v !== 'mesh' && v !== 'free') return
  state.mode = v
  if (v === 'free' && !state.handles.length) regenFree()
  closeColorPopover()
  onChange()
})

function syncMode(updateInputs = true) {
  const free = state.mode === 'free'
  for (const b of $('mode').querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.v === state.mode))
  }
  $('modeHint').textContent = free
    ? 'Experimental: soft colour handles on a flexible surface. Presets and the 8 starters use the mesh mode.'
    : 'The 4×4 mesh of the Figma shader.'
  $('freeSection').hidden = !free
  $('meshSection').hidden = free
  handlesEl.classList.toggle('off', free)
  freeHandlesEl.classList.toggle('off', !free)
  if (!free) return
  const sel = state.handles[selectedFree]
  $('freeLabel').textContent = `Handle ${selectedFree + 1}`
  if (updateInputs && sel) {
    freeColor.value = sel.color
    freeRadius.value = String(sel.radius)
    $<HTMLInputElement>('freeBase').value = state.base
  }
  if (sel) $('freeRadiusValue').textContent = `${Math.round(sel.radius)}%`
  $<HTMLInputElement>('warp').checked = state.warp
  $<HTMLInputElement>('lockFree').checked = state.lockBorder
}

// ---- panel: size --------------------------------------------------------------

const sizePreset = $<HTMLSelectElement>('sizePreset')
sizePreset.innerHTML =
  SIZE_PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('') +
  '<option value="custom">Custom</option>'
const widthInput = $<HTMLInputElement>('width')
const heightInput = $<HTMLInputElement>('height')

sizePreset.addEventListener('change', () => {
  const preset = SIZE_PRESETS[Number(sizePreset.value)]
  if (!preset) return
  state.width = preset.width
  state.height = preset.height
  onChange()
})
const onSizeInput = () => {
  const w = Math.round(Number(widthInput.value))
  const h = Math.round(Number(heightInput.value))
  if (w >= 1 && h >= 1) {
    state.width = w
    state.height = h
    onChange({ sizeInputs: false })
  }
}
widthInput.addEventListener('input', onSizeInput)
heightInput.addEventListener('input', onSizeInput)

function syncSize(updateInputs = true) {
  if (updateInputs) {
    widthInput.value = String(state.width)
    heightInput.value = String(state.height)
  }
  const index = SIZE_PRESETS.findIndex((p) => p.width === state.width && p.height === state.height)
  sizePreset.value = index >= 0 ? String(index) : 'custom'
  const out = state.width * exportSettings.scale
  const outH = state.height * exportSettings.scale
  const problem = checkSize(out, outH)
  const limits = getMeshLimits()
  $('sizeHint').textContent = problem
    ? `⚠ ${problem}`
    : `Exports ${out} × ${outH} px` + (limits ? ` (max ${limits.maxSide} px per side here)` : '')
  $('sizeHint').style.color = problem ? 'var(--err)' : ''
  $<HTMLButtonElement>('export').disabled = !!problem
}

// ---- panel: colours -----------------------------------------------------------

const swatchesEl = $('swatches')
const seedInput = $<HTMLInputElement>('seed')

function applyPalette(id: string) {
  const palette = PALETTES.find((p) => p.id === id)
  if (!palette) return
  state.paletteId = id
  state.palette = [...palette.colors]
  state.points = paletteLayout(palette) ?? randomPoints(state.palette, state.seed)
  regenFree()
  onChange()
}

$('randomize').addEventListener('click', () => {
  state.seed = newSeed()
  state.points = randomPoints(state.palette, state.seed)
  regenFree()
  onChange()
})
seedInput.addEventListener('change', () => {
  const seed = Math.max(0, Math.round(Number(seedInput.value) || 0))
  state.seed = seed
  state.points = randomPoints(state.palette, seed)
  regenFree()
  onChange()
})

function renderSwatches() {
  swatchesEl.innerHTML = ''
  state.palette.forEach((color, index) => {
    const swatch = document.createElement('button')
    swatch.className = 'swatch'
    swatch.style.background = color
    swatch.title = `${color.toUpperCase()}: paint selected point`
    swatch.setAttribute('aria-label', `Use ${color} for the selected point`)
    swatch.addEventListener('click', () => {
      state.points[selected].color = color
      onChange({ palette: false })
    })
    if (state.palette.length > 1) {
      const x = document.createElement('span')
      x.className = 'x'
      x.textContent = '×'
      x.title = 'Remove from palette'
      x.addEventListener('click', (event) => {
        event.stopPropagation()
        state.palette.splice(index, 1)
        state.paletteId = 'custom'
        onChange()
      })
      swatch.appendChild(x)
    }
    swatchesEl.appendChild(swatch)
  })

  const add = document.createElement('button')
  add.className = 'add-swatch'
  add.textContent = '+'
  add.title = 'Add a custom colour to the palette'
  add.setAttribute('aria-label', 'Add colour')
  const picker = document.createElement('input')
  picker.type = 'color'
  picker.hidden = true
  picker.addEventListener('change', () => {
    state.palette.push(picker.value.toLowerCase())
    state.paletteId = 'custom'
    onChange()
  })
  add.addEventListener('click', () => {
    picker.value = state.points[selected].color
    picker.showPicker?.()
    if (!picker.showPicker) picker.click()
  })
  swatchesEl.append(add, picker)
}

// ---- flip ---------------------------------------------------------------------

function flip(horizontal: boolean) {
  if (state.mode === 'free') {
    state.handles = state.handles.map((h) =>
      horizontal ? { ...h, x: 100 - h.x, x0: 100 - h.x0 } : { ...h, y: 100 - h.y, y0: 100 - h.y0 },
    )
    onChange({ palette: false })
    return
  }
  const old = state.points
  state.points = old.map((_, index) => {
    const col = index % 4
    const row = Math.floor(index / 4)
    const src = old[horizontal ? row * 4 + (3 - col) : (3 - row) * 4 + col]
    return {
      color: src.color,
      x: horizontal ? 100 - src.x : src.x,
      y: horizontal ? src.y : 100 - src.y,
    }
  })
  onChange()
}
$('flipH').addEventListener('click', () => flip(true))
$('flipV').addEventListener('click', () => flip(false))

// ---- preset gallery (right column) --------------------------------------------

interface Preset {
  name: string
  state: GradientState
}
interface ExportEntry {
  name: string
  state: GradientState
  settings: ExportSettings
}
const PRESET_KEY = 'mgt-presets'
const EXPORT_KEY = 'mgt-exports'
const EXPORT_LOG_MAX = 20
let sharedPresets: Preset[] = []
let galleryTab: 'starter' | 'mine' = 'starter'

function parsePresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((p: { name?: unknown; state?: unknown; gradient?: unknown }) => {
    const st = sanitizeState(p?.gradient ?? p?.state)
    return st && typeof p.name === 'string' ? [{ name: p.name.slice(0, 40), state: st }] : []
  })
}
function parseExports(raw: unknown): ExportEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((p: { name?: unknown; state?: unknown; settings?: Partial<ExportSettings> }) => {
    const st = sanitizeState(p?.state)
    if (!st || typeof p.name !== 'string') return []
    const s = p.settings ?? {}
    const settings: ExportSettings = {
      format: s.format === 'webp' || s.format === 'png' ? s.format : 'jpeg',
      quality: typeof s.quality === 'number' ? Math.min(1, Math.max(0.5, s.quality)) : 0.92,
      scale: s.scale === 2 ? 2 : 1,
    }
    return [{ name: p.name.slice(0, 60), state: st, settings }]
  })
}
function readStore(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]')
  } catch {
    return []
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    setStatus('Could not save: browser storage is blocked.', 'err')
  }
}
const loadPresets = () => parsePresets(readStore(PRESET_KEY))
const loadExports = () => parseExports(readStore(EXPORT_KEY))

/** Newest first, capped; called after every successful export */
function logExport(width: number, height: number) {
  const stamp = new Date().toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const label = `${width}×${height} ${exportSettings.format === 'jpeg' ? 'JPG' : exportSettings.format.toUpperCase()}`
  const entry: ExportEntry = {
    name: `${label} · ${stamp}`,
    state: structuredClone(state),
    settings: { ...exportSettings },
  }
  writeStore(EXPORT_KEY, [entry, ...loadExports()].slice(0, EXPORT_LOG_MAX))
  renderGallery()
}

// One small offscreen renderer draws all thumbnails
let thumbGl: HTMLCanvasElement | null = null
let thumbRenderer: MeshRenderer | null | undefined
function drawThumb(target: HTMLCanvasElement, st: GradientState) {
  if (thumbRenderer === undefined) {
    try {
      thumbGl = document.createElement('canvas')
      thumbGl.width = 240
      thumbGl.height = 135
      thumbRenderer = new MeshRenderer(thumbGl)
    } catch {
      thumbRenderer = null
    }
  }
  if (!thumbRenderer || !thumbGl) return
  target.width = 240
  target.height = 135
  thumbRenderer.render({ ...toMeshParams(st), grain: 0 })
  // copied in the same task as the draw, so the WebGL buffer is still valid
  target.getContext('2d')!.drawImage(thumbGl, 0, 0)
}

/** Presets keep the current output size */
function applyPresetState(preset: GradientState) {
  const { width, height } = state
  state = { ...structuredClone(preset), width, height }
  selected = 0
  onChange()
}

/** An exported entry brings back its size and export settings too */
function applyExportEntry(entry: ExportEntry) {
  state = structuredClone(entry.state)
  exportSettings = { ...entry.settings }
  selected = 0
  syncExport()
  onChange()
}

function makeTile(
  name: string,
  st: GradientState,
  active: boolean,
  apply: () => void,
  remove?: () => void,
) {
  const tile = document.createElement('div')
  tile.className = 'tile'
  const button = document.createElement('button')
  button.className = 'tile-btn'
  button.title = name
  button.setAttribute('aria-pressed', String(active))
  const thumb = document.createElement('canvas')
  drawThumb(thumb, st)
  const caption = document.createElement('span')
  caption.textContent = name
  button.append(thumb, caption)
  button.addEventListener('click', apply)
  tile.appendChild(button)
  if (remove) {
    const del = document.createElement('button')
    del.className = 'tile-del'
    del.textContent = '×'
    del.title = 'Delete'
    del.setAttribute('aria-label', `Delete ${name}`)
    del.addEventListener('click', remove)
    tile.appendChild(del)
  }
  return tile
}

function renderGallery() {
  for (const tab of document.querySelectorAll<HTMLElement>('#tabs [data-tab]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === galleryTab))
  }
  const root = $('gallery')
  root.innerHTML = ''

  const group = (title: string, tiles: HTMLElement[], empty: string, action?: HTMLElement) => {
    const head = document.createElement('div')
    head.className = 'group-head'
    const heading = document.createElement('span')
    heading.className = 'group-title'
    heading.textContent = title
    head.appendChild(heading)
    if (action) head.appendChild(action)
    root.appendChild(head)
    if (tiles.length) {
      const grid = document.createElement('div')
      grid.className = 'gallery'
      grid.append(...tiles)
      root.appendChild(grid)
    } else {
      const note = document.createElement('p')
      note.className = 'hint'
      note.textContent = empty
      root.appendChild(note)
    }
  }
  const smallButton = (label: string, onClick: () => void) => {
    const b = document.createElement('button')
    b.className = 'small'
    b.textContent = label
    b.addEventListener('click', onClick)
    return b
  }

  if (galleryTab === 'starter') {
    const tiles = PALETTES.map((palette) => {
      const st: GradientState = {
        ...state,
        paletteId: palette.id,
        palette: [...palette.colors],
        points: paletteLayout(palette) ?? randomPoints(palette.colors, state.seed),
        ...(state.mode === 'free'
          ? { handles: randomHandles(palette.colors, state.seed), base: palette.colors[0] }
          : {}),
      }
      return makeTile(palette.name, st, state.paletteId === palette.id, () =>
        applyPalette(palette.id),
      )
    })
    for (const p of sharedPresets) {
      tiles.push(makeTile(p.name, p.state, false, () => applyPresetState(p.state)))
    }
    group('Starter gradients', tiles, '')
    const note = document.createElement('p')
    note.className = 'hint'
    note.textContent = 'Click one to use it as a starting point. Your output size stays as it is.'
    root.appendChild(note)
    return
  }

  // Mine: saved presets on top, a divider, then the export log
  const saveRow = document.createElement('div')
  saveRow.className = 'row'
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = 'Name for the current gradient'
  input.maxLength = 40
  input.className = 'grow'
  input.setAttribute('aria-label', 'Preset name')
  const save = document.createElement('button')
  save.textContent = 'Save'
  const doSave = () => {
    const name = input.value.trim() || `Preset ${loadPresets().length + 1}`
    const list = loadPresets().filter((p) => p.name !== name)
    list.push({ name, state: structuredClone(state) })
    writeStore(PRESET_KEY, list)
    renderGallery()
    setStatus(`Saved "${name}".`, 'ok')
  }
  save.addEventListener('click', doSave)
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') doSave()
  })
  saveRow.append(input, save)
  root.appendChild(saveRow)

  const saved = loadPresets()
  group(
    'Saved',
    saved.map((p, index) =>
      makeTile(p.name, p.state, false, () => applyPresetState(p.state), () => {
        writeStore(PRESET_KEY, loadPresets().filter((_, i) => i !== index))
        renderGallery()
      }),
    ),
    'Nothing saved yet. Name the current gradient above and press Save.',
  )

  const divider = document.createElement('hr')
  divider.className = 'divider'
  root.appendChild(divider)

  const exported = loadExports()
  group(
    `Exported (last ${EXPORT_LOG_MAX})`,
    exported.map((e, index) =>
      makeTile(e.name, e.state, false, () => applyExportEntry(e), () => {
        writeStore(EXPORT_KEY, loadExports().filter((_, i) => i !== index))
        renderGallery()
      }),
    ),
    'Every export is logged here, with its size and format.',
    exported.length
      ? smallButton('Clear', () => {
          writeStore(EXPORT_KEY, [])
          renderGallery()
        })
      : undefined,
  )

  const foot = document.createElement('div')
  foot.className = 'row foot'
  foot.append(
    smallButton('Export saved as file', () => {
      const list = loadPresets()
      if (!list.length) return setStatus('You have no saved gradients to export yet.', 'err')
      const data = { presets: list.map((p) => ({ name: p.name, gradient: p.state })) }
      download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'presets.json')
      setStatus('Exported. To share with the team, merge the entries into public/presets.json.', 'ok')
    }),
    smallButton('Import file', () => $<HTMLInputElement>('presetFile').click()),
  )
  root.appendChild(foot)
}

$('tabs').addEventListener('click', (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]')
  if (!tab) return
  galleryTab = tab.dataset.tab === 'mine' ? 'mine' : 'starter'
  renderGallery()
})

$<HTMLInputElement>('presetFile').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const data = JSON.parse(await file.text()) as { presets?: unknown }
    const incoming = parsePresets(Array.isArray(data) ? data : data.presets)
    if (!incoming.length) return setStatus('No gradients found in that file.', 'err')
    const names = new Set(incoming.map((p) => p.name))
    writeStore(PRESET_KEY, [...loadPresets().filter((p) => !names.has(p.name)), ...incoming])
    galleryTab = 'mine'
    renderGallery()
    setStatus(`Imported ${incoming.length} gradient${incoming.length === 1 ? '' : 's'}.`, 'ok')
  } catch {
    setStatus('That file is not a valid presets file.', 'err')
  }
})

// Narrow windows: the right column becomes a drawer
const sideEl = $('side')
$('drawerToggle').addEventListener('click', () => sideEl.classList.toggle('open'))
$('drawerClose').addEventListener('click', () => sideEl.classList.remove('open'))

fetch(`${import.meta.env.BASE_URL}presets.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((data: { presets?: unknown } | null) => {
    sharedPresets = parsePresets(data?.presets)
    if (sharedPresets.length) renderGallery()
  })
  .catch(() => {})

// ---- panel: point, grain ------------------------------------------------------

const pointColor = $<HTMLInputElement>('pointColor')
const pointX = $<HTMLInputElement>('pointX')
const pointY = $<HTMLInputElement>('pointY')

pointColor.addEventListener('input', () => {
  state.points[selected].color = pointColor.value.toLowerCase()
  onChange({ palette: false, pointInputs: false })
})
const onPointXY = () => {
  const p = state.points[selected]
  const [x, y] = effectivePosition(
    selected,
    Number(pointX.value),
    Number(pointY.value),
    state.lockBorder,
  )
  p.x = x
  p.y = y
  onChange({ palette: false, pointInputs: false })
}
pointX.addEventListener('input', onPointXY)
pointY.addEventListener('input', onPointXY)

$<HTMLInputElement>('lock').addEventListener('change', (event) => {
  state.lockBorder = (event.target as HTMLInputElement).checked
  if (state.lockBorder) {
    // Bake the projection into the stored positions so nothing jumps later
    state.points.forEach((p, i) => {
      ;[p.x, p.y] = effectivePosition(i, p.x, p.y, true)
    })
  }
  onChange()
})
$<HTMLInputElement>('showHandles').addEventListener('change', (event) => {
  const show = (event.target as HTMLInputElement).checked
  handlesEl.classList.toggle('hidden', !show)
  freeHandlesEl.classList.toggle('hidden', !show)
})

const grainInput = $<HTMLInputElement>('grain')
grainInput.addEventListener('input', () => {
  state.grain = Number(grainInput.value)
  onChange({ grainField: false })
})

function syncPoint(updateInputs = true) {
  const p = state.points[selected]
  $('pointLabel').textContent = `Point ${selected + 1}`
  if (updateInputs) {
    pointColor.value = p.color
    const [x, y] = effectivePosition(selected, p.x, p.y, state.lockBorder)
    pointX.value = String(Math.round(x * 10) / 10)
    pointY.value = String(Math.round(y * 10) / 10)
  }
  $<HTMLInputElement>('lock').checked = state.lockBorder
}

// ---- panel: export ------------------------------------------------------------

function syncExport() {
  for (const button of $('format').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.v === exportSettings.format))
  }
  for (const button of $('scale').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.v) === exportSettings.scale))
  }
  $('qualityRow').style.display = exportSettings.format === 'png' ? 'none' : ''
  $<HTMLInputElement>('quality').value = String(exportSettings.quality)
  $('qualityValue').textContent = `${Math.round(exportSettings.quality * 100)}`
}
$('format').addEventListener('click', (event) => {
  const v = (event.target as HTMLElement).dataset.v as ExportFormat | undefined
  if (!v) return
  exportSettings.format = v
  syncExport()
})
$('scale').addEventListener('click', (event) => {
  const v = (event.target as HTMLElement).dataset.v
  if (!v) return
  exportSettings.scale = Number(v) as 1 | 2
  syncExport()
  syncSize(false)
})
$<HTMLInputElement>('quality').addEventListener('input', (event) => {
  exportSettings.quality = Number((event.target as HTMLInputElement).value)
  syncExport()
})

let exporting = false
$('export').addEventListener('click', async () => {
  if (exporting) return
  exporting = true
  const button = $<HTMLButtonElement>('export')
  button.disabled = true
  setStatus('Rendering…')
  try {
    // let the status paint before the (blocking) render
    await new Promise((r) => setTimeout(r, 30))
    const { blob, width, height } = await renderToBlob(state, exportSettings)
    const name = `mesh-gradient-${width}x${height}-${state.seed}.${EXTENSION[exportSettings.format]}`
    download(blob, name)
    showResult(blob, name)
    logExport(width, height)
  } catch (error) {
    setStatus((error as Error).message, 'err')
  } finally {
    exporting = false
    syncSize(false)
  }
})

// ---- panel: save & share ------------------------------------------------------

$('copyLink').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href)
    setStatus('Link copied. It contains the whole gradient.', 'ok')
  } catch {
    setStatus('Could not access the clipboard. Copy the address bar instead.', 'err')
  }
})
$('saveJson').addEventListener('click', () => {
  const blob = new Blob([toJsonFile(state, exportSettings)], { type: 'application/json' })
  download(blob, `mesh-gradient-${state.seed}.json`)
})
const fileInput = $<HTMLInputElement>('file')
$('loadJson').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  fileInput.value = ''
  if (!file) return
  const loaded = fromJsonFile(await file.text())
  if (!loaded) return setStatus('That file is not a valid mesh gradient JSON.', 'err')
  state = loaded.state
  if (loaded.export) {
    const e = loaded.export
    if (e.format === 'jpeg' || e.format === 'webp' || e.format === 'png') exportSettings.format = e.format
    if (typeof e.quality === 'number') exportSettings.quality = Math.min(1, Math.max(0.5, e.quality))
    if (e.scale === 1 || e.scale === 2) exportSettings.scale = e.scale
  }
  selected = 0
  syncExport()
  onChange()
  setStatus('Loaded.', 'ok')
})

// ---- theme --------------------------------------------------------------------

$('theme').addEventListener('click', () => {
  const root = document.documentElement
  const dark =
    root.dataset.theme === 'dark' ||
    (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
  root.dataset.theme = dark ? 'light' : 'dark'
  try {
    localStorage.setItem('mgt-theme', root.dataset.theme)
  } catch {
    /* storage can be blocked */
  }
})

// ---- change pipeline ----------------------------------------------------------

let hashTimer = 0
function onChange(
  opts: {
    palette?: boolean
    sizeInputs?: boolean
    pointInputs?: boolean
    grainField?: boolean
    freeInputs?: boolean
  } = {},
) {
  const {
    palette = true,
    sizeInputs = true,
    pointInputs = true,
    grainField = true,
    freeInputs = true,
  } = opts
  syncSize(sizeInputs)
  fitFrame()
  syncHandles()
  syncFreeHandles()
  syncMode(freeInputs)
  syncPoint(pointInputs)
  if (palette) {
    renderGallery()
    renderSwatches()
  }
  seedInput.value = String(state.seed)
  if (grainField) grainInput.value = String(state.grain)
  $('grainValue').textContent = state.grain.toFixed(1)
  scheduleRender()
  clearTimeout(hashTimer)
  hashTimer = window.setTimeout(() => history.replaceState(null, '', '#' + encodeHash(state)), 250)
}

window.addEventListener('hashchange', () => {
  const next = decodeHash(location.hash)
  if (next) {
    state = next
    onChange()
  }
})

syncExport()
onChange()
