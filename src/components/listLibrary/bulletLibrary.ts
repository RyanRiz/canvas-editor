// Bullet Library — Word-style symbol picker.
// Static config built once; tile rendering uses lightweight text (no editor pipeline).

import type { IListLevelStyle, IListStyle } from '../../editor/interface/List'
import { LIST_MAX_LEVEL } from '../../editor/interface/List'

export const BULLET_SYMBOLS: readonly string[] = [
  '●',
  '○',
  '■',
  '◻',
  '★',
  '→',
  '+',
  '–',
  '◆',
  '◇',
  '❖',
  '➢',
  '☺',
  '☹',
  '✓'
]

export interface IBulletTile {
  char: string
  element: HTMLDivElement
}

export interface IBulletSection {
  body: HTMLElement
  tiles: IBulletTile[]
}

export function buildBulletGridSection(
  onSelect: (char: string) => void
): IBulletSection {
  const body = document.createElement('div')
  body.className = 'list-library-grid list-library-grid--bullet'
  const tiles: IBulletTile[] = []
  BULLET_SYMBOLS.forEach((char, idx) => {
    const tile = buildBulletTile(char, idx === 0, onSelect)
    body.appendChild(tile.element)
    tiles.push(tile)
  })
  return { body, tiles }
}

export function buildDocumentBulletsSection(
  usedChars: readonly string[],
  onSelect: (char: string) => void
): IBulletSection | null {
  if (usedChars.length === 0) return null
  const body = document.createElement('div')
  body.className = 'list-library-grid list-library-grid--bullet'
  const tiles: IBulletTile[] = []
  usedChars.forEach(char => {
    const tile = buildBulletTile(char, false, onSelect)
    body.appendChild(tile.element)
    tiles.push(tile)
  })
  return { body, tiles }
}

export function highlightSelectedBullet(
  tiles: IBulletTile[],
  activeChar: string | null
): void {
  for (const t of tiles) {
    if (activeChar && t.char === activeChar) {
      t.element.classList.add('selected')
    } else {
      t.element.classList.remove('selected')
    }
  }
}

// Build a 9-level IListStyle that applies the chosen bullet char to every level.
// applyStyle keys off the current element's listLevel; covering all levels
// lets the same picker work whether the caret is at level 1 or deeper.
export function buildBulletListStyle(char: string): IListStyle {
  const levels: IListLevelStyle[] = []
  for (let lvl = 1; lvl <= LIST_MAX_LEVEL; lvl++) {
    levels.push({
      level: lvl,
      format: '%1',
      numberStyle: 'bullet',
      bulletChar: char,
      numberAlignment: 0,
      textIndent: 0,
      followNumberWith: 'tab'
    })
  }
  return {
    id: `bullet-${char}`,
    family: 'bulleted',
    continuePrevious: false,
    levels
  }
}

function buildBulletTile(
  char: string,
  isFirst: boolean,
  onSelect: (char: string) => void
): IBulletTile {
  const tile = document.createElement('div')
  tile.className = 'list-library-tile list-library-tile--bullet'
  tile.dataset.bulletChar = char
  tile.setAttribute('role', 'button')
  tile.setAttribute('tabindex', isFirst ? '0' : '-1')
  tile.setAttribute('aria-label', `Bullet ${char}`)
  tile.textContent = char
  tile.addEventListener('click', evt => {
    evt.stopPropagation()
    onSelect(char)
  })
  return { char, element: tile }
}

// Back-compat shim — earlier slice used this signature. Kept so legacy
// imports still compile while Slice A migrates to the section builders.
export function buildBulletTiles(
  container: HTMLElement,
  onSelect: (char: string) => void
): IBulletTile[] {
  container.innerHTML = ''
  const section = buildBulletGridSection(onSelect)
  while (section.body.firstChild) {
    container.appendChild(section.body.firstChild)
  }
  return section.tiles
}
