import { describe, it, expect } from "vitest"
import { REST_PROGRESS, drawGlyph, glyphForType, seedFromId, type GlyphKind } from "./ink-glyphs"

function recordingContext() {
  const calls: string[] = []
  const ctx = new Proxy(
    { globalAlpha: 1 } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop]
        return (..._args: unknown[]) => calls.push(prop)
      },
      set(target, prop: string, value) {
        target[prop] = value
        return true
      },
    },
  )
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

const style = { color: "#D97757", ink: "#141413", paper: "#F0EEE6" }
const kinds: GlyphKind[] = ["globe", "ring", "petal", "dna", "hex"]

describe("ink glyphs", () => {
  it("maps page types to glyphs", () => {
    expect(glyphForType("entity")).toBe("globe")
    expect(glyphForType("concept")).toBe("ring")
    expect(glyphForType("source")).toBe("petal")
    expect(glyphForType("topic")).toBe("dna")
    expect(glyphForType("comparison")).toBe("hex")
  })

  it("draws nothing at progress 0 and more ink as the glyph grows", () => {
    for (const kind of kinds) {
      const counts = [0, REST_PROGRESS[kind], 1].map((progress) => {
        const { ctx, calls } = recordingContext()
        drawGlyph(ctx, kind, { x: 0, y: 0, radius: 10, progress, seed: 1, time: 0, bleed: 0, style })
        return calls.filter((c) => c === "stroke" || c === "fill").length
      })
      expect(counts[0]).toBe(0)
      expect(counts[1]).toBeGreaterThan(0)
      expect(counts[2]).toBeGreaterThan(counts[1])
    }
  })

  it("gives every id a stable seed", () => {
    expect(seedFromId("kv-cache")).toBe(seedFromId("kv-cache"))
    expect(seedFromId("kv-cache")).not.toBe(seedFromId("vllm"))
  })
})
