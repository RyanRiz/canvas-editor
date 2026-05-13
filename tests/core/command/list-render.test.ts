import { describe, it, expect, afterEach } from 'vitest'
import { createTestEditor } from '../../factories/editor'
import { computeListGlyphMap } from '../../../src/editor/utils/listNumbering'
import { ListType } from '../../../src/editor/dataset/enum/List'
import { ZERO } from '../../../src/editor/dataset/constant/Common'

describe('列表实时重编号 (Word parity)', () => {
  let ctx: ReturnType<typeof createTestEditor>
  afterEach(() => ctx?.destroy())

  // ── helpers ──────────────────────────────────────────────────
  function getListStartIndices(elements: any[]): number[] {
    const out: number[] = []
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]
      if (el.listId && el.value === ZERO && !el.listWrap) {
        out.push(i)
      }
    }
    return out
  }

  function glyphAt(elements: any[], idx: number): string | undefined {
    return computeListGlyphMap(elements).get(idx)?.glyph
  }

  function setOrderedList(cmd: any) {
    cmd.executeSelectAll()
    cmd.executeList(ListType.OL)
  }

  // ── tests ────────────────────────────────────────────────────

  it('中间项改为无序列表后有序列表编号继续', () => {
    ctx = createTestEditor()
    const cmd = ctx.editor.command
    cmd.executeFocus()
    cmd.executeSetValue({
      header: [],
      main: [
        { value: 'A' }, { value: '\n' },
        { value: 'B' }, { value: '\n' },
        { value: 'C' }, { value: '\n' },
        { value: 'D' }, { value: '\n' },
        { value: 'E' }, { value: '\n' }
      ],
      footer: []
    })
    setOrderedList(cmd)

    // 5 items numbered 1–5
    const e1 = cmd.getElementList()
    const idx = getListStartIndices(e1)
    expect(idx.length).toBe(5)
    expect(glyphAt(e1, idx[0])).toBe('1.')
    expect(glyphAt(e1, idx[1])).toBe('2.')
    expect(glyphAt(e1, idx[2])).toBe('3.')
    expect(glyphAt(e1, idx[3])).toBe('4.')
    expect(glyphAt(e1, idx[4])).toBe('5.')

    // Convert item 3 (C) to bullet
    cmd.executeSetRange(idx[2], idx[2])
    cmd.executeList(ListType.UL)

    const e2 = cmd.getElementList()
    const idx2 = getListStartIndices(e2)
    expect(idx2.length).toBe(5)
    // Expected: 1, 2, 3, •, 4, 5  (numbering skips the bullet)
    expect(glyphAt(e2, idx2[0])).toBe('1.')
    expect(glyphAt(e2, idx2[1])).toBe('2.')
    expect(glyphAt(e2, idx2[2])).toBe('•')
    expect(glyphAt(e2, idx2[3])).toBe('3.')
    expect(glyphAt(e2, idx2[4])).toBe('4.')
  })

  it('子弹改回有序列表后编号恢复连续', () => {
    ctx = createTestEditor()
    const cmd = ctx.editor.command
    cmd.executeFocus()
    cmd.executeSetValue({
      header: [],
      main: [
        { value: 'A' }, { value: '\n' },
        { value: 'B' }, { value: '\n' },
        { value: 'C' }, { value: '\n' },
        { value: 'D' }, { value: '\n' },
        { value: 'E' }, { value: '\n' }
      ],
      footer: []
    })
    setOrderedList(cmd)

    // C → UL
    const e1 = cmd.getElementList()
    const idx = getListStartIndices(e1)
    cmd.executeSetRange(idx[2], idx[2])
    cmd.executeList(ListType.UL)

    // C → OL again
    cmd.executeList(ListType.OL)

    const e2 = cmd.getElementList()
    const idx2 = getListStartIndices(e2)
    expect(glyphAt(e2, idx2[0])).toBe('1.')
    expect(glyphAt(e2, idx2[1])).toBe('2.')
    expect(glyphAt(e2, idx2[2])).toBe('3.')
    expect(glyphAt(e2, idx2[3])).toBe('4.')
    expect(glyphAt(e2, idx2[4])).toBe('5.')
  })

  it('列表中间插入新项后编号自动更新', () => {
    ctx = createTestEditor()
    const cmd = ctx.editor.command
    cmd.executeFocus()
    cmd.executeSetValue({
      header: [],
      main: [
        { value: 'A' }, { value: '\n' },
        { value: 'B' }, { value: '\n' },
        { value: 'C' }, { value: '\n' }
      ],
      footer: []
    })
    setOrderedList(cmd)

    const e1 = cmd.getElementList()
    const idx = getListStartIndices(e1)

    // Place cursor at the end of B (before C's ZERO) and insert via
    // spliceElementList, propagating list context to mimic Enter behaviour
    const insPos = idx[2]
    const draw = (ctx.editor as any).draw
    const anchorEl = e1[insPos - 1]
    const newItems: any[] = [
      { value: ZERO },
      { value: 'X' }
    ]
    // Propagate list context from anchor element
    if (anchorEl?.listId) {
      for (const item of newItems) {
        item.listId = anchorEl.listId
        item.listType = anchorEl.listType
        item.listStyle = anchorEl.listStyle
        item.listLevel = anchorEl.listLevel ?? 1
      }
    }
    draw.spliceElementList(e1, insPos, 0, newItems)
    cmd.executeSetRange(insPos, insPos)
    draw.render({ curIndex: insPos })

    const e2 = cmd.getElementList()
    const idx2 = getListStartIndices(e2)
    expect(idx2.length).toBe(4)
    expect(glyphAt(e2, idx2[0])).toBe('1.')
    expect(glyphAt(e2, idx2[1])).toBe('2.')
    expect(glyphAt(e2, idx2[2])).toBe('3.')
    expect(glyphAt(e2, idx2[3])).toBe('4.')
  })

  it('删除数列项后编号自动更新', () => {
    ctx = createTestEditor()
    const cmd = ctx.editor.command
    cmd.executeFocus()
    cmd.executeSetValue({
      header: [],
      main: [
        { value: 'A' }, { value: '\n' },
        { value: 'B' }, { value: '\n' },
        { value: 'C' }, { value: '\n' },
        { value: 'D' }, { value: '\n' }
      ],
      footer: []
    })
    setOrderedList(cmd)

    // Delete item 2 (B)
    const e1 = cmd.getElementList()
    const idx = getListStartIndices(e1)
    const draw = (ctx.editor as any).draw
    draw.spliceElementList(e1, idx[1], idx[2] - idx[1])
    cmd.executeSetRange(idx[1], idx[1])
    draw.render({ curIndex: idx[1] })

    const e2 = cmd.getElementList()
    const idx2 = getListStartIndices(e2)
    expect(idx2.length).toBe(3)
    expect(glyphAt(e2, idx2[0])).toBe('1.')
    expect(glyphAt(e2, idx2[1])).toBe('2.')
    expect(glyphAt(e2, idx2[2])).toBe('3.')
  })

  it('缩进后子列表独立编号', () => {
    ctx = createTestEditor()
    const cmd = ctx.editor.command
    cmd.executeFocus()
    cmd.executeSetValue({
      header: [],
      main: [
        { value: 'A' }, { value: '\n' },
        { value: 'B' }, { value: '\n' },
        { value: 'C' }, { value: '\n' }
      ],
      footer: []
    })
    setOrderedList(cmd)

    // Indent B
    const e1 = cmd.getElementList()
    const idx = getListStartIndices(e1)
    cmd.executeSetRange(idx[1], idx[1])
    cmd.executeListIndent()

    const e2 = cmd.getElementList()
    const idx2 = getListStartIndices(e2)
    // A=1, B↓=a, C=2
    expect(glyphAt(e2, idx2[0])).toBe('1.')
    expect(glyphAt(e2, idx2[1])).toBe('a.')
    expect(glyphAt(e2, idx2[2])).toBe('2.')
  })

  it('列表最后一项设为无序后前面编号不受影响', () => {
    ctx = createTestEditor()
    const cmd = ctx.editor.command
    cmd.executeFocus()
    cmd.executeSetValue({
      header: [],
      main: [
        { value: 'A' }, { value: '\n' },
        { value: 'B' }, { value: '\n' },
        { value: 'C' }, { value: '\n' }
      ],
      footer: []
    })
    setOrderedList(cmd)

    // Convert last item (C) to UL
    const e1 = cmd.getElementList()
    const idx = getListStartIndices(e1)
    cmd.executeSetRange(idx[2], idx[2])
    cmd.executeList(ListType.UL)

    const e2 = cmd.getElementList()
    const idx2 = getListStartIndices(e2)
    expect(glyphAt(e2, idx2[0])).toBe('1.')
    expect(glyphAt(e2, idx2[1])).toBe('2.')
    expect(glyphAt(e2, idx2[2])).toBe('•')
  })

  it('混合列表修改后 undo 恢复', () => {
    ctx = createTestEditor()
    const cmd = ctx.editor.command
    cmd.executeFocus()
    cmd.executeSetValue({
      header: [],
      main: [
        { value: 'A' }, { value: '\n' },
        { value: 'B' }, { value: '\n' },
        { value: 'C' }, { value: '\n' }
      ],
      footer: []
    })
    setOrderedList(cmd)

    // B → UL
    const e1 = cmd.getElementList()
    const idx = getListStartIndices(e1)
    cmd.executeSetRange(idx[1], idx[1])
    cmd.executeList(ListType.UL)

    // Undo
    cmd.executeUndo()

    const e2 = cmd.getElementList()
    const idx2 = getListStartIndices(e2)
    expect(glyphAt(e2, idx2[0])).toBe('1.')
    expect(glyphAt(e2, idx2[1])).toBe('2.')
    expect(glyphAt(e2, idx2[2])).toBe('3.')
  })

  it('500项列表中间插子弹性能合格', () => {
    ctx = createTestEditor()
    const cmd = ctx.editor.command
    const main: any[] = []
    for (let i = 0; i < 500; i++) {
      main.push({ value: String(i) })
      main.push({ value: '\n' })
    }
    cmd.executeFocus()
    cmd.executeSetValue({ header: [], main, footer: [] })
    setOrderedList(cmd)

    const e1 = cmd.getElementList()
    const idx = getListStartIndices(e1)
    const mid = idx[250]

    const t0 = performance.now()
    cmd.executeSetRange(mid, mid)
    cmd.executeList(ListType.UL)
    const dt = performance.now() - t0

    const e2 = cmd.getElementList()
    const idx2 = getListStartIndices(e2)
    expect(glyphAt(e2, idx2[249])).toBe('250.')
    expect(glyphAt(e2, idx2[250])).toBe('•')
    expect(glyphAt(e2, idx2[251])).toBe('251.')
    expect(dt).toBeLessThan(500)
  })
})
