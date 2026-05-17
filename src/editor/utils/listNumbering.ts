import { ZERO } from '../dataset/constant/Common'
import { ulStyleMapping } from '../dataset/constant/List'
import {
  DEFAULT_UL_LEVEL_CASCADE,
  buildDefaultLevelStyle
} from '../dataset/constant/listLevel'
import { ListStyle, ListType, UlStyle } from '../dataset/enum/List'
import { IElement } from '../interface/Element'
import {
  IListGlyphResult,
  IListLevelStyle,
  IListStyle,
  LIST_MAX_LEVEL,
  ListNumberStyle
} from '../interface/List'

/**
 * Word-style multi-level template registry. Consumers (jats-editor toolbar)
 * call `registerMultilevelTemplate(id, IListStyle)` once per template at
 * startup. `computeListGlyphMap` consults this at render time when an element
 * has `listTemplateId` set, so Tab/Shift+Tab cascading glyphs work without
 * mutating per-element fields on every level change.
 */
const multilevelTemplates = new Map<string, IListStyle>()

export function registerMultilevelTemplate(
  id: string,
  style: IListStyle
): void {
  multilevelTemplates.set(id, style)
}

export function getMultilevelTemplate(id: string): IListStyle | undefined {
  return multilevelTemplates.get(id)
}

/** Resolve the level config for a given templateId + level. Returns undefined
 *  when the template isn't registered or doesn't define that level. */
function lookupTemplateLevel(
  templateId: string | undefined,
  level: number
): IListLevelStyle | undefined {
  if (!templateId) return undefined
  const template = multilevelTemplates.get(templateId)
  if (!template) return undefined
  // Cycle through defined levels: level 4 reuses levels[0], level 5 reuses
  // levels[1], etc. — matches Word's "cascade then repeat" behaviour and lets
  // templates declare only 3 levels while supporting Tab through level 9.
  const n = template.levels.length
  if (n === 0) return undefined
  return template.levels[(level - 1) % n]
}

function toAlpha(n: number, upper: boolean): string {
  if (n <= 0) return ''
  let s = ''
  let v = n
  while (v > 0) {
    v -= 1
    s = String.fromCharCode(97 + (v % 26)) + s
    v = Math.floor(v / 26)
  }
  return upper ? s.toUpperCase() : s
}

function toRoman(n: number, upper: boolean): string {
  if (n <= 0) return ''
  const map: Array<[number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i']
  ]
  let s = ''
  let v = n
  for (const [num, sym] of map) {
    while (v >= num) {
      s += sym
      v -= num
    }
  }
  return upper ? s.toUpperCase() : s
}

function renderNumber(style: ListNumberStyle, n: number): string {
  switch (style) {
    case 'decimal':
      return String(n)
    case 'lowerAlpha':
      return toAlpha(n, false)
    case 'upperAlpha':
      return toAlpha(n, true)
    case 'lowerRoman':
      return toRoman(n, false)
    case 'upperRoman':
      return toRoman(n, true)
    case 'bullet':
    default:
      return ''
  }
}

function pickUlGlyph(listStyle: ListStyle | undefined, level: number): string {
  if (listStyle === ListStyle.CHECKBOX) return ''
  if (
    listStyle === ListStyle.DISC ||
    listStyle === ListStyle.CIRCLE ||
    listStyle === ListStyle.SQUARE
  ) {
    return ulStyleMapping[<UlStyle>(<unknown>listStyle)]
  }
  const idx = Math.max(0, Math.min(level - 1, LIST_MAX_LEVEL - 1))
  return ulStyleMapping[DEFAULT_UL_LEVEL_CASCADE[idx]]
}

function clampLevel(level: number | undefined): number {
  if (!level || level < 1) return 1
  if (level > LIST_MAX_LEVEL) return LIST_MAX_LEVEL
  return Math.floor(level)
}

function isListItemStart(el: IElement): boolean {
  return !!el.listId && el.value === ZERO && !el.listWrap
}

function renderLegal(counters: number[], level: number): string {
  const parts: string[] = []
  for (let k = 0; k < level; k++) parts.push(String(counters[k] || 1))
  return parts.join('.') + '.'
}

function renderFormat(
  format: string,
  currentLevel: number,
  counters: number[],
  listType: ListType | undefined,
  listStyle: ListStyle | undefined
): string {
  let out = format.replace(/%([1-9])/g, (_match, digit: string) => {
    const lvl = parseInt(digit, 10)
    const style = buildDefaultLevelStyle(lvl, listType, listStyle)
    return renderNumber(style.numberStyle, counters[lvl - 1] || 1)
  })
  out = out.replace(/%N/g, () => {
    const style = buildDefaultLevelStyle(currentLevel, listType, listStyle)
    return renderNumber(style.numberStyle, counters[currentLevel - 1])
  })
  return out
}

export function computeListGlyphMap(
  elementList: IElement[]
): Map<number, IListGlyphResult> {
  const out = new Map<number, IListGlyphResult>()
  // Per-(listId, listType) counters. Buckets the counter so mid-list
  // interruptions (e.g. one paragraph converted to a different list-type)
  // don't pollute the surrounding count — and stray leading-ZERO elements
  // whose listType differs from the rest go into their own bucket instead of
  // bumping the visible OL counter. Matches Word's "continue across
  // interruption" behavior.
  const countersByKey = new Map<string, number[]>()
  // Tracks whether the bucket has already had its `listStartValue` honored,
  // so subsequent list-starts with the same field don't keep resetting the
  // counter (only the first start of a bucket shifts).
  const seededBuckets = new Set<string>()
  let counters: number[] = new Array(LIST_MAX_LEVEL).fill(0)
  let activeKey = ''
  for (let i = 0; i < elementList.length; i++) {
    const el = elementList[i]
    if (el.listId) {
      const key = `${el.listId}|${el.listType ?? ''}`
      let bucket = countersByKey.get(key)
      if (!bucket) {
        bucket = new Array(LIST_MAX_LEVEL).fill(0)
        countersByKey.set(key, bucket)
      }
      counters = bucket
      activeKey = key
    }
    if (!isListItemStart(el)) continue
    const level = clampLevel(el.listLevel)
    // Seed the counter the first time a bucket sees a list-start with a
    // `listStartValue`. Setting `counters[level - 1] = startValue - 1` makes
    // the `+= 1` below land on `startValue`. Skipped once seeded so later
    // list-starts in the same bucket continue from the seeded base.
    if (
      typeof el.listStartValue === 'number' &&
      el.listStartValue > 0 &&
      !seededBuckets.has(activeKey)
    ) {
      counters[level - 1] = el.listStartValue - 1
      seededBuckets.add(activeKey)
    }
    counters[level - 1] += 1
    for (let k = level; k < LIST_MAX_LEVEL; k++) counters[k] = 0
    let glyph = ''
    // Word multi-level template: render-time lookup of per-level config.
    // Tab changes `listLevel`; this branch picks the template's level-N
    // numberStyle / bulletChar / format so the marker cascades per Word.
    // Template wins fully — per-element listFormat/listBulletChar/listNumberStyle
    // are ignored when listTemplateId is present, otherwise level-1's
    // stamped fields would persist across Tab and break the cascade.
    const templateLevel = lookupTemplateLevel(el.listTemplateId, level)
    if (templateLevel) {
      const numberStyle = templateLevel.numberStyle
      const format = templateLevel.format
      if (numberStyle === 'bullet') {
        glyph = templateLevel.bulletChar ?? ''
      } else if (format) {
        const num = renderNumber(numberStyle, counters[level - 1])
        glyph = format.replace(/%N/g, num)
      }
    } else if (el.listType === ListType.UL) {
      glyph = el.listBulletChar ?? pickUlGlyph(el.listStyle, level)
    } else if (el.listStyle === ListStyle.LEGAL && !el.listFormat) {
      glyph = renderLegal(counters, level)
    } else if (el.listNumberStyle) {
      const num = renderNumber(el.listNumberStyle, counters[level - 1])
      const format = el.listFormat || '%N.'
      glyph = format.replace('%N', num)
    } else {
      const style = buildDefaultLevelStyle(level, el.listType, el.listStyle)
      const format = el.listFormat || style.format
      glyph = renderFormat(format, level, counters, el.listType, el.listStyle)
    }
    out.set(i, { glyph, level })
  }
  return out
}

export function getElementListLevel(el: IElement | undefined): number {
  return clampLevel(el?.listLevel)
}
