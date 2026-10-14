// Dev-only harness: renders the ink graph with real wiki data in a plain browser.
// 1. python3 dev/graph-lab/make_sample.py /path/to/project/wiki  (writes sample.json)
// 2. npx vite --port 1420, then open http://localhost:1420/dev/graph-lab/index.html
//    (add ?mix to spread trunks and page types for visual testing).
import { createRoot } from "react-dom/client"
import { InkGraphCanvas } from "@/components/graph/ink-graph-canvas"
import type { GraphEdge, GraphNode } from "@/lib/wiki-graph"
import sample from "./sample.json"

const TRUNKS: Record<string, string> = { 科研读博: "#D97757", AI工具经验: "#6A9BCC", 第二大脑: "#788C5D" }
const mix = new URLSearchParams(location.search).has("mix")
const types = ["entity", "concept", "source", "topic", "comparison"]
const nodes = (sample.nodes as GraphNode[]).map((n, i) =>
  mix ? { ...n, trunk: Object.keys(TRUNKS)[i % 3], type: types[(i * 7) % 5] } : n,
)
const colorFor = (n: GraphNode) => (n.trunk && TRUNKS[n.trunk]) || "#B9B5AA"

createRoot(document.getElementById("root")!).render(
  <InkGraphCanvas
    nodes={nodes}
    edges={sample.edges as GraphEdge[]}
    colorFor={colorFor}
    nodeScale={1}
    graphSpacing={1}
    highlightedNodes={new Set()}
    onNodeClick={(id) => console.log("click", id)}
    onNodeContextMenu={(id) => console.log("menu", id)}
  />,
)
