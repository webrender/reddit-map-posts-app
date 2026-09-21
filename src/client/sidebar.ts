import type {Pin} from '../shared/api.ts'
import {sortPins} from '../shared/pin-order.ts'
import {pinColor, uncategorizedColor} from './category-color.ts'
import {renderMarkdown} from './markdown.ts'
import type {RegionGroup} from './region.ts'

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
 * last, and within each group the Map's hand-made `order`, then by title for
 * any Pin it does not name.
 */
export function groupPinsByCategory(
  pins: Pin[],
  order: readonly string[] = [],
): PinGroup[] {
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
    .map(([category, groupPins]) => ({
      category,
      pins: sortPins(groupPins, order),
    }))
  if (uncategorized.length) {
    groups.push({category: undefined, pins: sortPins(uncategorized, order)})
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

/**
 * Every Pin's number: its place in the Sidebar read top to bottom, starting at
 * 1. Worked out from the same grouping the Sidebar draws, so a marker's number
 * and its card's can never disagree, and reordering a group renumbers it.
 */
export function numberPins(
  pins: Pin[],
  regionGroups: RegionGroup[] | undefined,
  order: readonly string[],
): Map<string, number> {
  const numbers = new Map<string, number>()
  for (const group of regionGroups ?? [{region: undefined, pins}]) {
    for (const categoryGroup of groupPinsByCategory(group.pins, order)) {
      for (const pin of categoryGroup.pins)
        numbers.set(pin.id, numbers.size + 1)
    }
  }
  return numbers
}

export type SidebarHandlers = {
  /** A Pin Card was clicked. */
  onSelectCard(pinId: string): void
  /** A Pin Card's edit control was clicked; only where the card offered one. */
  onEditPin(pinId: string): void
  /**
   * A card was dragged, or nudged from the keyboard, to a new place in its
   * group (its Region and Category). `groupIds` is the whole group in its new
   * order, only ever raised when that differs from what was drawn.
   */
  onReorderGroup(groupIds: string[]): void
  /** A Pin Card's external link was clicked. */
  onOpenLink(url: string): void
  /** The Sidebar opened or closed, changing how much room the Map has. */
  onToggle(open: boolean): void
  /**
   * A Region's heading was clicked; `undefined` for the Elsewhere heading,
   * which stands for no Region at all.
   */
  onSelectRegion(regionId: string | undefined): void
  /**
   * The reader's own scrolling brought a different Region's section to the top
   * of the Sidebar, or scrolled back above all of them (`undefined`). Only ever
   * raised for a scroll the reader made, on a wide viewport: see
   * {@link initSidebar}.
   */
  onActiveRegionChange(regionId: string | undefined): void
}

/**
 * What one Pin Card is allowed to offer, decided once by `canEditPin` in
 * `render()` — the one place on the client that predicate runs, so calling it
 * a second time from in here could never disagree with it. `author` is
 * already resolved to what the card should print, `ownerName` fallback for a
 * legacy Pin included: this module stays pure display and never learns about
 * `MapAccess` or `ownerName` itself.
 */
export type PinCapability = {canEdit: boolean; author: string | undefined}

export type SidebarState = {
  /** Already narrowed by the Category filter. */
  pins: Pin[]
  selectedPinId: string | undefined
  /** Whether this Map is a Collaborative one — the whole of what decides if a byline shows at all. */
  collaborative: boolean
  /**
   * Whether Add a Pin is on screen for this reader: what the empty-state copy
   * answers to. Keyed off "the button is there," not "the server would accept
   * the write" — a logged-out reader on a Collaborative Map sees the button
   * (see `showLoginPrompt` in `map.ts`) and gets the actionable copy too.
   */
  canAdd: boolean
  /** Whether a Category filter is what emptied the list, if it is empty. */
  filtered: boolean
  /**
   * Every Category on the Map to its colour — the whole Map's, not the visible
   * Pins', so a filter narrows what is listed without repainting it.
   */
  categoryColors: Map<string, string>
  /** Every visible Pin's id to what its card may offer. */
  pinCapabilities: Map<string, PinCapability>
  /**
   * The visible Pins grouped by Region, oldest Region first and the Pins in none
   * last — worked out once in `render()` and passed in, so this module stays
   * pure display and never learns what a polygon is. `undefined` where the Map
   * has no Regions, which is the whole compatibility story: the output is then
   * exactly what it was before Regions existed. See ADR-0021.
   */
  regionGroups: RegionGroup[] | undefined
  /** Every Region's name to its colour — the whole Map's, as for Categories. */
  regionColors: Map<string, string>
  /** The Map's hand-made Pin order; see `sortPins`. */
  order: readonly string[]
  /** Every visible Pin's number, as {@link numberPins} works it out. */
  numbers: Map<string, number>
  /** Whether this reader may reorder: `canEditMap`, decided once in `render()`. */
  canReorder: boolean
  /** The Region the tour has reached, if it has reached one. */
  activeRegionId: string | undefined
}

const uncategorizedHeading = 'Uncategorized'

/** The heading over the Pins that are in no Region, when there are Regions to be outside of. */
const elsewhereHeading = 'Elsewhere'

/**
 * How long the tour ignores scrolling after the app itself has scrolled the
 * Sidebar or rebuilt it. `scrollPinIntoView` runs after a save, after an edit
 * and on selecting a marker, all smoothly, and each would otherwise be read as
 * the reader steering the tour and yank the camera somewhere they never asked to
 * go.
 */
const tourSuppressMs = 700

/** Where in the Sidebar a Region's section has to reach to become the active one: the top 40%. */
const tourBand = 0.4

let listEl: HTMLElement
let sidebarEl: HTMLElement
let tourFrame: number | undefined
let suppressTourUntil = 0
let toggleEl: HTMLButtonElement
let handlers: SidebarHandlers
let open = false
let pinCount = 0

export function initSidebar(sidebarHandlers: SidebarHandlers): void {
  handlers = sidebarHandlers
  listEl = document.getElementById('pin-list') as HTMLElement
  sidebarEl = document.getElementById('sidebar') as HTMLElement
  sidebarEl.addEventListener('scroll', onSidebarScroll, {passive: true})
  toggleEl = document.getElementById('sidebar-toggle') as HTMLButtonElement
  toggleEl.addEventListener('click', () => setSidebarOpen(!open))
  labelToggle()
}

/**
 * The toggle is an icon, so what it does and how many Pins are behind it are
 * only ever said in its accessible name — which has to be refreshed both when
 * the Sidebar opens and when the list it counts changes. The tooltip the
 * toolbar shows on hover is drawn from that same attribute, so this is the one
 * place the label is written.
 */
function labelToggle(): void {
  toggleEl.setAttribute(
    'aria-label',
    `${open ? 'Hide' : 'Show'} pins (${pinCount})`,
  )
}

function suppressTour(): void {
  suppressTourUntil = performance.now() + tourSuppressMs
}

/**
 * The tour. Only a scroll the reader made reaches it — one that follows the
 * app's own scrolling or rebuilding by less than {@link tourSuppressMs} is not
 * theirs — and only on a wide viewport: below 640px the Sidebar overlays 85% of
 * the Map, so a camera move nobody can see would leave the Map somewhere else by
 * the time the panel is dismissed. It is re-asked on every scroll rather than
 * decided once, so a resize is followed for free.
 *
 * Nothing is computed before the first such scroll, which is what keeps the
 * landing state — every polygon and every Pin — from being destroyed on first
 * paint. That is the property an IntersectionObserver would have to be told to
 * ignore its first callback to keep, since it reports on `observe()`; reading
 * the geometry on a scroll has no first callback to ignore.
 */
function onSidebarScroll(): void {
  if (performance.now() < suppressTourUntil) return
  if (isNarrowViewport()) return
  if (tourFrame !== undefined) return
  tourFrame = requestAnimationFrame(() => {
    tourFrame = undefined
    handlers.onActiveRegionChange(regionAtTop())
  })
}

/**
 * The Region whose section is topmost within the top {@link tourBand} of the
 * Sidebar, or none: above every section (the Summary, or the very top of the
 * list) the whole Map is the answer, and so it is at Elsewhere, which stands for
 * no Region.
 */
function regionAtTop(): string | undefined {
  if (sidebarEl.scrollTop <= 0) return undefined
  const root = sidebarEl.getBoundingClientRect()
  const edge = root.top + root.height * tourBand
  for (const section of listEl.querySelectorAll<HTMLElement>(
    '.region-group[data-region-id]',
  )) {
    const box = section.getBoundingClientRect()
    if (box.bottom > root.top && box.top < edge) return section.dataset.regionId
  }
  return undefined
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
  labelToggle()
  handlers.onToggle(open)
}

export function renderSidebar(state: SidebarState): void {
  pinCount = state.pins.length
  labelToggle()
  suppressTour()
  listEl.replaceChildren()

  // With Regions there is always something to list: a Region with no Pins yet
  // still has its heading.
  if (!state.pins.length && !state.regionGroups?.some(g => g.region)) {
    listEl.append(emptyMessage(state))
    return
  }

  if (!state.regionGroups) {
    appendPinGroups(listEl, state.pins, state)
    return
  }

  for (const group of state.regionGroups) {
    const {region} = group
    const section = document.createElement('section')
    section.className =
      region && region.id === state.activeRegionId
        ? 'region-group active'
        : 'region-group'
    if (region) section.dataset.regionId = region.id

    const heading = document.createElement('h2')
    heading.className = 'region-group-heading'
    heading.tabIndex = 0
    const name = document.createElement('span')
    name.textContent = region?.name ?? elsewhereHeading
    const count = document.createElement('span')
    count.className = 'region-group-count'
    count.textContent = `${group.pins.length}`
    heading.append(
      regionSwatch(
        region
          ? (state.regionColors.get(region.name) ?? uncategorizedColor)
          : uncategorizedColor,
      ),
      name,
      count,
    )
    const regionId = region?.id
    heading.addEventListener('click', () => handlers.onSelectRegion(regionId))
    heading.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return
      ev.preventDefault()
      handlers.onSelectRegion(regionId)
    })
    section.append(heading)

    if (group.pins.length) appendPinGroups(section, group.pins, state)
    else section.append(emptyRegionMessage(state))
    listEl.append(section)
  }
}

/**
 * The Category grouping, into whatever holds it: the list itself where the Map
 * has no Regions, and one Region's section where it has. Called once per Region,
 * `groupPinsByCategory` and `showsHeadings` untouched.
 */
function appendPinGroups(
  into: HTMLElement,
  pins: Pin[],
  state: SidebarState,
): void {
  const groups = groupPinsByCategory(pins, state.order)
  const headings = showsHeadings(groups)
  for (const group of groups) {
    const section = document.createElement('section')
    section.className = 'pin-group'
    if (headings) {
      const heading = document.createElement('h2')
      heading.className = 'pin-group-heading'
      heading.append(
        swatch(
          group.category
            ? (state.categoryColors.get(group.category) ?? uncategorizedColor)
            : uncategorizedColor,
        ),
        group.category ?? uncategorizedHeading,
      )
      section.append(heading)
    }
    for (const pin of group.pins) {
      const capability = state.pinCapabilities.get(pin.id) ?? {
        canEdit: false,
        author: undefined,
      }
      section.append(
        pinCard(
          pin,
          capability,
          state.collaborative,
          pin.id === state.selectedPinId,
          state.categoryColors,
          state.numbers.get(pin.id),
          state.canReorder && group.pins.length > 1,
        ),
      )
    }
    into.append(section)
  }
}

const gripPaths =
  'M8 5.5h.01M12 5.5h.01M8 10h.01M12 10h.01M8 14.5h.01M12 14.5h.01'

/**
 * The grabber in a card's top right corner: drag it to move the card within its
 * group, or press ArrowUp/ArrowDown on it. Pointer events rather than HTML drag
 * and drop, which touch screens do not fire — and a Map Post is mostly read on
 * one. The card is moved in the DOM as the pointer crosses its neighbours, and
 * the new order is reported once, on release, so nothing is written mid-drag.
 */
function dragHandle(card: HTMLElement, title: string): HTMLElement {
  const handle = document.createElement('div')
  handle.className = 'pin-card-grip'
  handle.setAttribute('role', 'button')
  handle.tabIndex = 0
  handle.setAttribute(
    'aria-label',
    `Reorder ${title}: drag, or use the up and down arrow keys`,
  )
  const svg = document.createElementNS(svgNs, 'svg')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('width', '20')
  svg.setAttribute('height', '20')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const dots = document.createElementNS(svgNs, 'path')
  dots.setAttribute('d', gripPaths)
  dots.setAttribute('stroke', 'currentColor')
  dots.setAttribute('stroke-width', '2.5')
  dots.setAttribute('stroke-linecap', 'round')
  svg.append(dots)
  handle.append(svg)

  const cardsOf = (group: HTMLElement): HTMLElement[] => [
    ...group.querySelectorAll<HTMLElement>(':scope > .pin-card'),
  ]
  const idsOf = (group: HTMLElement): string[] =>
    cardsOf(group).map(c => c.dataset.pinId as string)

  handle.addEventListener('click', ev => ev.stopPropagation())

  handle.addEventListener('keydown', ev => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return
    ev.preventDefault()
    ev.stopPropagation()
    const group = card.parentElement as HTMLElement
    const ids = idsOf(group)
    const from = ids.indexOf(card.dataset.pinId as string)
    const to = from + (ev.key === 'ArrowUp' ? -1 : 1)
    if (to < 0 || to >= ids.length) return
    const moved = [...ids]
    moved[from] = ids[to] as string
    moved[to] = ids[from] as string
    handlers.onReorderGroup(moved)
  })

  handle.addEventListener('pointerdown', down => {
    if (down.button !== 0) return
    down.preventDefault()
    down.stopPropagation()
    const group = card.parentElement as HTMLElement
    const before = idsOf(group)
    const box = card.getBoundingClientRect()
    const grabOffset = down.clientY - box.top
    let lastY = down.clientY

    // The card lifts out of the list and follows the pointer; a dashed
    // placeholder of the same height holds its place, and is what moves as the
    // pointer crosses the other cards. Moving the card itself instead would
    // detach the handle mid-drag, and a detached element stops hearing the
    // pointer — so the listeners are on the document, not the handle.
    const placeholder = document.createElement('div')
    placeholder.className = 'pin-card-placeholder'
    placeholder.style.height = `${box.height}px`
    card.before(placeholder)
    card.classList.add('dragging')
    card.style.width = `${box.width}px`
    card.style.left = `${box.left}px`
    const follow = (): void => {
      card.style.top = `${lastY - grabOffset}px`
    }
    follow()

    const others = (): HTMLElement[] =>
      cardsOf(group).filter(other => other !== card)

    const place = (): void => {
      const rest = others()
      const next = rest.find(other => {
        const otherBox = other.getBoundingClientRect()
        return lastY < otherBox.top + otherBox.height / 2
      })
      // Only touch the DOM when the placeholder has actually changed places.
      if (next) {
        if (placeholder.nextElementSibling !== next) next.before(placeholder)
      } else {
        const last = rest[rest.length - 1]
        if (last && last.nextElementSibling !== placeholder)
          last.after(placeholder)
      }
    }

    const move = (ev: PointerEvent): void => {
      lastY = ev.clientY
      follow()
      // The list is longer than its window, so dragging to an edge scrolls it.
      const root = sidebarEl.getBoundingClientRect()
      const edge = 40
      suppressTour()
      if (lastY < root.top + edge) sidebarEl.scrollTop -= 12
      else if (lastY > root.bottom - edge) sidebarEl.scrollTop += 12
      place()
    }
    const end = (): void => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', end)
      document.removeEventListener('pointercancel', end)
      // The order is where the placeholder ended up among the other cards.
      const after: string[] = []
      for (const child of group.children) {
        if (child === placeholder) after.push(card.dataset.pinId as string)
        else if (
          child instanceof HTMLElement &&
          child.classList.contains('pin-card') &&
          child !== card
        ) {
          after.push(child.dataset.pinId as string)
        }
      }
      placeholder.remove()
      card.classList.remove('dragging')
      card.style.width = ''
      card.style.left = ''
      card.style.top = ''
      if (after.some((id, index) => id !== before[index])) {
        handlers.onReorderGroup(after)
      }
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
  })

  return handle
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
  if (!card) return
  suppressTour()
  card.scrollIntoView({behavior: 'smooth', block: 'nearest'})
}

/**
 * Scrolls a Region's section to the top, for a click on its polygon or its
 * label. Like {@link scrollPinIntoView} it is the app scrolling, not the reader,
 * and the tour is told so.
 */
export function scrollRegionIntoView(regionId: string): void {
  const section = listEl.querySelector(
    `[data-region-id="${CSS.escape(regionId)}"]`,
  )
  if (!section) return
  suppressTour()
  section.scrollIntoView({behavior: 'smooth', block: 'start'})
}

/**
 * Repaints which Region is active without rebuilding the list, for the reason
 * {@link setSelectedCard} does not rebuild it: the tour moves on every few
 * hundred pixels of scroll, and a rebuild would throw away the position the
 * reader is scrolling from.
 */
export function setActiveRegionSection(regionId: string | undefined): void {
  for (const section of listEl.querySelectorAll<HTMLElement>('.region-group')) {
    section.classList.toggle(
      'active',
      regionId !== undefined && section.dataset.regionId === regionId,
    )
  }
}

function emptyRegionMessage(state: SidebarState): HTMLElement {
  const message = document.createElement('p')
  message.className = 'region-group-empty'
  message.textContent = state.filtered
    ? 'No pins in this category.'
    : 'No pins in this region yet.'
  return message
}

function emptyMessage(state: SidebarState): HTMLElement {
  const message = document.createElement('p')
  message.id = 'pin-list-empty'
  if (state.filtered) message.textContent = 'No pins in this category.'
  else if (state.canAdd) {
    message.textContent = 'No pins yet — drop a pin to get started.'
  } else message.textContent = 'No pins yet.'
  return message
}

const svgNs = 'http://www.w3.org/2000/svg'

/** A box with an arrow escaping its top-right corner: the "opens elsewhere" mark. */
function externalLinkIcon(): SVGSVGElement {
  const svg = document.createElementNS(svgNs, 'svg')
  svg.setAttribute('class', 'pin-card-link-icon')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  const box = document.createElementNS(svgNs, 'path')
  box.setAttribute(
    'd',
    'M8.5 5.5H5.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3',
  )
  const arrow = document.createElementNS(svgNs, 'path')
  arrow.setAttribute('d', 'M9.5 11.5 16 5M11.5 5H16v4.5')
  for (const path of [box, arrow]) {
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '1.75')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    svg.append(path)
  }
  return svg
}

/**
 * The dot that ties a name in the Sidebar to the markers wearing that colour on
 * the Map. It is what makes the colours mean anything: the Map itself has no
 * legend, so this list is it. Hidden from the accessibility tree because the
 * name it sits beside already says everything it does — and because colour is
 * never the only thing carrying the Category here.
 */
function swatch(color: string): HTMLElement {
  const dot = document.createElement('span')
  dot.className = 'category-swatch'
  dot.style.background = color
  dot.setAttribute('aria-hidden', 'true')
  return dot
}

/**
 * The Region's counterpart to {@link swatch}, and squared off where that is
 * round: a colour identifies within an axis and never across one, and it is the
 * shape that says which axis this is. See ADR-0021.
 */
function regionSwatch(color: string): HTMLElement {
  const square = document.createElement('span')
  square.className = 'region-swatch'
  square.style.background = color
  square.setAttribute('aria-hidden', 'true')
  return square
}

function pinCard(
  pin: Pin,
  capability: PinCapability,
  collaborative: boolean,
  selected: boolean,
  colors: Map<string, string>,
  number: number | undefined,
  reorderable: boolean,
): HTMLElement {
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

  const titleRow = document.createElement('div')
  titleRow.className = 'pin-card-title-row'

  if (number !== undefined) {
    const badge = document.createElement('span')
    badge.className = 'pin-card-number'
    badge.textContent = `${number}`
    badge.setAttribute('aria-label', `Number ${number}`)
    titleRow.append(badge)
  }

  const title = document.createElement('h3')
  title.className = 'pin-card-title'
  title.textContent = pin.title
  titleRow.append(title)

  if (pin.link) {
    const link = document.createElement('a')
    link.className = 'pin-card-link'
    link.href = pin.link
    link.rel = 'noopener noreferrer'
    link.setAttribute('aria-label', 'Open link')
    link.append(externalLinkIcon())
    const url = pin.link
    link.addEventListener('click', ev => {
      ev.preventDefault()
      ev.stopPropagation()
      handlers.onOpenLink(url)
    })
    titleRow.append(link)
  }

  body.append(titleRow)

  // Collaborative Maps only — every Pin on a Solo Map is the Owner's, and a
  // byline on every card would be noise. `capability.author` is already
  // resolved (a legacy Pin's falls back to the Map's Owner), so this module
  // never has to know that fallback exists.
  if (collaborative && capability.author) {
    const author = document.createElement('p')
    author.className = 'pin-card-author'
    author.textContent = `u/${capability.author}`
    body.append(author)
  }

  if (pin.category) {
    const category = document.createElement('span')
    category.className = 'pin-card-category'
    category.append(swatch(pinColor(pin, colors)), pin.category)
    body.append(category)
  }

  if (pin.description) {
    // A div rather than a p: a description is Markdown now, and Markdown
    // produces block content — a <p> may contain neither a <ul> nor another
    // <p>. Nothing is parsed from HTML here, so the browser will not hoist
    // them back out; the element is simply the honest one. See ADR-0020.
    const description = document.createElement('div')
    description.className = 'pin-card-description markdown'
    description.append(
      renderMarkdown(pin.description, {
        onOpenLink: url => handlers.onOpenLink(url),
      }),
    )
    body.append(description)
  }

  card.append(body)

  if (reorderable) {
    card.classList.add('reorderable')
    card.append(dragHandle(card, pin.title))
  }

  if (capability.canEdit) {
    const actions = document.createElement('div')
    actions.className = 'pin-card-actions'
    {
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
    }
    card.append(actions)
  }

  return card
}
