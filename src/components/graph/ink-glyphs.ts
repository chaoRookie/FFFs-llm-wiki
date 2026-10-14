/**
 * Hand-drawn ink glyphs for the knowledge graph.
 *
 * Every glyph is an ordered list of pen operations in unit coordinates
 * (radius 1). Each operation owns a slice of the 0..1 "growth" progress, so a
 * single number draws the glyph stroke by stroke: 0 = nothing, the glyph's
 * REST_PROGRESS = its simple resting form, 1 = the finished pattern. Points get a
 * slow, low-frequency wobble so lines look drawn by hand and "breathe" over time.
 */

export type GlyphKind = "globe" | "ring" | "petal" | "dna" | "hex"

type Pt = readonly [number, number]
type Tone = "color" | "ink" | "paper"

interface StrokeOp {
  op: "stroke"
  shape: number // ops sharing a shape id share the same wobble
  pts: Pt[]
  closed?: boolean
  tone: Tone
  width: number
  from: number
  to: number
}
interface FillOp {
  op: "fill"
  shape: number
  pts: Pt[]
  hole?: Pt[]
  tone: Tone
  alpha?: number
  from: number
  to: number
}
interface DotOp {
  op: "dot"
  at: Pt
  radius: number
  from: number
  to: number
}
type GlyphOp = StrokeOp | FillOp | DotOp

export interface GlyphStyle {
  color: string
  ink: string
  paper: string
}

export interface DrawGlyphOptions {
  x: number
  y: number
  radius: number
  progress: number
  seed: number
  /** Breathing clock in ms; pass a constant to freeze the wobble. */
  time: number
  /** 0..1 ink bleed while the node moves through "water". */
  bleed: number
  style: GlyphStyle
}

export function glyphForType(type: string): GlyphKind {
  switch (type) {
    case "entity":
      return "globe"
    case "concept":
      return "ring"
    case "source":
      return "petal"
    case "topic":
    case "synthesis":
    case "overview":
      return "dna"
    default:
      return "hex"
  }
}

/** Progress at which each glyph shows its simple resting form. */
export const REST_PROGRESS: Record<GlyphKind, number> = {
  globe: 0.4,
  ring: 0.45,
  petal: 0.5,
  dna: 0.38,
  hex: 0.35,
}

// ── shape builders (unit coordinates) ──────────────────────────────────────

function ellipse(rx: number, ry: number, start = -Math.PI / 2, sweep = Math.PI * 2, n = 40, cx = 0, cy = 0): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const a = start + (sweep * i) / n
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}

function line(a: Pt, b: Pt, n = 8): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
  return pts
}

function curve(fn: (u: number) => Pt, n = 24): Pt[] {
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) pts.push(fn(i / n))
  return pts
}

/** Evenly splits [from, to] into `count` consecutive slices. */
function slices(from: number, to: number, count: number): Array<[number, number]> {
  const step = (to - from) / count
  return Array.from({ length: count }, (_, i) => [from + step * i, from + step * (i + 1)])
}

function globeOps(): GlyphOp[] {
  const outline = ellipse(1, 1, (-150 * Math.PI) / 180)
  const ops: GlyphOp[] = [
    { op: "stroke", shape: 0, pts: outline, tone: "ink", width: 0.1, from: 0, to: 0.22 },
    { op: "fill", shape: 0, pts: outline, tone: "color", from: 0.22, to: 0.4 },
    { op: "stroke", shape: 1, pts: ellipse(0.16, 1, -Math.PI / 2, Math.PI, 24), tone: "ink", width: 0.08, from: 0.45, to: 0.55 },
    { op: "stroke", shape: 2, pts: ellipse(0.52, 1, -Math.PI / 2, -Math.PI, 24), tone: "ink", width: 0.08, from: 0.55, to: 0.62 },
    { op: "stroke", shape: 3, pts: ellipse(0.52, 1, -Math.PI / 2, Math.PI, 24), tone: "ink", width: 0.08, from: 0.6, to: 0.68 },
    { op: "stroke", shape: 4, pts: line([-1, 0], [1, 0], 12), tone: "ink", width: 0.08, from: 0.68, to: 0.76 },
    {
      op: "stroke",
      shape: 5,
      pts: curve((u) => {
        const x = -0.84 + 1.68 * u
        return [x, -0.5 - 0.16 * (1 - (x / 0.84) ** 2)]
      }),
      tone: "ink",
      width: 0.08,
      from: 0.76,
      to: 0.82,
    },
    {
      op: "stroke",
      shape: 6,
      pts: curve((u) => {
        const x = -0.84 + 1.68 * u
        return [x, 0.5 + 0.16 * (1 - (x / 0.84) ** 2)]
      }),
      tone: "ink",
      width: 0.08,
      from: 0.82,
      to: 0.88,
    },
  ]
  const dots: Pt[] = [[0, -1], [-0.48, -0.62], [0.48, -0.62], [-1, 0], [-0.52, 0], [0, 0], [0.52, 0], [1, 0], [-0.48, 0.62], [0.48, 0.62], [0, 1]]
  slices(0.88, 1, dots.length).forEach(([from, to], i) => ops.push({ op: "dot", at: dots[i], radius: 0.085, from, to }))
  return ops
}

function ringOps(): GlyphOp[] {
  const outer = ellipse(1.12, 1.12)
  const inner = ellipse(0.72, 0.72)
  return [
    { op: "stroke", shape: 0, pts: ellipse(0.92, 0.92), tone: "color", width: 0.22, from: 0, to: 0.45 },
    { op: "fill", shape: 1, pts: outer, hole: inner, tone: "color", from: 0.62, to: 0.9 },
    { op: "stroke", shape: 1, pts: outer, tone: "ink", width: 0.08, from: 0.45, to: 0.72 },
    { op: "stroke", shape: 2, pts: inner, tone: "ink", width: 0.08, from: 0.6, to: 0.9 },
  ]
}

function petalShape(qx: number, qy: number): Pt[] {
  // A rounded leaf in one quadrant whose inner corner points at the centre,
  // leaving the small diamond gap where the four petals meet.
  const cx = qx * 0.5
  const cy = qy * 0.5
  const toCentre = Math.atan2(-cy, -cx)
  const start = toCentre + Math.PI // begin on the outer side, finish back there
  return ellipse(1, 1, start, Math.PI * 2, 44).map(([ux, uy]) => {
    const a = Math.atan2(uy, ux)
    const exp = 2 / 2.8
    const sx = Math.sign(ux) * Math.abs(ux) ** exp
    const sy = Math.sign(uy) * Math.abs(uy) ** exp
    const pinch = 1 + 0.2 * Math.max(0, Math.cos(a - toCentre)) ** 6
    return [cx + sx * 0.44 * pinch, cy + sy * 0.44 * pinch] as Pt
  })
}

function petalOps(): GlyphOp[] {
  const quadrants: Pt[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
  const petals = quadrants.map(([qx, qy]) => petalShape(qx, qy))
  const ops: GlyphOp[] = []
  slices(0, 0.5, 4).forEach(([from, to], i) =>
    ops.push({ op: "stroke", shape: i, pts: petals[i], closed: true, tone: "color", width: 0.1, from, to }),
  )
  slices(0.5, 0.9, 4).forEach(([from, to], i) => ops.push({ op: "fill", shape: i, pts: petals[i], tone: "color", from, to }))
  slices(0.55, 1, 4).forEach(([from, to], i) =>
    ops.push({ op: "stroke", shape: i, pts: petals[i], closed: true, tone: "ink", width: 0.1, from, to }),
  )
  return ops
}

function dnaOps(): GlyphOp[] {
  const strand = (sign: number) => curve((u) => {
    const y = -1 + 2 * u
    return [sign * 0.45 * Math.sin(1.25 * Math.PI * y), y]
  }, 36)
  const a = strand(1)
  const b = strand(-1)
  // Rest form: both strands as thin coloured lines, so the double helix is
  // readable before hover. Hover turns them into outlined ribbons with rungs.
  const ops: GlyphOp[] = [
    { op: "stroke", shape: 0, pts: a, tone: "color", width: 0.12, from: 0, to: 0.2 },
    { op: "stroke", shape: 1, pts: b, tone: "color", width: 0.12, from: 0.2, to: 0.38 },
    { op: "stroke", shape: 1, pts: b, tone: "ink", width: 0.3, from: 0.55, to: 0.75 },
    { op: "stroke", shape: 1, pts: b, tone: "paper", width: 0.19, from: 0.55, to: 0.75 },
    { op: "stroke", shape: 0, pts: a, tone: "ink", width: 0.3, from: 0.42, to: 0.62 },
    { op: "stroke", shape: 0, pts: a, tone: "color", width: 0.19, from: 0.42, to: 0.62 },
  ]
  const rungs = [-0.82, -0.58, -0.18, 0.18, 0.58, 0.82]
  slices(0.75, 1, rungs.length).forEach(([from, to], i) => {
    const y = rungs[i]
    const x = 0.45 * Math.sin(1.25 * Math.PI * y)
    ops.push({ op: "stroke", shape: 10 + i, pts: line([-x, y], [x, y], 6), tone: "ink", width: 0.07, from, to })
  })
  return ops
}

function hexOps(): GlyphOp[] {
  const vertex = (radius: number, k: number, offset = -90): Pt => {
    const a = ((offset + 60 * k) * Math.PI) / 180
    return [radius * Math.cos(a), radius * Math.sin(a)]
  }
  const outer = Array.from({ length: 7 }, (_, k) => vertex(1, k % 6))
  const ops: GlyphOp[] = [
    { op: "fill", shape: 0, pts: outer, tone: "color", alpha: 0.18, from: 0.85, to: 1 },
    { op: "stroke", shape: 0, pts: outer.flatMap((p, i) => (i === 0 ? [p] : line(outer[i - 1], p, 5).slice(1))), tone: "color", width: 0.09, from: 0, to: 0.25 },
  ]
  slices(0.25, 0.35, 6).forEach(([from, to], k) =>
    ops.push({ op: "stroke", shape: 1 + k, pts: line(vertex(1, k), vertex(1.32, k), 4), tone: "color", width: 0.09, from, to }),
  )
  const inner = Array.from({ length: 7 }, (_, k) => vertex(0.42, k % 6, -60))
  ops.push({ op: "stroke", shape: 7, pts: inner.flatMap((p, i) => (i === 0 ? [p] : line(inner[i - 1], p, 4).slice(1))), tone: "color", width: 0.08, from: 0.4, to: 0.58 })
  slices(0.58, 0.85, 6).forEach(([from, to], k) => {
    const mid: Pt = [(vertex(1, k)[0] + vertex(1, k + 1)[0]) / 2, (vertex(1, k)[1] + vertex(1, k + 1)[1]) / 2]
    ops.push({ op: "stroke", shape: 8 + k, pts: line(inner[k], mid, 5), tone: "color", width: 0.08, from, to })
  })
  return ops
}

const GLYPH_OPS: Record<GlyphKind, GlyphOp[]> = {
  globe: globeOps(),
  ring: ringOps(),
  petal: petalOps(),
  dna: dnaOps(),
  hex: hexOps(),
}

// ── drawing ─────────────────────────────────────────────────────────────────

const WOBBLE = 0.035

function phase(seed: number, k: number): number {
  const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453
  return (s - Math.floor(s)) * Math.PI * 2
}

/** Low-frequency hand wobble that drifts slowly with time ("breathing"). */
function wobble(pts: Pt[], seed: number, time: number): Pt[] {
  const tau = time * 0.00035
  const p1 = phase(seed, 1)
  const p2 = phase(seed, 2)
  const p3 = phase(seed, 3)
  return pts.map(([x, y], i) => [
    x + WOBBLE * (0.6 * Math.sin(i * 0.5 + p1 + tau) + 0.4 * Math.sin(i * 0.21 + p2 - tau * 0.7)),
    y + WOBBLE * (0.6 * Math.cos(i * 0.46 + p3 + tau * 0.8) + 0.4 * Math.sin(i * 0.17 + p1 - tau)),
  ])
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function opFraction(op: GlyphOp, progress: number): number {
  return clamp01((progress - op.from) / (op.to - op.from))
}

function tracePartial(ctx: CanvasRenderingContext2D, pts: Pt[], frac: number): void {
  let total = 0
  const seg: number[] = []
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    seg.push(d)
    total += d
  }
  let remaining = total * frac
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) {
    const d = seg[i - 1]
    if (remaining >= d) {
      ctx.lineTo(pts[i][0], pts[i][1])
      remaining -= d
    } else {
      const k = d === 0 ? 0 : remaining / d
      ctx.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k)
      return
    }
  }
}

function traceClosed(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
}

function toneColor(tone: Tone, style: GlyphStyle): string {
  return tone === "color" ? style.color : tone === "ink" ? style.ink : style.paper
}

export function drawGlyph(ctx: CanvasRenderingContext2D, kind: GlyphKind, o: DrawGlyphOptions): void {
  if (o.progress <= 0) return
  const ops = GLYPH_OPS[kind]
  const baseAlpha = ctx.globalAlpha
  ctx.save()
  ctx.translate(o.x, o.y)
  ctx.scale(o.radius, o.radius)
  ctx.lineCap = "round"
  ctx.lineJoin = "round"

  const wobbled = new Map<number, Map<Pt[], Pt[]>>()
  const shapePts = (op: StrokeOp | FillOp, pts: Pt[]): Pt[] => {
    let byPts = wobbled.get(op.shape)
    if (!byPts) wobbled.set(op.shape, (byPts = new Map()))
    let w = byPts.get(pts)
    if (!w) byPts.set(pts, (w = wobble(pts, o.seed + op.shape * 7.31, o.time)))
    return w
  }

  // Ink bleeding into wet paper: a soft halo in the glyph's own colour.
  if (o.bleed > 0.02) {
    ctx.shadowColor = o.style.color
    ctx.shadowBlur = 14 * o.bleed
  }

  for (const op of ops) {
    if (op.op !== "fill") continue
    const f = opFraction(op, o.progress)
    if (f <= 0) continue
    ctx.globalAlpha = baseAlpha * f * (op.alpha ?? 1)
    ctx.fillStyle = toneColor(op.tone, o.style)
    ctx.beginPath()
    traceClosed(ctx, shapePts(op, op.pts))
    if (op.hole) traceClosed(ctx, shapePts(op, op.hole).slice().reverse())
    ctx.fill("evenodd")
  }
  ctx.shadowBlur = 0
  ctx.globalAlpha = baseAlpha

  for (const op of ops) {
    if (op.op === "fill") continue
    const f = opFraction(op, o.progress)
    if (f <= 0) continue
    if (op.op === "dot") {
      ctx.fillStyle = o.style.ink
      ctx.beginPath()
      ctx.arc(op.at[0], op.at[1], op.radius * f, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    // A little pressure variation per stroke, never periodic along the line.
    ctx.lineWidth = op.width * (0.88 + 0.24 * (phase(o.seed, op.shape + 11) / (Math.PI * 2)))
    ctx.strokeStyle = toneColor(op.tone, o.style)
    ctx.beginPath()
    const pts = shapePts(op, op.pts)
    if (op.closed && f >= 1) traceClosed(ctx, pts)
    else tracePartial(ctx, pts, f)
    ctx.stroke()
  }
  ctx.restore()
}

/** Stable 0..1000 seed from a node id. */
export function seedFromId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 1000
}
