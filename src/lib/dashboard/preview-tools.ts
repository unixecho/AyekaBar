import type { Tile } from './tiles'

export type ToolUsage = Record<string, { n: number; t: number }>

const FINAL: Record<string, string> = { ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' }
export const normalizeToolText = (value: string) => value.toLocaleLowerCase()
  .replace(/[֑-ׇ]/g, '').replace(/[ךםןףץ]/g, (letter) => FINAL[letter] ?? letter)
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const WORD_PREFIX = /^[והבלמשכ]/
const words = (value: string) => normalizeToolText(value).split(' ').filter(Boolean)
const aliases: Record<string, string[]> = {
  'my-shifts': ['משמרות', 'סידור', 'schedule', 'shifts'],
  pos: ['הזמנות', 'oms', 'orders', 'קופה'],
  schedule: ['משמרות', 'שיבוץ', 'schedule'],
  floor: ['שולחנות', 'מפה', 'floor'],
  reports: ['דוחות', 'קבלות', 'משמרת', 'reports'],
  'z-reports': ['סגירת קופה', 'דוח יומי', 'z'],
  editor: ['מנה', 'מנות', 'עריכת תפריט', 'menu'],
  staff: ['עובדים', 'הרשאות', 'צוות', 'employees'],
  'payslips-admin': ['שכר', 'תלושים', 'payroll'],
  payslips: ['שכר', 'תלוש', 'salary'],
  links: ['פורטל', 'קישורים', 'links'],
  feedback: ['ביקורות', 'לקוחות', 'feedback'],
  audit: ['שינויים', 'יומן', 'audit'],
}

function closeWord(query: string, candidate: string): boolean {
  if (Math.abs(query.length - candidate.length) > 1 || query.length < 4) return false
  if (candidate.startsWith(query.slice(0, -1))) return true
  let edits = 0
  for (let i = 0, j = 0; i < query.length && j < candidate.length;) {
    if (query[i] === candidate[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (query.length > candidate.length) i++
    else if (candidate.length > query.length) j++
    else { i++; j++ }
  }
  return true
}

function textScore(tile: Tile, query: string): number {
  const label = normalizeToolText(tile.he)
  const tokens = words(query)
  if (!tokens.length) return 0
  const labelWords = words(tile.he)
  const otherWords = words([tile.hint ?? '', tile.id, ...(aliases[tile.id] ?? [])].join(' '))
  let score = label.startsWith(normalizeToolText(query)) ? 30 : 0
  for (const token of tokens) {
    const match = (word: string) => {
      const bare = word.length > 3 && WORD_PREFIX.test(word) ? word.slice(1) : word
      return word === token || bare === token ? 100
        : word.startsWith(token) || bare.startsWith(token) ? 72
          : token.length >= 3 && (word.includes(token) || bare.includes(token)) ? 36
            : closeWord(token, word) || closeWord(token, bare) ? 22 : 0
    }
    const best = Math.max(...labelWords.map(match), ...otherWords.map((word) => match(word) * .7), 0)
    if (!best) return 0
    score += best
  }
  return score / tokens.length
}

function usageScore(tile: Tile, usage: ToolUsage, now: number): number {
  const used = usage[tile.id]
  if (!used) return 0
  const recent = now - used.t < 36 * 3600_000 ? 14 : now - used.t < 7 * 86400_000 ? 7 : 0
  return Math.min(48, Math.log2(used.n + 1) * 12) + recent
}

export function rankPreviewTools(tiles: Tile[], usage: ToolUsage, query = '', now = Date.now()): Tile[] {
  const typed = normalizeToolText(query)
  return tiles.map((tile, order) => ({ tile, order, text: typed ? textScore(tile, typed) : 0, used: usageScore(tile, usage, now) }))
    .filter((row) => !typed || row.text > 0)
    .sort((a, b) => typed ? b.text - a.text || b.used - a.used || a.order - b.order : b.used - a.used || a.order - b.order)
    .map((row) => row.tile)
}

export function completePreviewTool(tiles: Tile[], query: string): string | null {
  const typed = normalizeToolText(query)
  if (typed.length < 2) return null
  const match = tiles.find((tile) => normalizeToolText(tile.he).startsWith(typed) && normalizeToolText(tile.he) !== typed)
  return match?.he ?? null
}

export function parsePreviewUsage(raw: string | null, validIds: Set<string>): ToolUsage {
  if (!raw || raw.length > 12_000) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const usage: ToolUsage = {}
    for (const [id, value] of Object.entries(parsed).slice(0, 60)) {
      if (!validIds.has(id) || !value || typeof value !== 'object') continue
      const row = value as { n?: unknown; t?: unknown }
      if (typeof row.n === 'number' && Number.isFinite(row.n) && row.n > 0 && typeof row.t === 'number' && Number.isFinite(row.t) && row.t > 0)
        usage[id] = { n: Math.min(10_000, Math.floor(row.n)), t: row.t }
    }
    return usage
  } catch { return {} }
}

export function recordPreviewUse(usage: ToolUsage, id: string, now = Date.now()): ToolUsage {
  return { ...usage, [id]: { n: Math.min(10_000, (usage[id]?.n ?? 0) + 1), t: now } }
}
