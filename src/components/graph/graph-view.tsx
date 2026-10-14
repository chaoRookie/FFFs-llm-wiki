import { useEffect, useCallback, useMemo, useState, useRef, type ChangeEvent, type SetStateAction } from "react"
import { INK, INK_PAPER, InkGraphCanvas } from "./ink-graph-canvas"
import { drawGlyph, type GlyphKind } from "./ink-glyphs"
import { Network, RefreshCw, Layers, Tag, Lightbulb, AlertTriangle, Link2, X, Search, Loader2, Filter, RotateCcw, EyeOff } from "lucide-react"
import { ErrorBoundary } from "@/components/error-boundary"
import { useResearchStore } from "@/stores/research-store"
import { Button } from "@/components/ui/button"
import { useWikiStore, type GraphColorMode } from "@/stores/wiki-store"
import { readFile, writeFile } from "@/commands/fs"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { FilePreview } from "@/components/editor/file-preview"
import { buildWikiGraph, type GraphNode, type GraphEdge, type CommunityInfo } from "@/lib/wiki-graph"
import { findSurprisingConnections, detectKnowledgeGaps, researchSeedForKnowledgeGap, type SurprisingConnection, type KnowledgeGap } from "@/lib/graph-insights"
import { queueResearch } from "@/lib/deep-research"
import { optimizeResearchTopic } from "@/lib/optimize-research-topic"
import { groundedFallbackResearchQuery } from "@/lib/research-query-grounding"
import { getFileName, normalizePath } from "@/lib/path-utils"
import { getFileCategory } from "@/lib/file-types"
import { applyGraphFilters, hasActiveGraphFilters, type GraphFilterState } from "@/lib/graph-filters"
import { applyGraphSearch } from "@/lib/graph-search"
import { wikiTypeLabel } from "@/lib/wiki-page-types"
import { useTranslation } from "react-i18next"

const NODE_TYPE_COLORS: Record<string, string> = {
  entity: "#60a5fa",    // blue-400
  concept: "#c084fc",   // purple-400
  source: "#fb923c",    // orange-400
  query: "#4ade80",     // green-400
  synthesis: "#f87171", // red-400
  overview: "#facc15",  // yellow-400
  comparison: "#2dd4bf", // teal-400
  finding: "#a855f7",    // purple-500
  thesis: "#f43f5e",     // rose-500
  methodology: "#14b8a6", // teal-500
  other: "#94a3b8",     // slate-400
}

// Trunk color mode: one color per top-level knowledge trunk (frontmatter `trunk`).
const TRUNK_COLORS: Record<string, string> = {
  科研读博: "#D97757",
  AI工具经验: "#6A9BCC",
  第二大脑: "#788C5D",
}
const NO_TRUNK_COLOR = "#B9B5AA"

function trunkColor(trunk: string | undefined): string {
  if (!trunk) return NO_TRUNK_COLOR
  if (TRUNK_COLORS[trunk]) return TRUNK_COLORS[trunk]
  let hash = 0
  for (const char of trunk) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return CUSTOM_NODE_COLORS[hash % CUSTOM_NODE_COLORS.length] ?? NO_TRUNK_COLOR
}

const CUSTOM_NODE_COLORS = [
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#a78bfa",
  "#22d3ee",
  "#f97316",
  "#84cc16",
]

const COMMUNITY_COLORS = [
  "#60a5fa",  // blue-400
  "#4ade80",  // green-400
  "#fb923c",  // orange-400
  "#c084fc",  // purple-400
  "#f87171",  // red-400
  "#2dd4bf",  // teal-400
  "#facc15",  // yellow-400
  "#f472b6",  // pink-400
  "#a78bfa",  // violet-400
  "#38bdf8",  // sky-400
  "#34d399",  // emerald-400
  "#fbbf24",  // amber-400
]

const DEFAULT_GRAPH_SPACING = 1
const GRAPH_SPACING_DEBOUNCE_MS = 180
type GraphPreview = {
  path: string
  title: string
  content: string
}

const GLYPH_LEGEND: Array<{ kind: GlyphKind; labelKey: string }> = [
  { kind: "hex", labelKey: "graph.glyphModel" },
  { kind: "globe", labelKey: "graph.glyphEntity" },
  { kind: "ring", labelKey: "graph.glyphConcept" },
  { kind: "petal", labelKey: "graph.glyphSource" },
  { kind: "dna", labelKey: "graph.glyphSession" },
]

/** A finished glyph drawn with the graph's own ink code, for the legend. */
function GlyphMark({ kind }: { kind: GlyphKind }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const size = 16
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)
    drawGlyph(ctx, kind, {
      x: size / 2,
      y: size / 2,
      radius: kind === "hex" ? 5.2 : 6.2,
      progress: 1,
      seed: 7,
      time: 0,
      bleed: 0,
      style: { color: "#B9B5AA", ink: INK, paper: INK_PAPER },
    })
  }, [kind])
  return <canvas ref={ref} className="h-4 w-4 shrink-0" aria-hidden="true" />
}

/** Small hand-drawn globe used as the trunk legend mark. */
function GlobeMark({ color }: { color: string }) {
  return (
    <svg viewBox="-12 -12 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <circle r="10" fill={color} stroke={INK} strokeWidth="1.6" />
      <ellipse rx="4.6" ry="10" fill="none" stroke={INK} strokeWidth="1.2" />
      <path d="M-10 0H10M-8.4-5.2Q0-7.4 8.4-5.2M-8.4 5.2Q0 7.4 8.4 5.2" fill="none" stroke={INK} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function nodeColor(type: string): string {
  if (NODE_TYPE_COLORS[type]) return NODE_TYPE_COLORS[type]
  let hash = 0
  for (const char of type) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return CUSTOM_NODE_COLORS[hash % CUSTOM_NODE_COLORS.length] ?? NODE_TYPE_COLORS.other
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// --- Main component ---

export function GraphView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [communities, setCommunities] = useState<CommunityInfo[]>([])
  const [surprisingConns, setSurprisingConns] = useState<SurprisingConnection[]>([])
  const [knowledgeGaps, setKnowledgeGaps] = useState<KnowledgeGap[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredType, setHoveredType] = useState<string | null>(null)
  const graphUiState = useWikiStore((s) => s.graphUiState)
  const setGraphUiState = useWikiStore((s) => s.setGraphUiState)
  const resetGraphUiState = useWikiStore((s) => s.resetGraphUiState)
  const colorMode = graphUiState.colorMode
  const filters = graphUiState.filters
  const nodeScale = graphUiState.nodeScale
  const graphSpacingDraft = graphUiState.graphSpacingDraft
  const nodeColorFor = useCallback(
    (node: GraphNode) =>
      colorMode === "community"
        ? COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length]
        : colorMode === "trunk"
          ? trunkColor(node.trunk)
          : nodeColor(node.type),
    [colorMode],
  )
  const [showInsights, setShowInsights] = useState(false)
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set())
  const [dismissedInsights, setDismissedInsights] = useState<Set<string>>(new Set())
  const [sigmaKey, setSigmaKey] = useState(0)
  const [isResizing, setIsResizing] = useState(false)
  const [legendCollapsed, setLegendCollapsed] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [graphSearchOpen, setGraphSearchOpen] = useState(false)
  const [graphSearch, setGraphSearch] = useState("")
  const [graphSpacing, setGraphSpacing] = useState(graphSpacingDraft)
  const [graphPreview, setGraphPreview] = useState<GraphPreview | null>(null)
  const [nodeMenu, setNodeMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const graphContainerRef = useRef<HTMLDivElement>(null)
  const researchDialogTokenRef = useRef(0)
  // i18n node type labels (populated after mount to support language switching)
  const [nodeTypeLabels, setNodeTypeLabels] = useState<Record<string, string>>({})
  const graphSearchInputRef = useRef<HTMLInputElement>(null)

  const setColorMode = useCallback((colorMode: GraphColorMode) => {
    setGraphUiState((prev) => ({ ...prev, colorMode }))
  }, [setGraphUiState])

  const setFilters = useCallback((next: SetStateAction<GraphFilterState>) => {
    setGraphUiState((prev) => ({
      ...prev,
      filters: typeof next === "function" ? next(prev.filters) : next,
    }))
  }, [setGraphUiState])

  const setNodeScale = useCallback((nodeScale: number) => {
    setGraphUiState((prev) => ({ ...prev, nodeScale }))
  }, [setGraphUiState])

  const setGraphSpacingDraft = useCallback((graphSpacingDraft: number) => {
    setGraphUiState((prev) => ({ ...prev, graphSpacingDraft }))
  }, [setGraphUiState])

  // Research confirmation dialog
  const [researchDialog, setResearchDialog] = useState<{
    loading: boolean
    topic: string
    queries: string[]
    dismissKey?: string
  } | null>(null)
  const lastLoadedVersion = useRef(-1)
  const graphLoadRequest = useRef(0)

  const loadGraph = useCallback(async () => {
    if (!project) return
    const requestId = ++graphLoadRequest.current
    setLoading(true)
    setError(null)
    try {
      const result = await buildWikiGraph(
        normalizePath(project.path),
        useWikiStore.getState().dataVersion,
      )
      if (requestId !== graphLoadRequest.current) return
      setNodes(result.nodes)
      setEdges(result.edges)
      setCommunities(result.communities)
      setSurprisingConns(findSurprisingConnections(result.nodes, result.edges, result.communities))
      setKnowledgeGaps(detectKnowledgeGaps(result.nodes, result.edges, result.communities))
      lastLoadedVersion.current = useWikiStore.getState().dataVersion
    } catch (err) {
      if (requestId !== graphLoadRequest.current) return
      const message = err instanceof Error ? err.message : "Failed to build graph"
      setError(message)
    } finally {
      if (requestId === graphLoadRequest.current) setLoading(false)
    }
  }, [project])

  // Initialize node type labels when i18n is ready
  useEffect(() => {
    setNodeTypeLabels({
      entity: t("graph.nodeTypeLabels.entity"),
      concept: t("graph.nodeTypeLabels.concept"),
      source: t("graph.nodeTypeLabels.source"),
      query: t("graph.nodeTypeLabels.query"),
      synthesis: t("graph.nodeTypeLabels.synthesis"),
      overview: t("graph.nodeTypeLabels.overview"),
      comparison: t("graph.nodeTypeLabels.comparison"),
      finding: t("graph.nodeTypeLabels.finding"),
      thesis: t("graph.nodeTypeLabels.thesis"),
      methodology: t("graph.nodeTypeLabels.methodology"),
      other: t("graph.nodeTypeLabels.other"),
    })
  }, [t])

  // Spacing changes trigger ForceAtlas2 layout through GraphLoader's dataKey.
  // Keep the slider responsive while debouncing the expensive relayout.
  useEffect(() => {
    const timer = window.setTimeout(() => setGraphSpacing(graphSpacingDraft), GRAPH_SPACING_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [graphSpacingDraft])

  useEffect(() => {
    if (dataVersion !== lastLoadedVersion.current) {
      loadGraph()
    }
  }, [loadGraph, dataVersion])

  useEffect(() => {
    if (!graphSearchOpen) return
    const id = window.requestAnimationFrame(() => graphSearchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [graphSearchOpen])

  const handleNodeClick = useCallback(
    async (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return
      try {
        const content = await readFile(node.path)
        setGraphPreview({
          path: node.path,
          title: node.label || getFileName(node.path),
          content,
        })
      } catch (err) {
        console.error("Failed to open wiki page:", err)
      }
    },
    [nodes],
  )

  const handleNodeContextMenu = useCallback((nodeId: string, x: number, y: number) => {
    if (!nodeId) {
      setNodeMenu(null)
      return
    }
    const rect = graphContainerRef.current?.getBoundingClientRect()
    setNodeMenu({
      nodeId,
      x: rect ? x - rect.left : x,
      y: rect ? y - rect.top : y,
    })
  }, [])

  const resetFilters = useCallback(() => {
    resetGraphUiState()
    setGraphSpacing(DEFAULT_GRAPH_SPACING)
    setNodeMenu(null)
  }, [resetGraphUiState])

  const knowledgeGapKey = useCallback((gap: KnowledgeGap) => (
    `gap:${gap.type}:${gap.title}:${gap.nodeIds.join(",")}`
  ), [])

  const visibleKnowledgeGaps = useMemo(
    () => knowledgeGaps.filter((gap) => !dismissedInsights.has(knowledgeGapKey(gap))),
    [dismissedInsights, knowledgeGaps, knowledgeGapKey],
  )

  const dismissInsight = useCallback((key: string, ids?: Set<string>) => {
    setDismissedInsights((prev) => new Set([...prev, key]))
    if (ids && highlightedNodes.size === ids.size && [...ids].every((id) => highlightedNodes.has(id))) {
      setHighlightedNodes(new Set())
    }
  }, [highlightedNodes])

  const handleResearchClick = useCallback(async (gap: KnowledgeGap, dismissKey?: string) => {
    const store = useWikiStore.getState()
    if (!store.project) return
    const pp = normalizePath(store.project.path)
    const token = researchDialogTokenRef.current + 1
    researchDialogTokenRef.current = token
    const { term: gapTerm, context: gapContext } = researchSeedForKnowledgeGap(gap, nodes)

    // Show loading state
    setResearchDialog({ loading: true, topic: "", queries: [], dismissKey })

    try {
      // Read overview and purpose for context
      let overview = ""
      let purpose = ""
      try { overview = await readFile(`${pp}/wiki/overview.md`) } catch {}
      try { purpose = await readFile(`${pp}/purpose.md`) } catch {}

      const result = await optimizeResearchTopic(
        store.llmConfig,
        gapTerm,
        gapContext,
        gap.type,
        overview,
        purpose,
      )
      if (researchDialogTokenRef.current !== token) return
      setResearchDialog({ loading: false, topic: result.topic, queries: result.searchQueries, dismissKey })
    } catch {
      if (researchDialogTokenRef.current !== token) return
      setResearchDialog({
        loading: false,
        topic: gapTerm,
        queries: [groundedFallbackResearchQuery(gapTerm, gapContext)],
        dismissKey,
      })
    }
  }, [nodes])

  const handleResearchConfirm = useCallback(() => {
    if (!researchDialog) return
    const store = useWikiStore.getState()
    if (!store.project) return
    queueResearch(
      normalizePath(store.project.path),
      researchDialog.topic,
      store.llmConfig,
      store.searchApiConfig,
      researchDialog.queries,
    )
    if (researchDialog.dismissKey) {
      setDismissedInsights((prev) => new Set([...prev, researchDialog.dismissKey!]))
      setHighlightedNodes(new Set())
    }
    setResearchDialog(null)
  }, [researchDialog])

  // Unmount sigma when panels resize or toggle to prevent WebGL crash.
  // Sigma crashes with "could not find suitable program for node type circle"
  // when its canvas is resized by external layout changes.

  // 1. Detect panel open/close (local graph preview, researchPanel, insights)
  const researchPanelForLayout = useResearchStore((s) => s.panelOpen)
  const layoutKey = `${!!graphPreview}-${researchPanelForLayout}-${showInsights}`
  const prevLayoutKey = useRef(layoutKey)

  useEffect(() => {
    if (prevLayoutKey.current !== layoutKey) {
      prevLayoutKey.current = layoutKey
      setIsResizing(true)
      const timer = setTimeout(() => {
        setSigmaKey((k) => k + 1)
        setIsResizing(false)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [layoutKey])

  // 2. Detect panel drag resize via data-panel-resizing attribute on body
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const dragging = document.body.dataset.panelResizing === "true"
      if (dragging && !isResizing) {
        setIsResizing(true)
      }
      if (!dragging && isResizing) {
        // Drag ended — remount sigma after a tick
        setTimeout(() => {
          setSigmaKey((k) => k + 1)
          setIsResizing(false)
        }, 50)
      }
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-panel-resizing"] })
    return () => observer.disconnect()
  }, [isResizing])

  // Count nodes by trunk for the trunk legend (known trunks first, unclassified last)
  const trunkCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of nodes) counts.set(n.trunk ?? "", (counts.get(n.trunk ?? "") ?? 0) + 1)
    const known = Object.keys(TRUNK_COLORS)
    return [...counts.entries()].sort(([a], [b]) => {
      const rank = (k: string) => (k === "" ? 1e9 : known.includes(k) ? known.indexOf(k) : 1e6)
      return rank(a) - rank(b) || a.localeCompare(b)
    })
  }, [nodes])

  // Count nodes by type for legend
  const typeCounts = nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1
    return acc
  }, {})
  const nodeTypeLabelMap = useMemo(() => {
    const labels = { ...nodeTypeLabels }
    for (const type of Object.keys(typeCounts)) {
      labels[type] ??= wikiTypeLabel(type)
    }
    return labels
  }, [nodeTypeLabels, typeCounts])

  const filteredGraph = useMemo(
    () => applyGraphFilters(nodes, edges, filters),
    [nodes, edges, filters],
  )
  const searchedGraph = useMemo(
    () => applyGraphSearch(filteredGraph.nodes, filteredGraph.edges, graphSearch),
    [filteredGraph.nodes, filteredGraph.edges, graphSearch],
  )
  const searchActive = graphSearch.trim().length > 0
  const hiddenCount = nodes.length - filteredGraph.nodes.length
  const filtersActive = hasActiveGraphFilters(filters)
  const contextNode = nodeMenu ? nodes.find((node) => node.id === nodeMenu.nodeId) : null

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm">{t("graph.openProject")}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <RefreshCw className="h-8 w-8 animate-spin opacity-50" />
        <p className="text-sm">{t("graph.buildingGraph")}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={loadGraph}>{t("graph.retry")}</Button>
      </div>
    )
  }

  if (!loading && nodes.length === 0 && !error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Network className="h-10 w-10 opacity-30" />
        <p className="text-sm">{t("graph.noPages")}</p>
        <p className="text-xs">{t("graph.importSourcesHint")}</p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 shrink-0">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("graph.knowledgeGraph")}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5">{searchedGraph.nodes.length}/{nodes.length} {t("graph.pages", { count: nodes.length })}</span>
            <span className="rounded bg-muted px-1.5 py-0.5">{searchedGraph.edges.length}/{edges.length} {t("graph.links", { count: edges.length })}</span>
            {hiddenCount > 0 && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                {hiddenCount} {t("graph.hidden")}
              </span>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          {graphSearchOpen || searchActive ? (
            <div className="relative mr-1 w-52 max-w-full">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={graphSearchInputRef}
                value={graphSearch}
                onChange={(e) => setGraphSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setGraphSearch("")
                    setGraphSearchOpen(false)
                  }
                }}
                className="h-7 w-full rounded-md border bg-background pl-7 pr-7 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
                placeholder={t("graph.searchPlaceholder")}
                aria-label={t("graph.searchLabel")}
              />
              <button
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => {
                  if (searchActive) {
                    setGraphSearch("")
                    return
                  }
                  setGraphSearchOpen(false)
                }}
                aria-label={searchActive ? t("graph.clearSearch") : t("graph.closeSearch")}
                title={searchActive ? t("graph.clearSearch") : t("graph.closeSearch")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setGraphSearchOpen(true)}
              className="text-xs gap-1 h-7"
              aria-label={t("graph.searchLabel")}
              title={t("graph.searchLabel")}
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant={showFilters ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className="text-xs gap-1 h-7"
          >
            <Filter className="h-3 w-3" />
            {t("graph.filter")}
          </Button>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-xs gap-1 h-7"
              title={t("graph.resetFilters")}
            >
              <RotateCcw className="h-3 w-3" />
              {t("graph.reset")}
            </Button>
          )}
          <Button
            variant={colorMode === "type" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setColorMode("type")}
            className="text-xs gap-1 h-7"
          >
            <Tag className="h-3 w-3" />
            {t("graph.type")}
          </Button>
          <Button
            variant={colorMode === "community" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setColorMode("community")}
            className="text-xs gap-1 h-7"
          >
            <Layers className="h-3 w-3" />
            {t("graph.community")}
          </Button>
          <Button
            variant={colorMode === "trunk" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setColorMode("trunk")}
            className="text-xs gap-1 h-7"
          >
            <Network className="h-3 w-3" />
            {t("graph.trunk")}
          </Button>
          {(surprisingConns.filter((c) => !dismissedInsights.has(c.key)).length > 0 || visibleKnowledgeGaps.length > 0) && (
            <Button
              variant={showInsights ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setShowInsights((v) => {
                  if (v) setHighlightedNodes(new Set())
                  return !v
                })
              }}
              className="text-xs gap-1 h-7"
            >
              <Lightbulb className="h-3 w-3" />
              {t("graph.insights")}
              <span className="rounded bg-muted px-1 text-[10px]">
                {surprisingConns.filter((c) => !dismissedInsights.has(c.key)).length + visibleKnowledgeGaps.length}
              </span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={loadGraph} className="text-xs gap-1 h-7">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Graph canvas + Insights side panel */}
      <div className="flex flex-1 min-h-0">
        {/* Graph canvas */}
        <div
          ref={graphContainerRef}
          className="relative flex-1 min-w-0 overflow-hidden bg-background"
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => setNodeMenu(null)}
        >
          {isResizing ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {t("graph.resizing")}
            </div>
          ) : (
            <>
              <ErrorBoundary>
                <InkGraphCanvas
                  key={sigmaKey}
                  nodes={searchedGraph.nodes}
                  edges={searchedGraph.edges}
                  colorFor={nodeColorFor}
                  nodeScale={nodeScale}
                  graphSpacing={graphSpacing}
                  highlightedNodes={searchActive ? searchedGraph.matchedNodeIds : highlightedNodes}
                  onNodeClick={handleNodeClick}
                  onNodeContextMenu={handleNodeContextMenu}
                />
              </ErrorBoundary>

              {searchedGraph.nodes.length === 0 && (
                <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-50/85 text-muted-foreground backdrop-blur-[1px] dark:bg-slate-950/85">
                  <Search className="h-8 w-8 opacity-40" />
                  <p className="text-sm">{searchActive ? t("graph.noSearchResults") : t("graph.noVisibleNodes")}</p>
                  {searchActive && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="pointer-events-auto"
                      onClick={() => setGraphSearch("")}
                    >
                      {t("graph.clearSearch")}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {showFilters && (
            <div className="absolute top-3 left-3 w-72 rounded-lg border bg-background/95 p-3 text-xs shadow-lg backdrop-blur-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Filter className="h-3.5 w-3.5" />
                  {t("graph.graphFilters")}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10px]"
                  onClick={resetFilters}
                >
                  {t("graph.reset")}
                </Button>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="font-medium text-muted-foreground">{t("graph.quickFilters")}</div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={filters.hideStructural}
                      onChange={(e) => setFilters((prev) => ({ ...prev, hideStructural: e.target.checked }))}
                    />
                    <span>{t("graph.hideIndexOverview")}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={filters.hideIsolated}
                      onChange={(e) => setFilters((prev) => ({ ...prev, hideIsolated: e.target.checked }))}
                    />
                    <span>{t("graph.hideIsolated")}</span>
                  </label>
                </div>

                <div className="space-y-1.5">
                  <div className="font-medium text-muted-foreground">{t("graph.minLinks")}</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      className="h-7 w-20 rounded border bg-background px-2 text-xs"
                      value={filters.minLinks ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim()
                        const value = Number(raw)
                        setFilters((prev) => ({
                          ...prev,
                          minLinks: raw === "" || !Number.isFinite(value) ? undefined : Math.max(0, value),
                        }))
                      }}
                      placeholder={t("graph.any")}
                    />
                    <span className="text-muted-foreground">{t("graph.minLinksHint")}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="font-medium text-muted-foreground">{t("graph.maxLinks")}</div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      className="h-7 w-20 rounded border bg-background px-2 text-xs"
                      value={filters.maxLinks ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim()
                        const value = Number(raw)
                        setFilters((prev) => ({
                          ...prev,
                          maxLinks: raw === "" || !Number.isFinite(value) ? undefined : Math.max(0, value),
                        }))
                      }}
                      placeholder={t("graph.any")}
                    />
                    <span className="text-muted-foreground">{t("graph.maxLinksHint")}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="font-medium text-muted-foreground">{t("graph.displayTuning")}</div>
                  <label className="block space-y-1">
                    <div className="flex items-center justify-between">
                      <span>{t("graph.nodeSize")}</span>
                      <span className="text-muted-foreground">{Math.round(nodeScale * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.05}
                      value={nodeScale}
                      onChange={(e) => setNodeScale(Number(e.target.value))}
                      className="w-full"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex items-center justify-between">
                      <span>{t("graph.spacing")}</span>
                      <span className="text-muted-foreground">{Math.round(graphSpacingDraft * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.6}
                      max={2.2}
                      step={0.05}
                      value={graphSpacingDraft}
                      onChange={(e) => setGraphSpacingDraft(Number(e.target.value))}
                      className="w-full"
                    />
                  </label>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {t("graph.displayTuningHint")}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="font-medium text-muted-foreground">{t("graph.nodeTypes")}</div>
                  <div className="grid grid-cols-2 gap-1">
                    {Object.entries(nodeTypeLabelMap)
                      .filter(([type]) => (typeCounts[type] ?? 0) > 0)
                      .map(([type, label]) => (
                        <label key={type} className="flex min-w-0 items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={!filters.hiddenTypes.has(type)}
                            onChange={(e) => {
                              setFilters((prev) => {
                                const next = new Set(prev.hiddenTypes)
                                if (e.target.checked) next.delete(type)
                                else next.add(type)
                                return { ...prev, hiddenTypes: next }
                              })
                            }}
                          />
                          <span className="truncate">{label}</span>
                          <span className="text-muted-foreground/60">{typeCounts[type]}</span>
                        </label>
                      ))}
                  </div>
                </div>

                {filters.hiddenNodeIds.size > 0 && (
                  <div className="space-y-1.5">
                    <div className="font-medium text-muted-foreground">{t("graph.hiddenNodes")}</div>
                    <div className="max-h-24 space-y-1 overflow-y-auto">
                      {[...filters.hiddenNodeIds].map((nodeId) => {
                        const node = nodes.find((n) => n.id === nodeId)
                        return (
                          <div key={nodeId} className="flex items-center justify-between gap-2 rounded bg-muted/50 px-2 py-1">
                            <span className="truncate">{node?.label ?? nodeId}</span>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              onClick={() => setFilters((prev) => {
                                const next = new Set(prev.hiddenNodeIds)
                                next.delete(nodeId)
                                return { ...prev, hiddenNodeIds: next }
                              })}
                            >
                              {t("graph.show")}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div className="rounded bg-muted/50 px-2 py-1.5 text-muted-foreground">
                  {t("graph.showingStats", { pages: filteredGraph.nodes.length, total: nodes.length, links: filteredGraph.edges.length, totalLinks: edges.length })}
                </div>
              </div>
            </div>
          )}

          {nodeMenu && contextNode && (
            <div
              className="absolute z-20 w-48 rounded-md border bg-background py-1 text-xs shadow-lg"
              style={{ left: nodeMenu.x, top: nodeMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b px-3 py-2">
                <div className="truncate font-medium text-foreground">{contextNode.label}</div>
                <div className="text-muted-foreground">{contextNode.linkCount} links</div>
              </div>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent"
                onClick={() => {
                  setFilters((prev) => ({
                    ...prev,
                    hiddenNodeIds: new Set([...prev.hiddenNodeIds, contextNode.id]),
                  }))
                  setNodeMenu(null)
                }}
              >
                <EyeOff className="h-3.5 w-3.5" />
                {t("graph.hideThisNode")}
              </button>
            </div>
          )}

          {/* Legend */}
          <div className="absolute bottom-3 left-3 px-3 py-2 text-xs max-w-[260px]" style={{ color: INK }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-foreground">
                {colorMode === "type"
                  ? t("graph.nodeTypesLabel")
                  : colorMode === "trunk"
                    ? t("graph.trunksLabel")
                    : t("graph.communitiesLabel")}
              </span>
              <div className="flex items-center gap-1">
                {colorMode === "type" && filters.hiddenTypes.size > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-1"
                    onClick={() => setFilters((prev) => ({ ...prev, hiddenTypes: new Set() }))}
                    title={t("graph.showAllTypes")}
                  >
                    {t("graph.showAll")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setLegendCollapsed(!legendCollapsed)}
                  title={legendCollapsed ? t("graph.expandLegend") : t("graph.collapseLegend")}
                >
                  {legendCollapsed ? "▶" : "▼"}
                </Button>
              </div>
            </div>
            {!legendCollapsed && (
              colorMode === "type" ? (
                <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto legend-scroll" style={{ direction: "rtl" }}>
                  <div className="flex flex-col gap-0.5" style={{ direction: "ltr" }}>
                    {Object.entries(nodeTypeLabelMap)
                      .filter(([type]) => (typeCounts[type] ?? 0) > 0)
                      .map(([type, label]) => {
                        const isHidden = filters.hiddenTypes.has(type)
                        return (
                          <div
                            key={type}
                            className={`flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accent/50 ${isHidden ? "opacity-40" : ""}`}
                            onMouseEnter={() => setHoveredType(type)}
                            onMouseLeave={() => setHoveredType(null)}
                            onDoubleClick={() => {
                              setFilters((prev) => {
                                const next = new Set(prev.hiddenTypes)
                                if (next.has(type)) {
                                  next.delete(type)
                                } else {
                                  next.add(type)
                                }
                                return { ...prev, hiddenTypes: next }
                              })
                            }}
                            title={t("graph.doubleClickToggle")}
                          >
                            <span
                              className="inline-block h-3 w-3 rounded-full shrink-0 shadow-sm"
                              style={{
                                backgroundColor: isHidden ? "#94a3b8" : nodeColor(type),
                                boxShadow: `0 0 4px ${hexToRgba(isHidden ? "#94a3b8" : nodeColor(type), 0.4)}`,
                              }}
                            />
                            <span className={hoveredType === type ? "text-foreground font-medium" : "text-muted-foreground"}>
                              {label}
                            </span>
                            <span className="text-muted-foreground/60 ml-auto">{typeCounts[type]}</span>
                            {isHidden && <span className="text-muted-foreground/60 text-[10px]">{t("graph.hidden")}</span>}
                          </div>
                        )
                      })}
                  </div>
                </div>
              ) : colorMode === "trunk" ? (
                <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto legend-scroll" style={{ direction: "rtl" }}>
                  <div className="flex flex-col gap-0.5" style={{ direction: "ltr" }}>
                    {trunkCounts.map(([trunk, count]) => (
                      <div key={trunk || "_none"} className="flex items-center gap-2 rounded px-1 py-0.5">
                        <GlobeMark color={trunkColor(trunk || undefined)} />
                        <span className="text-muted-foreground truncate">{trunk || t("graph.noTrunk")}</span>
                        <span className="text-muted-foreground/60 ml-auto shrink-0">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto legend-scroll" style={{ direction: "rtl" }}>
                  <div className="flex flex-col gap-0.5" style={{ direction: "ltr" }}>
                    {communities.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accent/50"
                    >
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0 shadow-sm"
                        style={{
                          backgroundColor: COMMUNITY_COLORS[c.id % COMMUNITY_COLORS.length],
                          boxShadow: `0 0 4px ${hexToRgba(COMMUNITY_COLORS[c.id % COMMUNITY_COLORS.length], 0.4)}`,
                        }}
                      />
                      <span className="text-muted-foreground truncate" title={c.topNodes.join(", ")}>
                        {c.topNodes[0] ?? `${t("graph.cluster", { id: c.id })}`}
                      </span>
                      <span className="text-muted-foreground/60 ml-auto shrink-0">{c.nodeCount}</span>
                      {c.meanIntraDegree < 2 && c.nodeCount >= 3 && (
                        <span
                          className="text-amber-500 shrink-0"
                          title={t("graph.lowInternalConnectivity", {
                            count: c.meanIntraDegree.toFixed(1),
                          })}
                        >
                          !
                        </span>
                      )}
                    </div>
                  ))}
                  </div>
                </div>
              )
            )}
            {!legendCollapsed && (
              // Glyph shapes always stand for the page type, whatever the colour mode.
              <div className="mt-2 flex flex-col gap-0.5">
                <span className="mb-0.5 font-semibold text-foreground">{t("graph.glyphsLabel")}</span>
                {GLYPH_LEGEND.map(({ kind, labelKey }) => (
                  <div key={kind} className="flex items-center gap-2 px-1 py-0.5">
                    <GlyphMark kind={kind} />
                    <span className="text-muted-foreground truncate">{t(labelKey)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Insights Side Panel */}
        {showInsights && (
          <div className="w-80 shrink-0 border-l bg-background overflow-y-auto">
            <div className="px-4 py-3 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium">{t("graph.insights")}</span>
                </div>
                <button
                  className="p-1 rounded hover:bg-muted text-muted-foreground"
                  onClick={() => {
                    setShowInsights(false)
                    setHighlightedNodes(new Set())
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-3 flex flex-col gap-4">
              {/* Surprising Connections */}
              {surprisingConns.filter((c) => !dismissedInsights.has(c.key)).length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-foreground">
                    <Link2 className="h-3.5 w-3.5 text-blue-500" />
                    {t("graph.surprisingConnections")}
                  </div>
                  <div className="flex flex-col gap-2">
                    {surprisingConns
                      .filter((conn) => !dismissedInsights.has(conn.key))
                      .map((conn, i) => {
                        const ids = new Set([conn.source.id, conn.target.id])
                        const isActive = highlightedNodes.size === ids.size &&
                          [...ids].every((id) => highlightedNodes.has(id))
                        return (
                          <div
                            key={i}
                            className={`rounded-lg border p-3 text-sm cursor-pointer transition-colors ${isActive ? "bg-blue-500/10 border-blue-500/40" : "hover:bg-muted/50"}`}
                            onClick={() => setHighlightedNodes(isActive ? new Set() : ids)}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="font-medium text-foreground text-xs">
                                {conn.source.label} ↔ {conn.target.label}
                              </span>
                              <button
                                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  dismissInsight(conn.key, ids)
                                }}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {conn.reasons.join(", ")}
                            </p>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {/* Knowledge Gaps */}
              {visibleKnowledgeGaps.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    {t("graph.knowledgeGaps")}
                  </div>
                  <div className="flex flex-col gap-2">
                    {visibleKnowledgeGaps.map((gap, i) => {
                      const gapKey = knowledgeGapKey(gap)
                      const ids = new Set(gap.nodeIds)
                      const isActive = highlightedNodes.size > 0 &&
                        [...ids].every((id) => highlightedNodes.has(id)) &&
                        [...highlightedNodes].every((id) => ids.has(id))
                      return (
                        <div
                          key={i}
                          className={`rounded-lg border p-3 text-sm cursor-pointer transition-colors ${isActive ? "bg-amber-500/10 border-amber-500/40" : "hover:bg-muted/50"}`}
                          onClick={() => setHighlightedNodes(isActive ? new Set() : ids)}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="font-medium text-xs text-foreground">{gap.title}</div>
                            <button
                              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                              title={t("common.dismiss")}
                              onClick={(e) => {
                                e.stopPropagation()
                                dismissInsight(gapKey, ids)
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{gap.description}</p>
                          <p className="text-xs text-muted-foreground/80 italic mb-2">{gap.suggestion}</p>
                          <Button
                            variant="default"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleResearchClick(gap, gapKey)
                            }}
                          >
                            <Search className="h-3.5 w-3.5" />
                            {t("graph.deepResearch")}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {graphPreview && (
          <GraphPreviewPanel
            preview={graphPreview}
            onClose={() => setGraphPreview(null)}
            onContentChange={(content) => setGraphPreview((prev) => prev ? { ...prev, content } : prev)}
          />
        )}
      </div>

      {/* Research Topic Confirmation Dialog */}
      {researchDialog && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[480px] rounded-lg border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">{t("graph.deepResearch")}</span>
              </div>
              <button
                className="p-1 rounded hover:bg-muted text-muted-foreground"
                onClick={() => {
                  researchDialogTokenRef.current += 1
                  setResearchDialog(null)
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {researchDialog.loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("graph.generatingTopic")}
              </div>
            ) : (
              <div className="p-4">
                <div className="mb-3">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("graph.researchTopic")}</label>
                  <input
                    type="text"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    value={researchDialog.topic}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setResearchDialog((prev) =>
                        prev ? { ...prev, topic: e.target.value } : prev
                      )
                    }
                  />
                </div>
                <div className="mb-4">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("graph.searchQueries")}</label>
                  <div className="flex flex-col gap-1.5">
                    {researchDialog.queries.map((q, idx) => (
                      <input
                        key={idx}
                        type="text"
                        className="w-full rounded-md border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                        value={q}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setResearchDialog((prev) => {
                            if (!prev) return prev
                            const newQueries = [...prev.queries]
                            newQueries[idx] = e.target.value
                            return { ...prev, queries: newQueries }
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      researchDialogTokenRef.current += 1
                      setResearchDialog(null)
                    }}
                  >
                    {t("graph.cancel")}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-1"
                    onClick={handleResearchConfirm}
                  >
                    <Search className="h-3.5 w-3.5" />
                    {t("graph.startResearch")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

function GraphPreviewPanel({
  preview,
  onClose,
  onContentChange,
}: {
  preview: GraphPreview
  onClose: () => void
  onContentChange: (content: string) => void
}) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef(preview.content)
  const category = getFileCategory(preview.path)

  useEffect(() => {
    lastSavedRef.current = preview.content
  }, [preview.path, preview.content])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const writeNow = useCallback((markdown: string) => {
    writeFile(preview.path, markdown)
      .then(() => {
        lastSavedRef.current = markdown
        onContentChange(markdown)
      })
      .catch((err) => console.error("Failed to save graph preview:", err))
  }, [onContentChange, preview.path])

  const handleSave = useCallback((markdown: string, options?: { immediate?: boolean }) => {
    if (markdown === lastSavedRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (options?.immediate) {
      onContentChange(markdown)
      writeNow(markdown)
      return
    }
    saveTimerRef.current = setTimeout(() => {
      writeNow(markdown)
    }, 1000)
  }, [onContentChange, writeNow])

  return (
    <div className="flex w-[420px] min-w-[320px] max-w-[50vw] shrink-0 flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground" title={preview.path}>
          {preview.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        {category === "markdown" ? (
          <WikiEditor
            key={preview.path}
            content={preview.content}
            onSave={handleSave}
            filePath={preview.path}
          />
        ) : (
          <FilePreview
            key={preview.path}
            filePath={preview.path}
            textContent={preview.content}
          />
        )}
      </div>
    </div>
  )
}
