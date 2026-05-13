// Bullet Library — Word-style symbol picker.
// Static config built once; tile rendering uses lightweight text (no editor pipeline).

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

export function buildBulletTiles(
  container: HTMLElement,
  onSelect: (char: string) => void
): IBulletTile[] {
  container.innerHTML = ''
  const tiles: IBulletTile[] = []
  BULLET_SYMBOLS.forEach((char, idx) => {
    const tile = document.createElement('div')
    tile.className = 'list-library-tile'
    tile.dataset.bulletChar = char
    tile.dataset.tileIndex = String(idx)
    tile.setAttribute('role', 'button')
    tile.setAttribute('tabindex', idx === 0 ? '0' : '-1')
    tile.setAttribute('aria-label', `Bullet ${char}`)
    tile.textContent = char
    tile.addEventListener('click', evt => {
      evt.stopPropagation()
      onSelect(char)
    })
    container.appendChild(tile)
    tiles.push({ char, element: tile })
  })
  return tiles
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
