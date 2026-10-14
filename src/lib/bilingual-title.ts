/**
 * Splits a wiki page title into an English name and a short Chinese name, so the
 * graph can always show "English first, small Chinese below".
 *
 * Handles "中文（English）", "English（中文）", plain English and plain Chinese titles;
 * an explicit frontmatter `title_zh` always wins for the Chinese part.
 */
export interface BilingualTitle {
  en?: string
  zh?: string
}

const CJK = /[㐀-鿿]/
const PAREN = /^(.*?)\s*[（(]\s*(.+?)\s*[）)]\s*$/

export function splitBilingualTitle(title: string, titleZh?: string): BilingualTitle {
  const text = title.trim()
  const explicitZh = titleZh?.trim() || undefined
  const match = text.match(PAREN)
  let en: string | undefined
  let zh: string | undefined
  if (match && match[1]) {
    const [, outer, inner] = match
    if (CJK.test(outer) && !CJK.test(inner)) {
      zh = outer
      en = inner
    } else if (!CJK.test(outer) && CJK.test(inner)) {
      en = outer
      zh = inner
    } else if (CJK.test(outer)) {
      zh = text
    } else {
      en = text
    }
  } else if (CJK.test(text)) {
    zh = text
  } else {
    en = text
  }
  return { en, zh: explicitZh ?? zh }
}
