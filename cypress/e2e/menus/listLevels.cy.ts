import Editor, { ListStyle, ListType } from '../../../src/editor'
import { computeListGlyphMap } from '../../../src/editor/utils/listNumbering'
import { IElement } from '../../../src/editor/interface/Element'

const ZERO = '​'

function makeListItem(
  listId: string,
  level: number,
  listType: ListType,
  listStyle: ListStyle | undefined,
  text: string
): IElement[] {
  const items: IElement[] = [
    {
      value: ZERO,
      listId,
      listType,
      listStyle,
      listLevel: level
    }
  ]
  for (const c of text) {
    items.push({
      value: c,
      listId,
      listType,
      listStyle,
      listLevel: level
    })
  }
  return items
}

describe('菜单-列表-多级缩进', () => {
  beforeEach(() => {
    cy.visit('http://localhost:3000/canvas-editor/')
    cy.get('canvas').first().as('canvas').should('have.length', 1)
  })

  function resetAndInsertList(editor: Editor, text: string) {
    editor.command.executeSelectAll()
    editor.command.executeBackspace()
    editor.command.executeInsertElementList([{ value: text }])
    editor.command.executeSetRange(0, text.length)
    editor.command.executeList(<ListType>'ol')
  }

  function findFirstListItemElement(editor: Editor) {
    const list = editor.command.getElementList()
    return list.find(el => !!el.listId)
  }

  it('indent promotes level 1 → 2', () => {
    cy.getEditor().then((editor: Editor) => {
      resetAndInsertList(editor, 'item one')
      editor.command.executeListIndent()
      const el = findFirstListItemElement(editor)
      expect(el?.listLevel ?? 1).to.eq(2)
    })
  })

  it('indent twice yields level 3', () => {
    cy.getEditor().then((editor: Editor) => {
      resetAndInsertList(editor, 'deep')
      editor.command.executeListIndent()
      editor.command.executeListIndent()
      const el = findFirstListItemElement(editor)
      expect(el?.listLevel).to.eq(3)
    })
  })

  it('indent clamps at level 9', () => {
    cy.getEditor().then((editor: Editor) => {
      resetAndInsertList(editor, 'cap')
      for (let i = 0; i < 12; i++) editor.command.executeListIndent()
      const el = findFirstListItemElement(editor)
      expect(el?.listLevel).to.eq(9)
    })
  })

  it('outdent demotes level 3 → 2', () => {
    cy.getEditor().then((editor: Editor) => {
      resetAndInsertList(editor, 'demote me')
      editor.command.executeListIndent()
      editor.command.executeListIndent()
      editor.command.executeListOutdent()
      const el = findFirstListItemElement(editor)
      expect(el?.listLevel).to.eq(2)
    })
  })

  it('outdent at level 1 exits the list', () => {
    cy.getEditor().then((editor: Editor) => {
      resetAndInsertList(editor, 'exit')
      editor.command.executeListOutdent()
      const el = findFirstListItemElement(editor)
      expect(el).to.eq(undefined)
    })
  })

  it('undo after indent restores previous level', () => {
    cy.getEditor().then((editor: Editor) => {
      resetAndInsertList(editor, 'undo me')
      editor.command.executeListIndent()
      expect(findFirstListItemElement(editor)?.listLevel).to.eq(2)
      editor.command.executeUndo()
      const restored = findFirstListItemElement(editor)
      expect(restored?.listLevel ?? 1).to.eq(1)
    })
  })

  it('redo after undo re-applies indent', () => {
    cy.getEditor().then((editor: Editor) => {
      resetAndInsertList(editor, 'redo me')
      editor.command.executeListIndent()
      editor.command.executeUndo()
      editor.command.executeRedo()
      const el = findFirstListItemElement(editor)
      expect(el?.listLevel).to.eq(2)
    })
  })

  describe('numbering engine', () => {
    it('decimal cascade L1 → a → i across levels', () => {
      const list = [
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'one'),
        ...makeListItem('x', 2, ListType.OL, ListStyle.DECIMAL, 'two'),
        ...makeListItem('x', 3, ListType.OL, ListStyle.DECIMAL, 'three')
      ]
      const map = computeListGlyphMap(list)
      expect(map.get(0)?.glyph).to.eq('1.')
      expect(map.get(4)?.glyph).to.eq('a.')
      expect(map.get(8)?.glyph).to.eq('i.')
    })

    it('legal family renders ancestor path 1. → 1.1. → 1.1.1.', () => {
      const list = [
        ...makeListItem('x', 1, ListType.OL, ListStyle.LEGAL, 'a'),
        ...makeListItem('x', 2, ListType.OL, ListStyle.LEGAL, 'b'),
        ...makeListItem('x', 3, ListType.OL, ListStyle.LEGAL, 'c'),
        ...makeListItem('x', 3, ListType.OL, ListStyle.LEGAL, 'd'),
        ...makeListItem('x', 2, ListType.OL, ListStyle.LEGAL, 'e')
      ]
      const map = computeListGlyphMap(list)
      expect(map.get(0)?.glyph).to.eq('1.')
      expect(map.get(2)?.glyph).to.eq('1.1.')
      expect(map.get(4)?.glyph).to.eq('1.1.1.')
      expect(map.get(6)?.glyph).to.eq('1.1.2.')
      expect(map.get(8)?.glyph).to.eq('1.2.')
    })

    it('lowerRoman at L1 renders i. ii. iii.', () => {
      const list = [
        ...makeListItem('x', 1, ListType.OL, ListStyle.LOWER_ROMAN, 'a'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.LOWER_ROMAN, 'b'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.LOWER_ROMAN, 'c')
      ]
      const map = computeListGlyphMap(list)
      expect(map.get(0)?.glyph).to.eq('i.')
      expect(map.get(2)?.glyph).to.eq('ii.')
      expect(map.get(4)?.glyph).to.eq('iii.')
    })

    it('upperRoman at L1 renders I. II. III.', () => {
      const list = [
        ...makeListItem('x', 1, ListType.OL, ListStyle.UPPER_ROMAN, 'a'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.UPPER_ROMAN, 'b'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.UPPER_ROMAN, 'c')
      ]
      const map = computeListGlyphMap(list)
      expect(map.get(0)?.glyph).to.eq('I.')
      expect(map.get(2)?.glyph).to.eq('II.')
      expect(map.get(4)?.glyph).to.eq('III.')
    })

    it('upperAlpha at L1 renders A. B. C.', () => {
      const list = [
        ...makeListItem('x', 1, ListType.OL, ListStyle.UPPER_ALPHA, 'a'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.UPPER_ALPHA, 'b'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.UPPER_ALPHA, 'c')
      ]
      const map = computeListGlyphMap(list)
      expect(map.get(0)?.glyph).to.eq('A.')
      expect(map.get(2)?.glyph).to.eq('B.')
      expect(map.get(4)?.glyph).to.eq('C.')
    })

    it('UL bullet cascade L1 → L2 → L3 cycles disc / circle / square', () => {
      const list = [
        ...makeListItem('y', 1, ListType.UL, ListStyle.DISC, 'a'),
        ...makeListItem('y', 2, ListType.UL, ListStyle.DISC, 'b'),
        ...makeListItem('y', 3, ListType.UL, ListStyle.DISC, 'c')
      ]
      const map = computeListGlyphMap(list)
      expect(map.get(0)?.glyph).to.eq('•')
      expect(map.get(2)?.glyph).to.eq('◦')
      expect(map.get(4)?.glyph).to.eq('▫︎')
    })

    it('alpha rolls over a → z → aa', () => {
      const items: IElement[] = []
      for (let i = 0; i < 27; i++) {
        items.push(
          ...makeListItem('x', 1, ListType.OL, ListStyle.LOWER_ALPHA, 'x')
        )
      }
      const map = computeListGlyphMap(items)
      // 26th item index = 25 * 2 = 50
      expect(map.get(50)?.glyph).to.eq('z.')
      // 27th item index = 26 * 2 = 52
      expect(map.get(52)?.glyph).to.eq('aa.')
    })

    it('mid-list deletion renumbers downstream items', () => {
      const list = [
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'a'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'b'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'c'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'd')
      ]
      // Drop the 2nd item (positions 2..3)
      list.splice(2, 2)
      const map = computeListGlyphMap(list)
      expect(map.get(0)?.glyph).to.eq('1.')
      expect(map.get(2)?.glyph).to.eq('2.')
      expect(map.get(4)?.glyph).to.eq('3.')
    })

    // Word parity: when a middle OL item is converted to a bullet, the
    // numbered sequence around the bullet must keep counting (1,2,3,•,4,5)
    // — both right after the change (different listId for the bullet) and
    // after a save/reload round-trip (same listId for everything, since
    // setList now reuses adjacent listId).
    it('mid-list bullet keeps surrounding OL numbering continuous (Word parity)', () => {
      const split = [
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'a'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'b'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'c'),
        ...makeListItem('y', 1, ListType.UL, ListStyle.DISC, 'd'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'e'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'f')
      ]
      const splitMap = computeListGlyphMap(split)
      expect(splitMap.get(0)?.glyph).to.eq('1.')
      expect(splitMap.get(2)?.glyph).to.eq('2.')
      expect(splitMap.get(4)?.glyph).to.eq('3.')
      expect(splitMap.get(6)?.glyph).to.eq('•')
      expect(splitMap.get(8)?.glyph).to.eq('4.')
      expect(splitMap.get(10)?.glyph).to.eq('5.')

      const shared = [
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'a'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'b'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'c'),
        ...makeListItem('x', 1, ListType.UL, ListStyle.DISC, 'd'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'e'),
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'f')
      ]
      const sharedMap = computeListGlyphMap(shared)
      expect(sharedMap.get(0)?.glyph).to.eq('1.')
      expect(sharedMap.get(2)?.glyph).to.eq('2.')
      expect(sharedMap.get(4)?.glyph).to.eq('3.')
      expect(sharedMap.get(6)?.glyph).to.eq('•')
      expect(sharedMap.get(8)?.glyph).to.eq('4.')
      expect(sharedMap.get(10)?.glyph).to.eq('5.')
    })
  })

  describe('state preservation through indent', () => {
    it('LEGAL style survives indent', () => {
      cy.getEditor().then((editor: Editor) => {
        editor.command.executeSelectAll()
        editor.command.executeBackspace()
        editor.command.executeInsertElementList([{ value: 'legal item' }])
        editor.command.executeSetRange(0, 'legal item'.length)
        editor.command.executeList(ListType.OL, ListStyle.LEGAL)
        editor.command.executeListIndent()
        const el = findFirstListItemElement(editor)
        expect(el?.listStyle).to.eq(ListStyle.LEGAL)
        expect(el?.listLevel).to.eq(2)
      })
    })

    it('LOWER_ROMAN style survives indent and outdent round trip', () => {
      cy.getEditor().then((editor: Editor) => {
        editor.command.executeSelectAll()
        editor.command.executeBackspace()
        editor.command.executeInsertElementList([{ value: 'roman item' }])
        editor.command.executeSetRange(0, 'roman item'.length)
        editor.command.executeList(ListType.OL, ListStyle.LOWER_ROMAN)
        editor.command.executeListIndent()
        editor.command.executeListOutdent()
        const el = findFirstListItemElement(editor)
        expect(el?.listStyle).to.eq(ListStyle.LOWER_ROMAN)
        expect(el?.listLevel ?? 1).to.eq(1)
      })
    })
  })

  describe('custom format strings', () => {
    function withFormat(items: IElement[], format: string): IElement[] {
      return items.map(it => (it.listId ? { ...it, listFormat: format } : it))
    }

    it('Step %1: renders Step 1: Step 2:', () => {
      const a = makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'a')
      const b = makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'b')
      const list = withFormat([...a, ...b], 'Step %1:')
      const map = computeListGlyphMap(list)
      expect(map.get(0)?.glyph).to.eq('Step 1:')
      expect(map.get(a.length)?.glyph).to.eq('Step 2:')
    })

    it('%1.%2.%3 renders ancestor chain advancing counters', () => {
      const a = makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'a')
      const b = makeListItem('x', 2, ListType.OL, ListStyle.DECIMAL, 'b')
      const c = makeListItem('x', 3, ListType.OL, ListStyle.DECIMAL, 'c')
      const d = makeListItem('x', 3, ListType.OL, ListStyle.DECIMAL, 'd')
      const list = withFormat([...a, ...b, ...c, ...d], '%1.%2.%3')
      const map = computeListGlyphMap(list)
      const oA = 0
      const oB = a.length
      const oC = oB + b.length
      const oD = oC + c.length
      expect(map.get(oA)?.glyph).to.eq('1.1.1') // L1, L2/L3 unvisited
      expect(map.get(oB)?.glyph).to.eq('1.1.1') // L2 visit (L3 unvisited)
      expect(map.get(oC)?.glyph).to.eq('1.1.1') // first L3 visit
      expect(map.get(oD)?.glyph).to.eq('1.1.2') // second L3 visit
    })

    it('literal text preserved around tokens', () => {
      const a = makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'a')
      const b = makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'b')
      const list = withFormat([...a, ...b], '(%1)')
      const map = computeListGlyphMap(list)
      expect(map.get(0)?.glyph).to.eq('(1)')
      expect(map.get(a.length)?.glyph).to.eq('(2)')
    })

    it('listFormat overrides LEGAL family render', () => {
      const a = makeListItem('x', 1, ListType.OL, ListStyle.LEGAL, 'a')
      const b = makeListItem('x', 2, ListType.OL, ListStyle.LEGAL, 'b')
      const list = withFormat([...a, ...b], 'Sec %1.%2')
      const map = computeListGlyphMap(list)
      expect(map.get(0)?.glyph).to.eq('Sec 1.1')
      expect(map.get(a.length)?.glyph).to.eq('Sec 1.1')
    })

    it('executeListFormat applies and survives indent', () => {
      cy.getEditor().then((editor: Editor) => {
        editor.command.executeSelectAll()
        editor.command.executeBackspace()
        editor.command.executeInsertElementList([{ value: 'fmt' }])
        editor.command.executeSetRange(0, 'fmt'.length)
        editor.command.executeList(ListType.OL, ListStyle.DECIMAL)
        editor.command.executeListFormat('Step %1:')
        editor.command.executeListIndent()
        const el = findFirstListItemElement(editor)
        expect(el?.listFormat).to.eq('Step %1:')
        expect(el?.listLevel).to.eq(2)
      })
    })
  })

  describe('explicit level set', () => {
    it('executeListSetLevel jumps to L5 then clamps at 9', () => {
      cy.getEditor().then((editor: Editor) => {
        editor.command.executeSelectAll()
        editor.command.executeBackspace()
        editor.command.executeInsertElementList([{ value: 'jump' }])
        editor.command.executeSetRange(0, 'jump'.length)
        editor.command.executeList(ListType.OL, ListStyle.DECIMAL)
        editor.command.executeListSetLevel(5)
        expect(findFirstListItemElement(editor)?.listLevel).to.eq(5)
        editor.command.executeListSetLevel(99)
        expect(findFirstListItemElement(editor)?.listLevel).to.eq(9)
        editor.command.executeListSetLevel(0)
        expect(findFirstListItemElement(editor)?.listLevel).to.eq(1)
      })
    })

    it('engine renders L4-L9 without crash', () => {
      const items: IElement[] = []
      for (let lvl = 1; lvl <= 9; lvl++) {
        items.push(
          ...makeListItem('x', lvl, ListType.OL, ListStyle.DECIMAL, 'a')
        )
      }
      const map = computeListGlyphMap(items)
      expect(map.size).to.eq(9)
      const itemLen = makeListItem(
        'x',
        1,
        ListType.OL,
        ListStyle.DECIMAL,
        'a'
      ).length
      expect(map.get(0)?.glyph).to.eq('1.')
      expect(map.get(itemLen * 3)?.glyph).to.eq('1.')
      expect(map.get(itemLen * 8)?.glyph).to.eq('i.')
    })
  })

  describe('edge cases', () => {
    it('two adjacent lists separated by non-list paragraph restart numbering', () => {
      const listA = [
        ...makeListItem('a', 1, ListType.OL, ListStyle.DECIMAL, 'x'),
        ...makeListItem('a', 1, ListType.OL, ListStyle.DECIMAL, 'y')
      ]
      const gap: IElement[] = [{ value: ZERO }, { value: 'n' }]
      const listB = [
        ...makeListItem('b', 1, ListType.OL, ListStyle.DECIMAL, 'z'),
        ...makeListItem('b', 1, ListType.OL, ListStyle.DECIMAL, 'w')
      ]
      const list = [...listA, ...gap, ...listB]
      const map = computeListGlyphMap(list)
      expect(map.get(0)?.glyph).to.eq('1.')
      expect(map.get(listA.length / 2)?.glyph).to.eq('2.')
      const bStart = listA.length + gap.length
      expect(map.get(bStart)?.glyph).to.eq('1.')
    })

    it('mixed-level outdent decrements each paragraph independently', () => {
      cy.getEditor().then((editor: Editor) => {
        editor.command.executeSelectAll()
        editor.command.executeBackspace()
        editor.command.executeInsertElementList([{ value: 'one' }])
        editor.command.executeSetRange(0, 'one'.length)
        editor.command.executeList(ListType.OL, ListStyle.DECIMAL)
        editor.command.executeListIndent()
        editor.command.executeListIndent()
        expect(findFirstListItemElement(editor)?.listLevel).to.eq(3)
        editor.command.executeListOutdent()
        expect(findFirstListItemElement(editor)?.listLevel).to.eq(2)
      })
    })

    it('500-item list glyph computation under 50ms', () => {
      const items: IElement[] = []
      for (let n = 0; n < 500; n++) {
        items.push(
          ...makeListItem('big', 1, ListType.OL, ListStyle.DECIMAL, 'x')
        )
      }
      const t0 = performance.now()
      const map = computeListGlyphMap(items)
      const dt = performance.now() - t0
      expect(map.size).to.eq(500)
      expect(dt).to.be.lessThan(50)
    })

    it('executeListStyle applies per-level overrides', () => {
      cy.getEditor().then((editor: Editor) => {
        editor.command.executeSelectAll()
        editor.command.executeBackspace()
        editor.command.executeInsertElementList([{ value: 'styled' }])
        editor.command.executeSetRange(0, 'styled'.length)
        editor.command.executeList(ListType.OL, ListStyle.DECIMAL)
        editor.command.executeListStyle({
          id: 's',
          family: 'custom',
          continuePrevious: false,
          levels: [
            {
              level: 1,
              format: '(%N)',
              numberStyle: 'upperRoman',
              numberAlignment: 0,
              textIndent: 36,
              followNumberWith: 'tab'
            }
          ]
        })
        const el = findFirstListItemElement(editor)
        expect(el?.listFormat).to.eq('(%N)')
        expect(el?.listNumberStyle).to.eq('upperRoman')
      })
    })

    it('engine honors per-element listNumberStyle override', () => {
      const items = makeListItem(
        'x',
        1,
        ListType.OL,
        ListStyle.DECIMAL,
        'a'
      ).map(it =>
        it.listId ? { ...it, listNumberStyle: 'upperRoman' as const } : it
      )
      items.push(
        ...makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'b').map(it =>
          it.listId ? { ...it, listNumberStyle: 'upperRoman' as const } : it
        )
      )
      const map = computeListGlyphMap(items)
      expect(map.get(0)?.glyph).to.eq('I.')
      expect(
        map.get(
          makeListItem('x', 1, ListType.OL, ListStyle.DECIMAL, 'a').length
        )?.glyph
      ).to.eq('II.')
    })

    it('engine honors per-element listBulletChar override on UL', () => {
      const items = makeListItem('y', 1, ListType.UL, ListStyle.DISC, 'a').map(
        it => (it.listId ? { ...it, listBulletChar: '★' } : it)
      )
      const map = computeListGlyphMap(items)
      expect(map.get(0)?.glyph).to.eq('★')
    })

    it('listLevel preserved on element insert via context propagation', () => {
      cy.getEditor().then((editor: Editor) => {
        editor.command.executeSelectAll()
        editor.command.executeBackspace()
        editor.command.executeInsertElementList([{ value: 'preserve' }])
        editor.command.executeSetRange(0, 'preserve'.length)
        editor.command.executeList(ListType.OL, ListStyle.DECIMAL)
        editor.command.executeListIndent()
        editor.command.executeListIndent()
        const before = findFirstListItemElement(editor)
        expect(before?.listLevel).to.eq(3)
        // Insert more text at end of paragraph
        const list = editor.command.getElementList()
        const lastIdx = list.length - 1
        editor.command.executeSetRange(lastIdx, lastIdx)
        editor.command.executeInsertElementList([{ value: 'more' }])
        const after = editor.command
          .getElementList()
          .find(el => el.value === 'm' && el.listId)
        expect(after?.listLevel).to.eq(3)
      })
    })
  })
})
