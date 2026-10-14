import { describe, it, expect } from "vitest"
import { splitBilingualTitle } from "./bilingual-title"

describe("splitBilingualTitle", () => {
  it("splits Chinese-first titles", () => {
    expect(splitBilingualTitle("知识蒸馏（Knowledge Distillation）")).toEqual({ en: "Knowledge Distillation", zh: "知识蒸馏" })
    expect(splitBilingualTitle("LLM 激活异常值（Activation Outliers in LLM）")).toEqual({
      en: "Activation Outliers in LLM",
      zh: "LLM 激活异常值",
    })
  })

  it("splits English-first titles, with full- or half-width brackets", () => {
    expect(splitBilingualTitle("Speculative Decoding（投机解码）")).toEqual({ en: "Speculative Decoding", zh: "投机解码" })
    expect(splitBilingualTitle("Continuous Batching (持续批处理)")).toEqual({ en: "Continuous Batching", zh: "持续批处理" })
  })

  it("keeps English-only titles English until a title_zh is given", () => {
    expect(splitBilingualTitle("vLLM")).toEqual({ en: "vLLM", zh: undefined })
    expect(splitBilingualTitle("vLLM", "推理服务框架")).toEqual({ en: "vLLM", zh: "推理服务框架" })
    expect(splitBilingualTitle("AWQ (Activation-aware Weight Quantization)")).toEqual({
      en: "AWQ (Activation-aware Weight Quantization)",
      zh: undefined,
    })
  })

  it("treats Chinese titles without brackets as Chinese", () => {
    expect(splitBilingualTitle("W8A8 量化")).toEqual({ en: undefined, zh: "W8A8 量化" })
  })
})
