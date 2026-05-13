// Shared dropdown shell for Word-style list libraries (bullet/numbering/multilevel).
// DOM-overlaid (not canvas). Handles open/close, outside-click, Escape,
// keyboard navigation between tiles + section links, and viewport-flip/shift.

export interface IListLibrarySection {
  // Optional section header text rendered above the section body.
  header?: string
  // Section body element (already built by caller — typically a tile grid).
  body: HTMLElement
}

export interface IListLibraryDropdownConfig {
  // Element the dropdown anchors to (the caret span on the toolbar).
  anchor: HTMLElement
  // Title shown at top of dropdown (e.g. "Bullet Library").
  title: string
  // Ordered list of sections; rendered with dividers between them.
  sections: IListLibrarySection[]
  // Optional "Define New …" link at the bottom (above None).
  defineNewLabel?: string
  onDefineNew?: () => void
  // Optional "None" row at the very bottom — removes list formatting.
  onNone?: () => void
  // Called when the dropdown closes for any reason.
  onClose?: () => void
}

export interface IListLibraryDropdownHandle {
  root: HTMLElement
  close: () => void
}

const Z_INDEX = 3000
const VIEWPORT_MARGIN = 8

export function openListLibraryDropdown(
  config: IListLibraryDropdownConfig
): IListLibraryDropdownHandle {
  const root = document.createElement('div')
  root.className = 'list-library-dropdown'
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-label', config.title)
  root.style.zIndex = String(Z_INDEX)

  const header = document.createElement('div')
  header.className = 'list-library-header'
  header.textContent = config.title
  root.appendChild(header)

  config.sections.forEach((section, idx) => {
    if (idx > 0) {
      const divider = document.createElement('div')
      divider.className = 'list-library-divider'
      root.appendChild(divider)
    }
    if (section.header) {
      const sectionHeader = document.createElement('div')
      sectionHeader.className = 'list-library-section-header'
      sectionHeader.textContent = section.header
      root.appendChild(sectionHeader)
    }
    root.appendChild(section.body)
  })

  if (config.onDefineNew && config.defineNewLabel) {
    const divider = document.createElement('div')
    divider.className = 'list-library-divider'
    root.appendChild(divider)
    const link = document.createElement('div')
    link.className = 'list-library-link'
    link.setAttribute('role', 'button')
    link.setAttribute('tabindex', '-1')
    link.textContent = config.defineNewLabel
    link.addEventListener('click', evt => {
      evt.stopPropagation()
      config.onDefineNew?.()
    })
    root.appendChild(link)
  }

  if (config.onNone) {
    const divider = document.createElement('div')
    divider.className = 'list-library-divider'
    root.appendChild(divider)
    const noneRow = document.createElement('div')
    noneRow.className = 'list-library-none'
    noneRow.setAttribute('role', 'button')
    noneRow.setAttribute('tabindex', '-1')
    noneRow.textContent = 'None'
    noneRow.addEventListener('click', evt => {
      evt.stopPropagation()
      config.onNone?.()
      close()
    })
    root.appendChild(noneRow)
  }

  document.body.appendChild(root)
  positionDropdown(root, config.anchor)

  const firstTile = root.querySelector<HTMLElement>('[tabindex="0"]')
  firstTile?.focus()

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    document.removeEventListener('mousedown', onOutside, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', onViewportChange)
    window.removeEventListener('scroll', onViewportChange, true)
    root.remove()
    config.anchor.setAttribute('aria-expanded', 'false')
    config.onClose?.()
  }

  const onOutside = (evt: MouseEvent) => {
    const target = evt.target as Node
    if (root.contains(target)) return
    if (config.anchor.contains(target)) return
    close()
  }

  const onKey = (evt: KeyboardEvent) => {
    if (evt.key === 'Escape') {
      evt.preventDefault()
      close()
      config.anchor.focus()
      return
    }
    if (
      evt.key === 'ArrowRight' ||
      evt.key === 'ArrowLeft' ||
      evt.key === 'ArrowUp' ||
      evt.key === 'ArrowDown'
    ) {
      handleArrowNav(evt, root)
      return
    }
    if (evt.key === 'Tab') {
      handleTabNav(evt, root)
      return
    }
    if (evt.key === 'Enter' || evt.key === ' ') {
      const active = document.activeElement as HTMLElement | null
      if (active && root.contains(active)) {
        evt.preventDefault()
        active.click()
      }
    }
  }

  const onViewportChange = () => positionDropdown(root, config.anchor)

  document.addEventListener('mousedown', onOutside, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  config.anchor.setAttribute('aria-expanded', 'true')

  return { root, close }
}

function positionDropdown(root: HTMLElement, anchor: HTMLElement): void {
  root.style.top = '0px'
  root.style.left = '0px'
  const anchorRect = anchor.getBoundingClientRect()
  const dropdownRect = root.getBoundingClientRect()
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  let left = anchorRect.left
  if (left + dropdownRect.width > viewportW - VIEWPORT_MARGIN) {
    left = Math.max(
      VIEWPORT_MARGIN,
      viewportW - dropdownRect.width - VIEWPORT_MARGIN
    )
  }

  let top = anchorRect.bottom + 2
  if (
    top + dropdownRect.height > viewportH - VIEWPORT_MARGIN &&
    anchorRect.top - dropdownRect.height - 2 >= VIEWPORT_MARGIN
  ) {
    top = anchorRect.top - dropdownRect.height - 2
  }

  root.style.left = `${Math.max(VIEWPORT_MARGIN, left)}px`
  root.style.top = `${Math.max(VIEWPORT_MARGIN, top)}px`
}

function getTiles(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.list-library-tile'))
}

function handleArrowNav(evt: KeyboardEvent, root: HTMLElement): void {
  const tiles = getTiles(root)
  if (tiles.length === 0) return
  const active = document.activeElement as HTMLElement | null
  const currentIdx = active ? tiles.indexOf(active) : -1
  if (currentIdx === -1) {
    evt.preventDefault()
    focusTile(tiles, 0)
    return
  }
  const firstTop = tiles[0].getBoundingClientRect().top
  let columns = 1
  for (let i = 1; i < tiles.length; i++) {
    if (Math.abs(tiles[i].getBoundingClientRect().top - firstTop) > 1) break
    columns++
  }
  let next = currentIdx
  switch (evt.key) {
    case 'ArrowRight':
      next = Math.min(tiles.length - 1, currentIdx + 1)
      break
    case 'ArrowLeft':
      next = Math.max(0, currentIdx - 1)
      break
    case 'ArrowDown':
      next = Math.min(tiles.length - 1, currentIdx + columns)
      break
    case 'ArrowUp':
      next = Math.max(0, currentIdx - columns)
      break
  }
  if (next !== currentIdx) {
    evt.preventDefault()
    focusTile(tiles, next)
  }
}

function focusTile(tiles: HTMLElement[], idx: number): void {
  tiles.forEach((t, i) => t.setAttribute('tabindex', i === idx ? '0' : '-1'))
  tiles[idx].focus()
}

function handleTabNav(evt: KeyboardEvent, root: HTMLElement): void {
  const tiles = getTiles(root)
  const link = root.querySelector<HTMLElement>('.list-library-link')
  const none = root.querySelector<HTMLElement>('.list-library-none')
  const stops: HTMLElement[] = []
  if (tiles.length > 0) {
    const focused = tiles.find(t => t.getAttribute('tabindex') === '0')
    stops.push(focused || tiles[0])
  }
  if (link) stops.push(link)
  if (none) stops.push(none)
  if (stops.length <= 1) return
  const active = document.activeElement as HTMLElement | null
  const idx = active ? stops.indexOf(active) : -1
  const dir = evt.shiftKey ? -1 : 1
  const nextIdx = (idx + dir + stops.length) % stops.length
  evt.preventDefault()
  stops[nextIdx].focus()
}
