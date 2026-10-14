/**
 * Ink-on-paper knowledge graph canvas.
 *
 * d3-force physics (via force-graph) tuned to feel like rice paper in water:
 * heavy damping, a dragged node that trails the pointer, a slow float at rest,
 * and ink that bleeds while nodes move. Nodes are hand-drawn glyphs that grow
 * from one stroke to their resting form, and on hover (with their neighbours)
 * on to the finished pattern.
 */
import { useEffect, useRef } from "react"
import ForceGraph from "force-graph"
import { ZoomIn, ZoomOut, Maximize } from "lucide-react"
import type { GraphEdge, GraphNode } from "@/lib/wiki-graph"
import { REST_PROGRESS, drawGlyph, glyphForType, seedFromId, type GlyphKind } from "./ink-glyphs"
import { splitBilingualTitle } from "@/lib/bilingual-title"

export const INK_PAPER = "#F0EEE6"
export const INK = "#141413"
const LABEL_FONT = '-apple-system, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif'

/** Above this many nodes we drop breathing, drifting and ink bleed to stay smooth. */
const RICH_NODE_LIMIT = 800

const DRAW_IN_MS = 900
const GROW_MS = 1100
const SHRINK_MS = 350
const HOVER_FADE_MS = 320
const DRAG_FOLLOW = 0.14
const MAX_NEIGHBOUR_LABELS = 6
const EDGE_SEGMENTS = 16
const CAPTION_PX = 9
const CAPTION_ALPHA = 0.6
const CAPTION_MIN_RADIUS_PX = 7 // hide captions once glyphs shrink below this on screen
const CAPTION_MAX_CHARS = 8
const LABEL_MAX_CHARS = 42
const EDGE_ALPHA = 0.14
const EDGE_ACTIVE_ALPHA = 0.7
const EDGE_CALM_LENGTH = 110 // graph units; longer lines fade progressively
const HOVER_DELAY_MS = 260 // the pointer must rest this long before a glyph grows
const UNHOVER_DELAY_MS = 160 // fraction of the remaining distance a dragged node covers per frame

interface InkNode {
  id: string
  label: string
  en?: string
  zh?: string
  kind: GlyphKind
  color: string
  baseRadius: number
  seed: number
  // runtime state (force-graph also writes x/y/vx/vy/fx/fy)
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
  progress: number
  appearAt: number
  bleed: number
  lastX?: number
  lastY?: number
}

interface InkLink {
  source: string | InkNode
  target: string | InkNode
  seed: number
}

export interface InkGraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  colorFor: (node: GraphNode) => string
  nodeScale: number
  graphSpacing: number
  highlightedNodes: Set<string>
  onNodeClick: (nodeId: string) => void
  onNodeContextMenu: (nodeId: string, x: number, y: number) => void
}

// Glyphs keep this much room around them (hex spokes reach 1.32 r, plus hover growth).
const COLLIDE_SCALE = 1.45
const COLLIDE_PADDING = 3
const COLLIDE_NODE_LIMIT = 1500

/** Keeps glyphs from overlapping: pairs closer than their combined room push apart. */
function glyphCollision() {
  let nodes: InkNode[] = []
  return Object.assign(
    () => {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        const ra = a.baseRadius * COLLIDE_SCALE + COLLIDE_PADDING
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]
          const min = ra + b.baseRadius * COLLIDE_SCALE + COLLIDE_PADDING
          let dx = (b.x ?? 0) - (a.x ?? 0)
          let dy = (b.y ?? 0) - (a.y ?? 0)
          if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue
          let d = Math.hypot(dx, dy)
          if (d >= min) continue
          if (d === 0) {
            dx = 0.01 * (i - j)
            dy = 0.01
            d = Math.hypot(dx, dy)
          }
          const push = ((min - d) / d) * 0.35
          dx *= push
          dy *= push
          // A node held by the pointer stays put; the other one gives way.
          const aFree = a.fx === undefined
          const bFree = b.fx === undefined
          const share = aFree && bFree ? 1 : 2
          if (aFree) {
            a.vx = (a.vx ?? 0) - dx * share
            a.vy = (a.vy ?? 0) - dy * share
          }
          if (bFree) {
            b.vx = (b.vx ?? 0) + dx * share
            b.vy = (b.vy ?? 0) + dy * share
          }
        }
      }
    },
    { initialize: (ns: InkNode[]) => (nodes = ns) },
  )
}

/**
 * A still, hand-drawn ink line: a gentle one-sided bow and a pen pressure that
 * changes slowly and unevenly along the stroke, with a soft pen-down at the
 * start and a longer lift at the end. Drawn as a filled ribbon so the width
 * can vary; the shape is fixed per edge (no breathing) to keep the web calm.
 */
function drawInkLine(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  seed: number,
  width: number,
): void {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return
  const nx = -dy / len
  const ny = dx / len
  const bow = Math.min(len * 0.04, 6) * Math.sin(seed * 3.1)
  const left: Array<[number, number]> = []
  const right: Array<[number, number]> = []
  for (let i = 0; i <= EDGE_SEGMENTS; i++) {
    const u = i / EDGE_SEGMENTS
    const off = bow * Math.sin(u * Math.PI) + Math.min(len * 0.012, 1.6) * Math.sin(u * 4.3 + seed * 5.7) * Math.sin(u * Math.PI)
    const cx = ax + dx * u + nx * off
    const cy = ay + dy * u + ny * off
    const pressure = 0.8 + 0.28 * Math.sin(u * 2.3 + seed * 1.9) + 0.12 * Math.sin(u * 5.9 + seed * 4.1)
    const lift = Math.min(1, u / 0.08) * Math.min(1, (1 - u) / 0.2)
    const w = (width * pressure * (0.35 + 0.65 * lift)) / 2
    left.push([cx + nx * w, cy + ny * w])
    right.push([cx - nx * w, cy - ny * w])
  }
  ctx.beginPath()
  ctx.moveTo(left[0][0], left[0][1])
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1])
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1])
  ctx.closePath()
  ctx.fill()
}

// Positions survive remounts (panel resizes) and data refreshes.
const positionCache = new Map<string, { x: number; y: number }>()

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function endpointId(end: string | InkNode): string {
  return typeof end === "string" ? end : end.id
}

export function InkGraphCanvas({
  nodes,
  edges,
  colorFor,
  nodeScale,
  graphSpacing,
  highlightedNodes,
  onNodeClick,
  onNodeContextMenu,
}: InkGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraph<InkNode, InkLink> | null>(null)
  const callbacks = useRef({ onNodeClick, onNodeContextMenu })
  callbacks.current = { onNodeClick, onNodeContextMenu }
  const highlightRef = useRef(highlightedNodes)
  highlightRef.current = highlightedNodes

  // Interaction state read by the render callbacks every frame.
  const live = useRef({
    hovered: null as InkNode | null,
    pending: null as null | { node: InkNode | null; since: number },
    neighbours: new Set<string>(),
    labelled: new Set<string>(), // hovered node + its best-connected neighbours
    labels: [] as Array<{ en?: string; zh?: string; x: number; y: number; alpha: number; priority: number }>,
    captions: [] as Array<{ text: string; x: number; y: number; alpha: number; priority: number }>,
    adjacency: new Map<string, Set<string>>(),
    hoverT: 0,
    lastFrame: 0,
    rich: true,
    drag: null as null | { node: InkNode; tx: number; ty: number; sx: number; sy: number },
    fitted: false,
  })

  // Create the force-graph instance once.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const L = live.current
    const fg = new ForceGraph<InkNode, InkLink>(el)

    const growTarget = (n: InkNode): number => {
      const rest = REST_PROGRESS[n.kind]
      if (L.hovered && (L.hovered === n || L.neighbours.has(n.id))) return 1
      if (highlightRef.current.has(n.id)) return 1
      return rest
    }

    fg.backgroundColor(INK_PAPER)
      .nodeId("id")
      .d3VelocityDecay(0.6)
      .d3AlphaDecay(0.012)
      .minZoom(0.15)
      .maxZoom(8)
      .nodeCanvasObjectMode(() => "replace")
      .linkCanvasObjectMode(() => "replace")
      .nodePointerAreaPaint((node, color, ctx) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(node.x ?? 0, node.y ?? 0, node.baseRadius * 1.35, 0, Math.PI * 2)
        ctx.fill()
      })
      .onRenderFramePost((ctx, scale) => {
        // Text goes on top of every glyph, with a thin paper-coloured edge so
        // lines passing behind it don't cut through the letters.
        ctx.lineJoin = "round"
        ctx.strokeStyle = INK_PAPER
        ctx.fillStyle = INK
        // Small Chinese captions, centred under each glyph.
        ctx.font = `400 ${CAPTION_PX / scale}px ${LABEL_FONT}`
        ctx.textAlign = "center"
        ctx.textBaseline = "top"
        ctx.lineWidth = 2.5 / scale
        // Bigger glyphs claim their caption space first; a caption that would
        // overlap one already placed waits until the user zooms in.
        const placed: Array<[number, number, number, number]> = []
        const lineH = (CAPTION_PX + 2) / scale
        L.captions.sort((a, b) => b.priority - a.priority)
        for (const c of L.captions) {
          const w = ctx.measureText(c.text).width + 4 / scale
          const box: [number, number, number, number] = [c.x - w / 2, c.y, c.x + w / 2, c.y + lineH]
          if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue
          placed.push(box)
          ctx.globalAlpha = c.alpha
          ctx.strokeText(c.text, c.x, c.y)
          ctx.fillText(c.text, c.x, c.y)
        }
        // Hover labels: English first, then the Chinese name in small type below.
        ctx.textAlign = "left"
        ctx.textBaseline = "middle"
        ctx.lineWidth = 3 / scale
        // Same courtesy for hover labels: the hovered node first, then bigger
        // neighbours; a label that would collide is left out.
        const taken: Array<[number, number, number, number]> = []
        L.labels.sort((a, b) => b.priority - a.priority)
        for (const l of L.labels) {
          const main = truncate(l.en ?? l.zh ?? "", LABEL_MAX_CHARS)
          const sub = l.en ? l.zh : undefined
          const y = sub ? l.y - 6 / scale : l.y
          ctx.font = `400 ${13 / scale}px ${LABEL_FONT}`
          const w = ctx.measureText(main).width
          const box: [number, number, number, number] = [l.x, y - 9 / scale, l.x + w, y + (sub ? 22 : 9) / scale]
          if (taken.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue
          taken.push(box)
          ctx.globalAlpha = l.alpha
          ctx.strokeText(main, l.x, y)
          ctx.fillText(main, l.x, y)
          if (sub) {
            ctx.font = `400 ${10 / scale}px ${LABEL_FONT}`
            ctx.globalAlpha = l.alpha * 0.7
            ctx.strokeText(truncate(sub, CAPTION_MAX_CHARS * 2), l.x, y + 14 / scale)
            ctx.fillText(truncate(sub, CAPTION_MAX_CHARS * 2), l.x, y + 14 / scale)
          }
        }
        ctx.globalAlpha = 1
        L.labels = []
        L.captions = []
      })
      .onRenderFramePre(() => {
        const now = performance.now()
        const dt = L.lastFrame ? Math.min(64, now - L.lastFrame) : 16
        L.lastFrame = now
        // Commit a hover only after the pointer rests on (or off) a node.
        if (L.pending && L.pending.node !== L.hovered) {
          const wait = L.pending.node ? HOVER_DELAY_MS : UNHOVER_DELAY_MS
          if (now - L.pending.since >= wait) {
            const node = L.pending.node
            L.hovered = node
            L.neighbours = node ? (L.adjacency.get(node.id) ?? new Set()) : new Set()
            if (node) {
              const byId = new Map(fg.graphData().nodes.map((n) => [n.id, n]))
              const top = [...L.neighbours]
                .map((id) => byId.get(id))
                .filter((n): n is InkNode => !!n)
                .sort((a, b) => b.baseRadius - a.baseRadius)
                .slice(0, MAX_NEIGHBOUR_LABELS)
              L.labelled = new Set([node.id, ...top.map((n) => n.id)])
            }
          }
        }
        // Global hover fade.
        const hoverTarget = L.hovered ? 1 : 0
        L.hoverT += Math.sign(hoverTarget - L.hoverT) * (dt / HOVER_FADE_MS)
        L.hoverT = Math.min(1, Math.max(0, L.hoverT))
        // Dragged node trails the pointer like paper pulled through water.
        if (L.drag) {
          const d = L.drag
          d.sx += (d.tx - d.sx) * DRAG_FOLLOW
          d.sy += (d.ty - d.sy) * DRAG_FOLLOW
          d.node.fx = d.node.x = d.sx
          d.node.fy = d.node.y = d.sy
        }
        for (const n of fg.graphData().nodes) {
          // Growth: draw-in after appearAt, then towards rest or full.
          if (now >= n.appearAt) {
            const target = growTarget(n)
            const span = n.progress < REST_PROGRESS[n.kind] && target > n.progress ? DRAW_IN_MS / REST_PROGRESS[n.kind] : target > n.progress ? GROW_MS : SHRINK_MS
            const step = dt / span
            n.progress = target > n.progress ? Math.min(target, n.progress + step) : Math.max(target, n.progress - step)
          }
          // Ink bleed follows speed quickly, then dries slowly.
          if (L.rich) {
            const speed = n.lastX === undefined ? 0 : Math.hypot((n.x ?? 0) - n.lastX, (n.y ?? 0) - (n.lastY ?? 0))
            const target = Math.min(1, speed / 2.5)
            n.bleed += (target - n.bleed) * (target > n.bleed ? 0.25 : 0.035)
          }
          n.lastX = n.x
          n.lastY = n.y
        }
      })
      .linkCanvasObject((link, ctx, scale) => {
        const s = link.source as InkNode
        const t = link.target as InkNode
        if (s.x === undefined || t.x === undefined) return
        const related = L.hovered && (s === L.hovered || t === L.hovered)
        const hl = highlightRef.current
        const dimmed = (L.hovered && !related) || (hl.size > 0 && !(hl.has(s.id) && hl.has(t.id)))
        const dxAll = (t.x ?? 0) - s.x
        const dyAll = (t.y ?? 0) - (s.y ?? 0)
        // Long lines that cross between clusters recede so the web stays calm.
        const recede = Math.min(1, (EDGE_CALM_LENGTH / (Math.hypot(dxAll, dyAll) || 1)) ** 0.8)
        const rest = EDGE_ALPHA * recede
        const alpha = related
          ? rest + (EDGE_ACTIVE_ALPHA - rest) * L.hoverT
          : dimmed
            ? rest * (1 - 0.6 * Math.max(L.hoverT, hl.size ? 1 : 0))
            : rest
        const dx = (t.x ?? 0) - s.x
        const dy = (t.y ?? 0) - (s.y ?? 0)
        const len = Math.hypot(dx, dy) || 1
        // Lines stop at each glyph's edge so hollow glyphs keep the paper inside.
        const gapS = s.baseRadius * 1.15
        const gapT = t.baseRadius * 1.15
        if (len <= gapS + gapT) return
        const ux = dx / len
        const uy = dy / len
        const ax = s.x + ux * gapS
        const ay = (s.y ?? 0) + uy * gapS
        const bx = (t.x ?? 0) - ux * gapT
        const by = (t.y ?? 0) - uy * gapT
        ctx.globalAlpha = alpha
        ctx.fillStyle = INK
        drawInkLine(ctx, ax, ay, bx, by, link.seed, (related ? 1.5 : 1) / scale)
        ctx.globalAlpha = 1
      })
      .nodeCanvasObject((n, ctx, scale) => {
        const hl = highlightRef.current
        const isHover = L.hovered === n
        const isNeighbour = L.neighbours.has(n.id)
        const inFocus = isHover || isNeighbour
        let alpha = 1
        if (L.hovered && !inFocus) alpha = 1 - 0.75 * L.hoverT
        else if (!L.hovered && hl.size > 0 && !hl.has(n.id)) alpha = 0.25
        const radius = n.baseRadius * (isHover ? 1 + 0.25 * L.hoverT : 1)
        ctx.globalAlpha = alpha
        drawGlyph(ctx, n.kind, {
          x: n.x ?? 0,
          y: n.y ?? 0,
          radius,
          progress: n.progress,
          seed: n.seed,
          time: L.rich ? performance.now() : 0,
          bleed: L.rich ? n.bleed : 0,
          style: { color: n.color, ink: INK, paper: INK_PAPER },
        })
        const labelAlpha = inFocus && L.labelled.has(n.id) ? L.hoverT : hl.has(n.id) && !L.hovered ? 1 : 0
        if (labelAlpha > 0.02) {
          L.labels.push({
            en: n.en,
            zh: n.zh,
            x: (n.x ?? 0) + radius * 1.45 + 4 / scale,
            y: n.y ?? 0,
            alpha: labelAlpha,
            priority: isHover ? Infinity : n.baseRadius,
          })
        }
        // The small Chinese caption under every glyph, while it is big enough to read
        // and not already shown in the full label.
        const onScreenRadius = n.baseRadius * scale
        if (n.zh && labelAlpha < 0.98 && onScreenRadius >= CAPTION_MIN_RADIUS_PX) {
          const fadeIn = Math.min(1, (onScreenRadius - CAPTION_MIN_RADIUS_PX) / 3)
          L.captions.push({
            text: truncate(n.zh, CAPTION_MAX_CHARS),
            x: n.x ?? 0,
            y: (n.y ?? 0) + n.baseRadius * 1.4 + 3 / scale,
            // Background captions step aside completely while something is hovered.
            alpha: (inFocus ? 1 : 1 - L.hoverT) * (hl.size > 0 && !hl.has(n.id) ? 0 : 1) * fadeIn * (1 - labelAlpha) * CAPTION_ALPHA,
            priority: n.baseRadius,
          })
        }
        ctx.globalAlpha = 1
      })
      .onNodeHover((node) => {
        // Only remember where the pointer is; onRenderFramePre commits the hover
        // once the pointer has rested, so sweeping across the graph stays quiet.
        L.pending = { node: node ?? null, since: performance.now() }
        el.style.cursor = node ? "pointer" : "default"
      })
      .onNodeClick((node) => callbacks.current.onNodeClick(node.id))
      .onNodeRightClick((node, event) => {
        event.preventDefault()
        callbacks.current.onNodeContextMenu(node.id, event.clientX, event.clientY)
      })
      .onBackgroundRightClick(() => callbacks.current.onNodeContextMenu("", 0, 0))
      .onNodeDrag((node, translate) => {
        // force-graph has just snapped the node to the pointer; remember that as
        // the target and let onRenderFramePre ease the node towards it.
        const tx = node.fx ?? node.x ?? 0
        const ty = node.fy ?? node.y ?? 0
        if (!L.drag || L.drag.node !== node) {
          L.drag = { node, tx, ty, sx: tx - translate.x, sy: ty - translate.y }
        }
        L.drag.tx = tx
        L.drag.ty = ty
        node.fx = node.x = L.drag.sx
        node.fy = node.y = L.drag.sy
      })
      .onNodeDragEnd((node) => {
        L.drag = null
        node.fx = undefined
        node.fy = undefined
        positionCache.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 })
      })
      .onEngineTick(() => {
        for (const n of fg.graphData().nodes) positionCache.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 })
      })

    graphRef.current = fg
    // Once the user scrolls or grabs the canvas, stop auto-fitting the camera.
    const takeOver = () => {
      L.fitted = true
    }
    el.addEventListener("wheel", takeOver, { passive: true })
    el.addEventListener("pointerdown", takeOver)
    const resize = new ResizeObserver(([entry]) => {
      fg.width(entry.contentRect.width).height(entry.contentRect.height)
    })
    resize.observe(el)
    return () => {
      el.removeEventListener("wheel", takeOver)
      el.removeEventListener("pointerdown", takeOver)
      resize.disconnect()
      fg._destructor()
      graphRef.current = null
    }
  }, [])

  // Feed data whenever nodes, edges or styling change.
  useEffect(() => {
    const fg = graphRef.current
    if (!fg) return
    const L = live.current
    L.rich = nodes.length <= RICH_NODE_LIMIT
    L.fitted = false
    const previous = new Map(fg.graphData().nodes.map((n) => [n.id, n]))
    const maxLinks = Math.max(1, ...nodes.map((n) => n.linkCount))
    const now = performance.now()

    const inkNodes: InkNode[] = nodes.map((n, i) => {
      const prev = previous.get(n.id)
      const cached = positionCache.get(n.id)
      const kind = glyphForType(n.type, n.subtype)
      const names = splitBilingualTitle(n.label, n.titleZh)
      return {
        id: n.id,
        label: n.label,
        en: names.en,
        zh: names.zh,
        kind,
        color: colorFor(n),
        baseRadius: (6 + Math.sqrt(n.linkCount / maxLinks) * 12) * nodeScale,
        seed: seedFromId(n.id),
        x: prev?.x ?? cached?.x,
        y: prev?.y ?? cached?.y,
        // Existing glyphs keep their growth; new ones draw themselves in, staggered.
        progress: prev ? Math.min(prev.progress, REST_PROGRESS[kind]) : 0,
        appearAt: prev ? 0 : now + Math.min(i * 6, 1200),
        bleed: 0,
      }
    })
    const ids = new Set(inkNodes.map((n) => n.id))
    const links: InkLink[] = edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, seed: seedFromId(`${e.source}->${e.target}`) / 160 }))

    L.adjacency = new Map()
    for (const l of links) {
      const s = endpointId(l.source)
      const t = endpointId(l.target)
      if (!L.adjacency.has(s)) L.adjacency.set(s, new Set())
      if (!L.adjacency.has(t)) L.adjacency.set(t, new Set())
      L.adjacency.get(s)!.add(t)
      L.adjacency.get(t)!.add(s)
    }

    // Gentle pull to the centre so separate islands stay in view, like paper
    // pieces gathering in the middle of a bowl of water.
    let gravityNodes: InkNode[] = []
    const gravity = Object.assign(
      (alpha: number) => {
        for (const n of gravityNodes) {
          n.vx = (n.vx ?? 0) - (n.x ?? 0) * 0.04 * alpha
          n.vy = (n.vy ?? 0) - (n.y ?? 0) * 0.04 * alpha
        }
      },
      { initialize: (ns: InkNode[]) => (gravityNodes = ns) },
    )
    fg.d3Force("gravity", gravity)
    fg.d3Force("collide", inkNodes.length <= COLLIDE_NODE_LIMIT ? glyphCollision() : null)
    const charge = fg.d3Force("charge")
    charge?.strength?.(-60 * graphSpacing)
    const link = fg.d3Force("link")
    link?.distance?.((l: InkLink) => {
      const s = l.source as InkNode
      const t = l.target as InkNode
      return (s.baseRadius + t.baseRadius) * COLLIDE_SCALE + 24 * graphSpacing
    })

    if (L.rich) {
      // Paper floating on water: a slow shared current plus a little personal sway.
      // It ignores alpha on purpose so the drift never stops.
      let driftNodes: InkNode[] = []
      const drift = Object.assign(
        () => {
          const t = performance.now() / 1000
          const sharedX = Math.sin(t * 0.21) * 0.008
          const sharedY = Math.cos(t * 0.17) * 0.008
          for (const n of driftNodes) {
            n.vx = (n.vx ?? 0) + sharedX + 0.004 * Math.sin(t * 0.33 + n.seed)
            n.vy = (n.vy ?? 0) + sharedY + 0.004 * Math.cos(t * 0.29 + n.seed * 1.7)
          }
        },
        { initialize: (ns: InkNode[]) => (driftNodes = ns) },
      )
      fg.d3Force("drift", drift).d3AlphaMin(0).cooldownTime(Infinity).autoPauseRedraw(false)
    } else {
      fg.d3Force("drift", null).d3AlphaMin(0.001).cooldownTime(15000).autoPauseRedraw(true)
    }

    fg.graphData({ nodes: inkNodes, links })
    if (inkNodes.some((n) => n.x === undefined)) fg.d3ReheatSimulation()
    // Fit once while the paper unfolds and again when it has mostly settled,
    // unless the user has started zooming or panning in the meantime.
    const timers = (previous.size ? [300] : [900, 3200]).map((ms) =>
      window.setTimeout(() => {
        if (!L.fitted) fg.zoomToFit(700, 48)
      }, ms),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [nodes, edges, colorFor, nodeScale, graphSpacing])

  const zoomBy = (factor: number) => {
    const fg = graphRef.current
    if (fg) fg.zoom(fg.zoom() * factor, 260)
  }

  return (
    <div className="relative h-full w-full" style={{ background: INK_PAPER }}>
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute top-3 right-3 flex flex-col gap-1" style={{ color: INK }}>
        {[
          { icon: ZoomIn, onClick: () => zoomBy(1.35), label: "zoom in" },
          { icon: ZoomOut, onClick: () => zoomBy(1 / 1.35), label: "zoom out" },
          { icon: Maximize, onClick: () => graphRef.current?.zoomToFit(500, 48), label: "fit" },
        ].map(({ icon: Icon, onClick, label }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={onClick}
            className="flex h-7 w-7 items-center justify-center rounded-sm opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
    </div>
  )
}
