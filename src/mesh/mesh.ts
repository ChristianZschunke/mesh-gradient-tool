/**
 * Reusable WebGL2 mesh gradient renderer (no dependency on the rest of the app).
 *
 * A 4x4 grid of control points (row-major, 16 entries). Position and colour are
 * both evaluated as a bicubic Catmull-Rom patch in the vertex shader over a
 * tessellated grid; colours are blended in linear light and converted back to
 * sRGB in the fragment shader. An optional triangular-noise dither is added in
 * the fragment shader so 8-bit exports do not band.
 *
 * Ported from the GALVANY "CTA_Button" Figma shader.
 */

export type RGB = [r: number, g: number, b: number] // sRGB, 0-1

export interface MeshPoint {
  /** Position in percent of the canvas. Clamped to 0-100 like the Figma shader. */
  x: number
  y: number
  color: RGB
}

export interface MeshParams {
  mode?: 'mesh'
  /** Exactly 16 points, row-major */
  points: MeshPoint[]
  /** Corners stay put and edge points only slide along their edge */
  lockBorder: boolean
  /** Dither amplitude in 8-bit steps (0 = off, 1 = +-1 step) */
  grain: number
  /** Changes the dither pattern */
  seed: number
}

export const GRID = 4
export const POINT_COUNT = GRID * GRID
const TESSELLATION = 156

const VERTEX_SHADER = `#version 300 es
precision highp float;
uniform vec4 U[32];
in vec2 a;
out vec4 vColor;
vec4 cm(vec4 a, vec4 b, vec4 c, vec4 d, float t) {
  float t2 = t*t, t3 = t2*t;
  return 0.5 * ((2.*b) + (-a+c)*t + (2.*a-5.*b+4.*c-d)*t2 + (-a+3.*b-3.*c+d)*t3);
}
vec2 seg(float v) { float s = clamp(v,0.,1.)*3.; float i = min(floor(s),2.); return vec2(i, s-i); }
vec4 P(int off, int c, int r) { return U[off + r*4 + c]; }
vec4 mesh(vec2 p, int off) {
  vec2 sx = seg(p.x), sy = seg(p.y);
  int ix = int(sx.x), iy = int(sy.x);
  int x0 = max(ix-1,0), x1 = ix, x2 = ix+1, x3 = min(ix+2,3);
  int y0 = max(iy-1,0), y1 = iy, y2 = iy+1, y3 = min(iy+2,3);
  vec4 r0 = cm(P(off,x0,y0),P(off,x1,y0),P(off,x2,y0),P(off,x3,y0), sx.y);
  vec4 r1 = cm(P(off,x0,y1),P(off,x1,y1),P(off,x2,y1),P(off,x3,y1), sx.y);
  vec4 r2 = cm(P(off,x0,y2),P(off,x1,y2),P(off,x2,y2),P(off,x3,y2), sx.y);
  vec4 r3 = cm(P(off,x0,y3),P(off,x1,y3),P(off,x2,y3),P(off,x3,y3), sx.y);
  return cm(r0, r1, r2, r3, sy.y);
}
void main() {
  vec2 pos = mesh(a, 0).xy;
  gl_Position = vec4(pos.x*2.-1., 1.-pos.y*2., 0., 1.);
  vColor = clamp(mesh(a, 16), 0., 1.);
}`

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec4 vColor;
uniform vec2 uGrain; // x: amplitude (0-1 range, i.e. steps/255), y: seed offset
out vec4 o;
vec3 toSrgb(vec3 c) {
  c = max(c, 0.);
  return mix(1.055*pow(c, vec3(1./2.4)) - .055, c*12.92, lessThanEqual(c, vec3(.0031308)));
}
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec2 fc = gl_FragCoord.xy + uGrain.y;
  // triangular distribution in [-1, 1]: decorrelates the 8-bit rounding error
  float n = hash(fc) + hash(fc * 1.3711 + 17.31) - 1.;
  o = vec4(toSrgb(vColor.rgb) + n * uGrain.x, 1.);
}`

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

const toLinear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)

/**
 * Where a control point actually ends up: clamped to 0-100 and, with the border
 * locked, projected onto its edge (corners fixed). Shared with the UI so the
 * drag handles sit exactly where the shader draws the point.
 */
export function effectivePosition(
  index: number,
  x: number,
  y: number,
  lockBorder: boolean,
): [number, number] {
  let px = clamp(x, 0, 100)
  let py = clamp(y, 0, 100)
  if (lockBorder) {
    const col = index % GRID
    const row = Math.floor(index / GRID)
    if (col === 0) px = 0
    if (col === GRID - 1) px = 100
    if (row === 0) py = 0
    if (row === GRID - 1) py = 100
  }
  return [px, py]
}

// ---- experimental "free" mode ---------------------------------------------------
// Handles at arbitrary positions on a tessellated plane. Each handle has a rest
// position, a current position, a colour and a radius of influence. Vertices
// within the radius follow the handle (smooth falloff) and take its colour.

export const MAX_FREE_HANDLES = 32

export interface FreeHandle {
  /** Rest position in percent of width/height */
  x0: number
  y0: number
  /** Current position; the difference to the rest position warps the surface */
  x: number
  y: number
  /** Radius of influence in percent of the canvas height */
  radius: number
  color: RGB
}

export interface FreeParams {
  mode: 'free'
  handles: FreeHandle[]
  /** Colour where no handle reaches */
  base: RGB
  /** Border vertices stay on the border */
  lockBorder: boolean
  grain: number
  seed: number
}

export type RenderParams = MeshParams | FreeParams

const FREE_VERTEX_SHADER = `#version 300 es
precision highp float;
#define MAXH ${MAX_FREE_HANDLES}
uniform vec4 H0[MAXH]; // xy rest position (0-1), z radius (0-1 of height)
uniform vec4 H1[MAXH]; // xy current position
uniform vec4 HC[MAXH]; // linear rgb
uniform int uCount;
uniform float uAspect;
uniform vec3 uBase;
uniform float uLock;
in vec2 a;
out vec4 vColor;
void main() {
  vec2 disp = vec2(0.);
  vec3 acc = vec3(0.);
  float ws = 0.;
  for (int i = 0; i < MAXH; i++) {
    if (i >= uCount) break;
    // distance in height units, so the influence is circular on wide canvases
    float d = length((a - H0[i].xy) * vec2(uAspect, 1.));
    float t = clamp(1. - d / H0[i].z, 0., 1.);
    float w = t * t * (3. - 2. * t);
    disp += w * (H1[i].xy - H0[i].xy);
    acc += w * HC[i].rgb;
    ws += w;
  }
  disp /= max(1., ws);
  vec3 col = ws < 1. ? acc + (1. - ws) * uBase : acc / ws;
  vec2 pos = a + disp;
  if (uLock > .5) {
    if (a.x <= 0. || a.x >= 1.) pos.x = a.x;
    if (a.y <= 0. || a.y >= 1.) pos.y = a.y;
    pos = clamp(pos, 0., 1.);
  }
  gl_Position = vec4(pos.x * 2. - 1., 1. - pos.y * 2., 0., 1.);
  vColor = vec4(clamp(col, 0., 1.), 1.);
}`

export interface MeshLimits {
  /** Largest edge (px) a WebGL surface can have on this device */
  maxSide: number
}

let cachedLimits: MeshLimits | null | undefined

/** Max render size of this browser/GPU, or null without WebGL2 */
export function getMeshLimits(): MeshLimits | null {
  if (cachedLimits !== undefined) return cachedLimits
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  if (!gl) return (cachedLimits = null)
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array
  const maxSide = Math.min(
    gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    viewport[0],
    viewport[1],
  )
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return (cachedLimits = { maxSide })
}

interface Loc {
  program: WebGLProgram
  grain: WebGLUniformLocation | null
  [name: string]: WebGLProgram | WebGLUniformLocation | null
}

export class MeshRenderer {
  private gl: WebGL2RenderingContext
  private uniforms = new Float32Array(128)
  private mesh: Loc | null = null
  private free: Loc | null = null
  private indexCount = 0
  private ready = false
  private lost = false
  private last: RenderParams | null = null
  private readonly onContextLost = (event: Event) => {
    event.preventDefault()
    this.ready = false
    this.lost = true
  }
  private readonly onContextRestored = () => {
    this.lost = false
    try {
      this.free = null
      this.init()
      this.options.onRestore?.()
    } catch (error) {
      console.warn('mesh gradient:', error)
    }
  }

  /** Throws when WebGL2 or the shaders are unavailable */
  constructor(
    private canvas: HTMLCanvasElement,
    private options: { onRestore?: () => void } = {},
  ) {
    // alpha: false, so the canvas is opaque and JPG/WebP never see transparency
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })
    if (!gl) throw new Error('WebGL2 is not available in this browser')
    this.gl = gl
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored)
    this.init()
  }

  private link(vertex: string, names: string[]): Loc {
    const gl = this.gl
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed')
      }
      return shader
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
    gl.bindAttribLocation(program, 0, 'a')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed')
    }
    const loc: Loc = { program, grain: gl.getUniformLocation(program, 'uGrain') }
    for (const name of names) loc[name] = gl.getUniformLocation(program, name)
    return loc
  }

  private init() {
    const gl = this.gl
    this.mesh = this.link(VERTEX_SHADER, ['U'])

    const side = TESSELLATION + 1
    const vertices = new Float32Array(side * side * 2)
    const indices = new Uint16Array(TESSELLATION * TESSELLATION * 6)
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        vertices.set([col / TESSELLATION, row / TESSELLATION], (row * side + col) * 2)
      }
    }
    let offset = 0
    for (let row = 0; row < TESSELLATION; row++) {
      for (let col = 0; col < TESSELLATION; col++) {
        const tl = row * side + col
        const bl = tl + side
        indices.set([tl, bl, tl + 1, tl + 1, bl, bl + 1], offset)
        offset += 6
      }
    }
    this.indexCount = indices.length
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.ready = true
  }

  /** Draws into the canvas at its current width/height (set those first) */
  render(params: RenderParams) {
    if (this.lost || !this.ready) return
    this.last = params
    const gl = this.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)

    let program: Loc
    if (params.mode === 'free') {
      program = this.free ??= this.link(FREE_VERTEX_SHADER, [
        'H0',
        'H1',
        'HC',
        'uCount',
        'uAspect',
        'uBase',
        'uLock',
      ])
      gl.useProgram(program.program)
      const handles = params.handles.slice(0, MAX_FREE_HANDLES)
      const h0 = new Float32Array(MAX_FREE_HANDLES * 4)
      const h1 = new Float32Array(MAX_FREE_HANDLES * 4)
      const hc = new Float32Array(MAX_FREE_HANDLES * 4)
      handles.forEach((h, i) => {
        h0.set([h.x0 / 100, h.y0 / 100, Math.max(h.radius, 0.5) / 100, 0], i * 4)
        h1.set([h.x / 100, h.y / 100, 0, 0], i * 4)
        hc.set([toLinear(h.color[0]), toLinear(h.color[1]), toLinear(h.color[2]), 1], i * 4)
      })
      gl.uniform4fv(program.H0 as WebGLUniformLocation, h0)
      gl.uniform4fv(program.H1 as WebGLUniformLocation, h1)
      gl.uniform4fv(program.HC as WebGLUniformLocation, hc)
      gl.uniform1i(program.uCount as WebGLUniformLocation, handles.length)
      gl.uniform1f(program.uAspect as WebGLUniformLocation, this.canvas.width / this.canvas.height)
      gl.uniform3f(
        program.uBase as WebGLUniformLocation,
        toLinear(params.base[0]),
        toLinear(params.base[1]),
        toLinear(params.base[2]),
      )
      gl.uniform1f(program.uLock as WebGLUniformLocation, params.lockBorder ? 1 : 0)
      gl.clearColor(params.base[0], params.base[1], params.base[2], 1)
    } else {
      program = this.mesh!
      gl.useProgram(program.program)
      const { points, lockBorder } = params
      if (points.length !== POINT_COUNT) throw new Error('mesh needs 16 points')
      let avgR = 0
      let avgG = 0
      let avgB = 0
      points.forEach((point, index) => {
        const [x, y] = effectivePosition(index, point.x, point.y, lockBorder)
        this.uniforms.set([x / 100, y / 100, 0, 0], index * 4)
        this.uniforms.set(
          [toLinear(point.color[0]), toLinear(point.color[1]), toLinear(point.color[2]), 1],
          (16 + index) * 4,
        )
        avgR += point.color[0]
        avgG += point.color[1]
        avgB += point.color[2]
      })
      gl.uniform4fv(program.U as WebGLUniformLocation, this.uniforms)
      // Behind the mesh: only visible if an unlocked border leaves gaps
      gl.clearColor(avgR / POINT_COUNT, avgG / POINT_COUNT, avgB / POINT_COUNT, 1)
    }

    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.uniform2f(program.grain, params.grain / 255, (params.seed % 997) * 0.37)
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0)
  }

  /** The sRGB colour on screen at a position (0-1 of width/height), without grain */
  sample(params: RenderParams, fx: number, fy: number): RGB {
    this.render({ ...params, grain: 0 })
    const gl = this.gl
    const x = Math.min(this.canvas.width - 1, Math.max(0, Math.floor(fx * this.canvas.width)))
    const y = Math.min(this.canvas.height - 1, Math.max(0, Math.floor(fy * this.canvas.height)))
    const pixel = new Uint8Array(4)
    gl.readPixels(x, this.canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255]
  }

  /** Repeats the last frame, e.g. after the canvas was resized */
  redraw() {
    if (this.last) this.render(this.last)
  }

  /** Frees the GL context (browsers only allow a handful of live contexts) */
  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
    this.ready = false
  }
}

export function hexToRgb(hex: string): RGB {
  const value = parseInt(hex.slice(1), 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}
