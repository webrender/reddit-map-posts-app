import type {Pin} from '../shared/api.ts'

/** A run of Pins sharing a Category, or the uncategorized run. */
export type PinGroup = {
  /** `undefined` for the group of Pins with no Category. */
  category: string | undefined
  pins: Pin[]
}

/** Narrows Pins to the active Category filter; an empty filter matches all. */
export function filterPins(pins: Pin[], category: string): Pin[] {
  if (!category) return pins
  return pins.filter(pin => pin.category === category)
}

/**
 * Groups Pins for display: Categories alphabetically, the uncategorized Pins
 * last, Pins alphabetically by title within each group.
 */
export function groupPinsByCategory(pins: Pin[]): PinGroup[] {
  const byCategory = new Map<string, Pin[]>()
  const uncategorized: Pin[] = []
  for (const pin of pins) {
    if (!pin.category) {
      uncategorized.push(pin)
      continue
    }
    const group = byCategory.get(pin.category)
    if (group) group.push(pin)
    else byCategory.set(pin.category, [pin])
  }

  const groups: PinGroup[] = [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, groupPins]) => ({category, pins: sortByTitle(groupPins)}))
  if (uncategorized.length) {
    groups.push({category: undefined, pins: sortByTitle(uncategorized)})
  }
  return groups
}

/**
 * Whether to render group headings. They only earn their space when there is
 * more than one group to tell apart — whether the filter narrowed it to one or
 * the Map only ever had one.
 */
export function showsHeadings(groups: PinGroup[]): boolean {
  return groups.length > 1
}

/**
 * A Selected Pin the visible set no longer contains is no selection at all, so
 * the Map and the Sidebar can never disagree about what is selected.
 */
export function resolveSelection(
  selectedPinId: string | undefined,
  visible: Pin[],
): string | undefined {
  if (!selectedPinId) return undefined
  return visible.some(pin => pin.id === selectedPinId)
    ? selectedPinId
    : undefined
}

function sortByTitle(pins: Pin[]): Pin[] {
  return [...pins].sort((a, b) => a.title.localeCompare(b.title))
}

export type SidebarHandlers = {
  /** A Pin Card was clicked. */
  onSelectCard(pinId: string): void
  /** A Pin Card's edit control was clicked; Owners only. */
  onEditPin(pinId: string): void
  /** The Sidebar opened or closed, changing how much room the Map has. */
  onToggle(open: boolean): void
}

export type SidebarState = {
  /** Already narrowed by the Category filter. */
  pins: Pin[]
  selectedPinId: string | undefined
  isOwner: boolean
  /** Whether a Category filter is what emptied the list, if it is empty. */
  filtered: boolean
}

const uncategorizedHeading = 'Uncategorized'

let listEl: HTMLElement
let toggleEl: HTMLButtonElement
let handlers: SidebarHandlers
let open = false

export function initSidebar(sidebarHandlers: SidebarHandlers): void {
  handlers = sidebarHandlers
  listEl = document.getElementById('pin-list') as HTMLElement
  toggleEl = document.getElementById('sidebar-toggle') as HTMLButtonElement
  toggleEl.addEventListener('click', () => setSidebarOpen(!open))
}

/** Below this the Sidebar overlays the Map instead of taking a column of it. */
export function isNarrowViewport(): boolean {
  return !window.matchMedia('(min-width: 640px)').matches
}

export function isSidebarOpen(): boolean {
  return open
}

export function setSidebarOpen(next: boolean): void {
  if (next === open) return
  open = next
  document.body.classList.toggle('sidebar-open', open)
  toggleEl.setAttribute('aria-expanded', String(open))
  handlers.onToggle(open)
}

export function renderSidebar(state: SidebarState): void {
  toggleEl.textContent = `Pins (${state.pins.length})`
  listEl.replaceChildren()

  if (!state.pins.length) {
    listEl.append(emptyMessage(state))
    return
  }

  const groups = groupPinsByCategory(state.pins)
  const headings = showsHeadings(groups)
  for (const group of groups) {
    const section = document.createElement('section')
    section.className = 'pin-group'
    if (headings) {
      const heading = document.createElement('h2')
      heading.className = 'pin-group-heading'
      heading.textContent = group.category ?? uncategorizedHeading
      section.append(heading)
    }
    for (const pin of group.pins) {
      section.append(
        pinCard(pin, state.isOwner, pin.id === state.selectedPinId),
      )
    }
    listEl.append(section)
  }
}

/**
 * Repaints the selection without rebuilding the list, which would throw away
 * the scroll position the user is reading from.
 */
export function setSelectedCard(selectedPinId: string | undefined): void {
  for (const card of listEl.querySelectorAll('.pin-card')) {
    const selected = (card as HTMLElement).dataset.pinId === selectedPinId
    card.classList.toggle('selected', selected)
  }
}

export function scrollPinIntoView(pinId: string): void {
  const card = listEl.querySelector(`[data-pin-id="${CSS.escape(pinId)}"]`)
  card?.scrollIntoView({behavior: 'smooth', block: 'nearest'})
}

function emptyMessage(state: SidebarState): HTMLElement {
  const message = document.createElement('p')
  message.id = 'pin-list-empty'
  if (state.filtered) message.textContent = 'No pins in this category.'
  else if (state.isOwner) {
    message.textContent = 'No pins yet — search for a place or drop a pin.'
  } else message.textContent = 'No pins yet.'
  return message
}

function pinCard(pin: Pin, isOwner: boolean, selected: boolean): HTMLElement {
  // A card holds a link and (for Owners) an edit button, and a <button> may not
  // contain an <a> — hence a div carrying the button role by hand.
  const card = document.createElement('div')
  card.className = selected ? 'pin-card selected' : 'pin-card'
  card.dataset.pinId = pin.id
  card.setAttribute('role', 'button')
  card.tabIndex = 0
  card.addEventListener('click', () => handlers.onSelectCard(pin.id))
  card.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return
    ev.preventDefault()
    handlers.onSelectCard(pin.id)
  })

  if (pin.imageUrl) {
    const image = document.createElement('img')
    image.className = 'pin-card-image'
    image.src = pin.imageUrl
    image.alt = ''
    card.append(image)
  }

  const body = document.createElement('div')
  body.className = 'pin-card-body'

  const title = document.createElement('h3')
  title.className = 'pin-card-title'
  title.textContent = pin.title
  body.append(title)

  if (pin.category) {
    const category = document.createElement('span')
    category.className = 'pin-card-category'
    category.textContent = pin.category
    body.append(category)
  }

  if (pin.description) {
    const description = document.createElement('p')
    description.className = 'pin-card-description'
    description.textContent = pin.description
    body.append(description)
  }

  if (pin.link) {
    const link = document.createElement('a')
    link.className = 'pin-card-link'
    link.href = pin.link
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = 'More info'
    link.addEventListener('click', ev => ev.stopPropagation())
    body.append(link)
  }

  card.append(body)

  if (isOwner) {
    const actions = document.createElement('div')
    actions.className = 'pin-card-actions'
    const edit = document.createElement('button')
    edit.className = 'pin-card-edit'
    edit.type = 'button'
    edit.textContent = 'Edit'
    edit.setAttribute('aria-label', `Edit ${pin.title}`)
    edit.addEventListener('click', ev => {
      ev.stopPropagation()
      handlers.onEditPin(pin.id)
    })
    actions.append(edit)
    card.append(actions)
  }

  return card
}
