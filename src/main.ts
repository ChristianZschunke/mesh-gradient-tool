import './style.css'
import { MeshRenderer, effectivePosition, getMeshLimits, POINT_COUNT } from './mesh/mesh'
import { PALETTES } from './palettes'
import { newSeed, paletteLayout, randomPoints } from './random'
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
    </div>
    <div class="size-badge" id="badge"></div>
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
      <h2>Colours</h2>
      <div class="row"><select id="palette" aria-label="Palette"></select></div>
      <div class="swatches" id="swatches"></div>
      <div class="row">
        <label for="seed">Seed</label>
        <input type="number" id="seed" min="0" step="1" class="grow" />
        <button id="randomize" title="Random layout from the current palette">Randomize</button>
      </div>
      <p class="hint">Click a swatch to paint the selected point. The seed reproduces a randomized layout.</p>
    </section>

    <section>
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
      <h2>My presets</h2>
      <div class="row">
        <input type="text" id="presetName" placeholder="Preset name" maxlength="40" aria-label="Preset name" class="grow" />
        <button id="savePreset">Save</button>
      </div>
      <div id="presetList"></div>
      <p class="hint">Stored in this browser only. Use Save JSON or Copy link to share.</p>
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

const paletteSelect = $<HTMLSelectElement>('palette')
const swatchesEl = $('swatches')
const seedInput = $<HTMLInputElement>('seed')

function syncPaletteSelect() {
  paletteSelect.innerHTML =
    PALETTES.map((p) => `<option value="${p.id}">${p.name}</option>`).join('') +
    '<option value="custom">Custom</option>'
  paletteSelect.value = PALETTES.some((p) => p.id === state.paletteId) ? state.paletteId : 'custom'
}

function applyPalette(id: string) {
  const palette = PALETTES.find((p) => p.id === id)
  if (!palette) return
  state.paletteId = id
  state.palette = [...palette.colors]
  state.points = paletteLayout(palette) ?? randomPoints(state.palette, state.seed)
  onChange()
}
paletteSelect.addEventListener('change', () => applyPalette(paletteSelect.value))

$('randomize').addEventListener('click', () => {
  state.seed = newSeed()
  state.points = randomPoints(state.palette, state.seed)
  onChange()
})
seedInput.addEventListener('change', () => {
  const seed = Math.max(0, Math.round(Number(seedInput.value) || 0))
  state.seed = seed
  state.points = randomPoints(state.palette, seed)
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

// ---- user presets (localStorage) ----------------------------------------------

interface UserPreset {
  name: string
  state: GradientState
}
const PRESET_KEY = 'mgt-presets'
function loadPresets(): UserPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]') as { name: string; state: unknown }[]
    return raw.flatMap((p) => {
      const st = sanitizeState(p.state)
      return st && typeof p.name === 'string' ? [{ name: p.name, state: st }] : []
    })
  } catch {
    return []
  }
}
function storePresets(list: UserPreset[]) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(list))
  } catch {
    setStatus('Could not save: browser storage is blocked.', 'err')
  }
}
function renderPresets() {
  const list = loadPresets()
  const el = $('presetList')
  el.innerHTML = ''
  list.forEach((preset, index) => {
    const row = document.createElement('div')
    row.className = 'row'
    const apply = document.createElement('button')
    apply.className = 'grow preset'
    apply.textContent = preset.name
    apply.title = 'Apply (keeps the current size)'
    apply.addEventListener('click', () => {
      const { width, height } = state
      state = { ...structuredClone(preset.state), width, height }
      selected = 0
      onChange()
    })
    const del = document.createElement('button')
    del.textContent = '×'
    del.title = 'Delete preset'
    del.setAttribute('aria-label', `Delete preset ${preset.name}`)
    del.addEventListener('click', () => {
      storePresets(loadPresets().filter((_, i) => i !== index))
      renderPresets()
    })
    row.append(apply, del)
    el.appendChild(row)
  })
}
$('savePreset').addEventListener('click', () => {
  const input = $<HTMLInputElement>('presetName')
  const name = input.value.trim() || `Preset ${loadPresets().length + 1}`
  const list = loadPresets().filter((p) => p.name !== name)
  list.push({ name, state: structuredClone(state) })
  storePresets(list)
  input.value = ''
  renderPresets()
  setStatus(`Saved preset "${name}".`, 'ok')
})
renderPresets()

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
  handlesEl.classList.toggle('hidden', !(event.target as HTMLInputElement).checked)
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
  opts: { palette?: boolean; sizeInputs?: boolean; pointInputs?: boolean; grainField?: boolean } = {},
) {
  const { palette = true, sizeInputs = true, pointInputs = true, grainField = true } = opts
  syncSize(sizeInputs)
  fitFrame()
  syncHandles()
  syncPoint(pointInputs)
  if (palette) {
    syncPaletteSelect()
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
