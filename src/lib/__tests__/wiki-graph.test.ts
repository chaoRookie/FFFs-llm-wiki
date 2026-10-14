/**
 * wiki-graph.test.ts — regression tests for frontmatter-scoped title/type extraction
 *
 * extractTitle/extractType previously searched for `title:`/`type:` anywhere in the
 * whole file content, not just inside the `---...---` frontmatter block, because the
 * lazy `[\s\S]*?` in their regexes was never required to stop at the closing `---`.
 * A body line that merely starts with `title:` or `type:` (plain prose, not YAML)
 * could be misread as the frontmatter value.
 */
import { describe, it, expect, vi } from "vitest"
import type { FileNode } from "@/types/wiki"

const mockListDirectory = vi.fn()
const mockReadFile = vi.fn()

vi.mock("@/commands/fs", () => ({
  listDirectory: (...args: unknown[]) => mockListDirectory(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}))

async function loadBuildWikiGraph() {
  const mod = await import("../wiki-graph")
  return mod.buildWikiGraph
}

function mdFile(name: string): FileNode {
  return { name, path: `/project/wiki/${name}`, is_dir: false }
}

describe("buildWikiGraph frontmatter extraction", () => {
  it("does not read a title: line from the document body as the frontmatter title", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([mdFile("page.md")])
    mockReadFile.mockResolvedValue(
      "---\ntype: entity\n---\n# Real Heading\n\nSome text.\ntitle: not-frontmatter-at-all\n",
    )

    const graph = await buildWikiGraph("/project")

    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0].label).toBe("Real Heading")
  })

  it("does not read a type: line from the document body as the frontmatter type", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([mdFile("page.md")])
    mockReadFile.mockResolvedValue(
      "---\ntitle: Real Page\n---\n# Real Page\n\nSome text.\ntype: query\nMore text.\n",
    )

    const graph = await buildWikiGraph("/project")

    // A misread type of "query" would match HIDDEN_TYPES and silently drop the page.
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0].type).toBe("other")
  })

  it("parses CRLF frontmatter consistently with the rest of the application", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([mdFile("page.md")])
    mockReadFile.mockResolvedValue(
      "---\r\ntitle: CRLF Page\r\ntype: entity\r\n---\r\n# Fallback Heading\r\n",
    )

    const graph = await buildWikiGraph("/project")

    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]).toMatchObject({ label: "CRLF Page", type: "entity" })
  })

  it("uses YAML parsing for quoted values that contain a colon", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([mdFile("page.md")])
    mockReadFile.mockResolvedValue(
      '---\ntitle: "Attention: Architecture"\ntype: "Concept"\n---\n# Fallback Heading\n',
    )

    const graph = await buildWikiGraph("/project")

    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]).toMatchObject({ label: "Attention: Architecture", type: "concept" })
  })

  it("resolves case and space variants without dropping links", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([
      mdFile("Source.md"),
      mdFile("target-page.md"),
    ])
    mockReadFile.mockImplementation(async (path: string) =>
      path.endsWith("Source.md")
        ? "# Source\n\n[[Target Page]]"
        : "# Target",
    )

    const graph = await buildWikiGraph("/project")

    expect(graph.edges).toEqual([
      expect.objectContaining({ source: "Source", target: "target-page" }),
    ])
  })

  it("includes frontmatter related entries as graph edges", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([
      mdFile("source.md"),
      mdFile("target.md"),
    ])
    mockReadFile.mockImplementation(async (path: string) =>
      path.endsWith("source.md")
        ? "---\nrelated: [wiki/concepts/target.md]\n---\n# Source"
        : "# Target",
    )

    const graph = await buildWikiGraph("/related-project")

    expect(graph.edges).toEqual([
      expect.objectContaining({ source: "source", target: "target" }),
    ])
  })

  it("prefers an exact page id when case-folded aliases collide", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([
      mdFile("source.md"),
      mdFile("Foo.md"),
      mdFile("foo.md"),
    ])
    mockReadFile.mockImplementation(async (path: string) =>
      path.endsWith("source.md") ? "# Source\n\n[[foo]]" : "# Target",
    )

    const graph = await buildWikiGraph("/case-project")

    expect(graph.edges).toEqual([
      expect.objectContaining({ source: "source", target: "foo" }),
    ])
  })

  it("reuses an unchanged graph by project data version", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockClear()
    mockReadFile.mockClear()
    mockListDirectory.mockResolvedValue([mdFile("cached.md")])
    mockReadFile.mockResolvedValue("# Cached")

    const first = await buildWikiGraph("/cached-project", 42)
    const second = await buildWikiGraph("/cached-project", 42)

    expect(second).toBe(first)
    // The first graph build reads once for graph topology and once for
    // relevance metadata; the second call is fully served by the cache.
    expect(mockListDirectory).toHaveBeenCalledTimes(2)
    expect(mockReadFile).toHaveBeenCalledTimes(2)
  })
})

describe("buildWikiGraph trunk extraction", () => {
  it("reads the frontmatter trunk and leaves it undefined when absent", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([mdFile("a.md"), mdFile("b.md")])
    mockReadFile.mockImplementation(async (path: string) =>
      path.endsWith("a.md")
        ? "---\ntitle: A\ntype: concept\ntrunk: 科研读博\n---\n# A\n"
        : "---\ntitle: B\ntype: concept\n---\n# B\n",
    )

    const graph = await buildWikiGraph("/project")
    const byLabel = Object.fromEntries(graph.nodes.map((n) => [n.label, n]))

    expect(byLabel.A.trunk).toBe("科研读博")
    expect(byLabel.B.trunk).toBeUndefined()
  })
})

describe("buildWikiGraph subtype", () => {
  it("uses frontmatter subtype and infers AI-session sources from their source path", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([mdFile("m.md"), mdFile("s.md"), mdFile("p.md")])
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith("m.md")) return "---\ntitle: M\ntype: entity\nsubtype: Model\n---\n"
      if (path.endsWith("s.md")) return '---\ntitle: S\ntype: source\nsources: ["AI工具经验/codex/2026-10/codex-x.md"]\n---\n'
      return '---\ntitle: P\ntype: source\nsources: ["科研读博/论文/1706.03762 - Attention.pdf"]\n---\n'
    })

    const graph = await buildWikiGraph("/project")
    const byLabel = Object.fromEntries(graph.nodes.map((n) => [n.label, n]))

    expect(byLabel.M.subtype).toBe("model")
    expect(byLabel.S.subtype).toBe("session")
    expect(byLabel.P.subtype).toBeUndefined()
  })
})
