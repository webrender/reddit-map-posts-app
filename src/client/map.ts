import {
  context,
  getWebViewMode,
  navigateTo,
  requestExpandedMode,
  showForm,
  showLoginPrompt,
  type WebViewMode,
} from '@devvit/web/client'
import {
  LngLatBounds,
  MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './theme.css'
import {
  type AddPinReq,
  deletePostForm,
  type LatLng,
  type MapBounds,
  type Pin,
  type UpdatePinReq,
} from '../shared/api.ts'
import {
  canAddPin,
  canEditPin,
  canEditSummary,
  type MapAccess,
} from '../shared/permissions.ts'
import {formatPinsFile, parsePinsFile} from '../shared/pins-file.ts'
import {categoryColors, pinColor} from './category-color.ts'
import {
  fetchAddPin,
  fetchClearDefaultArea,
  fetchDeletePinResult,
  fetchDeletePost,
  fetchGetMap,
  fetchImportPins,
  fetchSetDefaultArea,
  fetchSetSummary,
  fetchUpdatePin,
  fetchUpdatePinResult,
  installProxyProtocol,
  proxyExternalUrl,
} from './fetch.ts'
import {parseMapLink} from './map-link.ts'
import {renderMarkdown} from './markdown.ts'
import {
  filterPins,
  initSidebar,
  isNarrowViewport,
  isSidebarOpen,
  type PinCapability,
  renderSidebar,
  resolveSelection,
  scrollPinIntoView,
  setSelectedCard,
  setSidebarOpen,
} from './sidebar.ts'

const mapStatus = document.getElementById('map-status') as HTMLDivElement
const mapStatusText = document.getElementById(
  'map-status-text',
) as HTMLParagraphElement
const mapStatusHelp = document.getElementById(
  'map-status-help',
) as HTMLButtonElement
const addPinBtn = document.getElementById('add-pin-btn') as HTMLButtonElement
const areaBtn = document.getElementById('area-btn') as HTMLButtonElement
const areaSaveBtn = document.getElementById(
  'area-save-btn',
) as HTMLButtonElement
const areaClearBtn = document.getElementById(
  'area-clear-btn',
) as HTMLButtonElement
const areaCloseBtn = document.getElementById('area-close') as HTMLButtonElement
const toolbarMain = document.getElementById('toolbar-main') as HTMLDivElement
const toolbarArea = document.getElementById('toolbar-area') as HTMLDivElement
const toolbarFilter = document.getElementById(
  'toolbar-filter',
) as HTMLDivElement
const filterBtn = document.getElementById('filter-btn') as HTMLButtonElement
const filterCloseBtn = document.getElementById(
  'filter-close',
) as HTMLButtonElement
const categoryFilterSelect = document.getElementById(
  'category-filter',
) as HTMLSelectElement
const filterSwatch = document.getElementById('filter-swatch') as HTMLElement
const categoryOptionsDatalist = document.getElementById(
  'category-options',
) as HTMLDataListElement
const deletePostBtn = document.getElementById(
  'delete-post-btn',
) as HTMLButtonElement
const openMapBtn = document.getElementById('open-map-btn') as HTMLButtonElement

const pinDialog = document.getElementById('pin-dialog') as HTMLDialogElement
const pinForm = document.getElementById('pin-form') as HTMLFormElement
const pinDialogTitle = document.getElementById(
  'pin-dialog-title',
) as HTMLHeadingElement
const pinTitleInput = document.getElementById('pin-title') as HTMLInputElement
const pinCategoryInput = document.getElementById(
  'pin-category',
) as HTMLInputElement
const pinDescriptionInput = document.getElementById(
  'pin-description',
) as HTMLTextAreaElement
const pinLinkInput = document.getElementById('pin-link') as HTMLInputElement
const pinImageInput = document.getElementById('pin-image') as HTMLInputElement
const pinImagePreview = document.getElementById(
  'pin-image-preview',
) as HTMLImageElement
const pinRemoveImageBtn = document.getElementById(
  'pin-remove-image',
) as HTMLButtonElement
const pinDeleteBtn = document.getElementById('pin-delete') as HTMLButtonElement
const pinCancelBtn = document.getElementById('pin-cancel') as HTMLButtonElement

const linkHelpDialog = document.getElementById(
  'link-help-dialog',
) as HTMLDialogElement
const linkHelpCloseBtn = document.getElementById(
  'link-help-close',
) as HTMLButtonElement

const pinsIoBtn = document.getElementById('pins-io-btn') as HTMLButtonElement
const pinsIoDialog = document.getElementById(
  'pins-io-dialog',
) as HTMLDialogElement
const pinsIoExportText = document.getElementById(
  'pins-io-export-text',
) as HTMLTextAreaElement
const pinsIoImportText = document.getElementById(
  'pins-io-import-text',
) as HTMLTextAreaElement
const pinsIoCopyBtn = document.getElementById(
  'pins-io-copy',
) as HTMLButtonElement
const pinsIoAddBtn = document.getElementById('pins-io-add') as HTMLButtonElement
const pinsIoCloseBtn = document.getElementById(
  'pins-io-close',
) as HTMLButtonElement
const pinsIoNote = document.getElementById(
  'pins-io-note',
) as HTMLParagraphElement

const mapSummary = document.getElementById('map-summary') as HTMLElement
const mapSummaryBody = document.getElementById(
  'map-summary-body',
) as HTMLDivElement
const mapSummaryEditBtn = document.getElementById(
  'map-summary-edit',
) as HTMLButtonElement
const summaryDialog = document.getElementById(
  'summary-dialog',
) as HTMLDialogElement
const summaryForm = document.getElementById('summary-form') as HTMLFormElement
const summaryText = document.getElementById(
  'summary-text',
) as HTMLTextAreaElement
const summaryClearBtn = document.getElementById(
  'summary-clear',
) as HTMLButtonElement
const summaryCancelBtn = document.getElementById(
  'summary-cancel',
) as HTMLButtonElement
const summarySaveBtn = document.getElementById(
  'summary-save',
) as HTMLButtonElement

/** Reddit's OrangeRed, the same accent the Sidebar marks a Selected Pin with. */
const selectedMarkerColor = '#d93a00'

/**
 * The drawing buffer is `pixelRatio²` fragments per CSS pixel, and a phone
 * reporting 3 makes the Map cost nine times what the same view costs at 1. That
 * is paid on every frame of a pan, so the gesture ends up chasing the finger.
 * Capping it trades a little sharpness on the densest screens for a frame rate
 * that keeps up; 2 is still retina, and screens below it are untouched.
 */
const maxPixelRatio = 2

/**
 * Touch gestures MapLibre wires up alongside pinch-zoom and double-tap-zoom,
 * neither of which has an option of its own, and both of which a Map this small
 * fires by accident:
 *
 * - `tapDragZoom` reads a tap followed within 500ms by a one-finger drag
 *   starting within 30px of it as *zoom*. It is registered ahead of the pan and
 *   pinch handlers with no allow-list, so while it is active it blocks both:
 *   the drag zooms by a full level and pans nothing at all, or — if the finger
 *   goes sideways, since the gesture only reads vertical travel — moves nothing
 *   whatsoever. Tapping the Map is a normal thing to do here, which is what
 *   made "drag right after a tap" a gesture the reader hits constantly.
 * - `tapZoom` reads a single two-finger tap as *zoom out one level*. A gentle
 *   pinch, one where each finger travels less than that same 30px tolerance, is
 *   indistinguishable from one — so a small pinch outwards zoomed a whole level
 *   in the wrong direction.
 *
 * Both are reached by name because the options that would reach them are far
 * too blunt: `touchZoomRotate: false` would take pinch-zoom with it (and the
 * `touch-action` claim that depends on it — see ADR-0006), and
 * `doubleClickZoom: false` would take desktop double-click zoom with it.
 */
const disabledGestureHandler = ['tapDragZoom', 'tapZoom'] as const

/**
 * The entrypoint full screen loads. Both readings of a Post are the same page,
 * which asks at load which of the two it is — but that only happens on a real
 * navigation, and Reddit resolves an entrypoint to a URL before deciding
 * whether one is owed: two `devvit.json` entrypoints that name the same file
 * resolve to the exact same URL, which is indistinguishable from asking for
 * the page already loaded, so nothing reloads and the Map stays whichever
 * reading it first opened as. `?mode=expanded` is what actually makes
 * `expanded` a different URL from `default` — the query string is never read,
 * it exists solely so the two entrypoints stop resolving to the same place.
 */
const expandedEntrypoint = 'expanded'

/** Room left around the outermost Pins when the Map frames every one of them. */
const fitPadding = 60

/**
 * The same for a Preview, which is a fraction of the height and has no toolbar
 * or Sidebar to hold the Pins clear of — but does have its own passengers a
 * bare point doesn't: the default Marker rises 41px above the Pin it marks,
 * the permanent Label (see {@link createMarker}) hangs roughly 20px below it
 * and can run up to 8rem wide, and the Open Map button stands over the
 * bottom ~90px of the card no matter what Pin is under it.
 */
const previewFitPadding = {top: 56, bottom: 130, left: 64, right: 64}

/** How long a message that reports something that already happened stays up. */
const flashStatusMs = 4000

/** How close the Map gets when it goes to one Pin rather than framing them all. */
const pinZoom = 15

/**
 * Whether a Map Link can be pasted at all, which needs a keyboard to press ⌘V
 * on and no field to press it into. A touch device has neither, and the links
 * its Maps apps share are the short ones {@link parseMapLink} refuses anyway —
 * so it is never offered a gesture it cannot make. See ADR-0015.
 */
const canPasteMapLink = matchMedia('(hover: hover) and (pointer: fine)').matches

/**
 * What the Map is waiting for while the Pin Drop is armed, said over the Map
 * itself since the button holding the mode is a row away from where the click
 * has to land. It is also the only place the paste is advertised, and is
 * restated after a link that could not be read, since the Map is still waiting.
 */
const dropInstruction = canPasteMapLink
  ? 'Click the map to place the pin, or paste a Google or Apple Maps link.'
  : 'Click the map to place the pin.'

/**
 * How a Pin came to be selected. Selection itself is shared state, but each
 * origin drives a different side effect — that is what keeps a Map click from
 * yanking the Map's zoom, and a Pin Card click from re-scrolling the list the
 * user just clicked in.
 */
type SelectSource = 'card' | 'marker' | 'new' | 'drag'

/**
 * Which of the toolbar's three faces is showing. The two that aren't `main` are
 * modes: they replace the controls rather than sitting beside them, because a
 * control wide enough to be worth reading leaves a narrow toolbar no room for
 * the buttons.
 */
type ToolbarFace = 'main' | 'area' | 'filter'

let map: MapLibreMap
/**
 * Whether this is the Preview — the Post as it is read inline, where the feed
 * owns every gesture and the Map is a still picture of itself. Decided once, at
 * load, because Reddit builds a separate web view for each reading. See
 * ADR-0007.
 */
let isPreview = false
/**
 * Who this reader is and what the Map is, gathered in one place so
 * `canAddPin`/`canEditPin` — the client's only two callers of them, both in
 * `render()` and `wireEvents()` — can never drift from what the server used
 * to decide the same questions. A placeholder until `fetchGetMap` answers;
 * nothing reads it before then. See ADR-0019.
 */
let access: MapAccess = {
  userId: undefined,
  ownerId: '' as MapAccess['ownerId'],
  collaborative: false,
  isModerator: false,
}
/** The Owner's username — the byline a legacy Pin with no `author` of its own falls back to. */
let ownerName = ''
let pins: Pin[] = []
/**
 * The Map's own account of itself, absent where none has been written. Held
 * here rather than read back off the DOM so that what is shown and what would
 * be edited are the same string. See ADR-0020.
 */
let summary: string | undefined
/**
 * Where a Map with nothing to frame opens, set by a moderator for the whole
 * subreddit and absent where none has. See ADR-0014.
 */
let defaultArea: MapBounds | undefined
const markers = new Map<string, Marker>()
/**
 * Which colour each Category on this Map wears, rebuilt whenever the Pins
 * change and never when only the filter or the selection does — a colour
 * belongs to the Category, so narrowing the Map to one must not repaint it.
 */
let categoryColorByName = new Map<string, string>()

let activeCategory = ''
let selectedPinId: string | undefined
let editingPinId: string | undefined
let editingLocation: LatLng | undefined
let pendingImageDataUrl: string | undefined
let removeImage = false
let pendingMarker: Marker | undefined
let droppingPin = false
let toolbarFace: ToolbarFace = 'main'
let statusTimeout: ReturnType<typeof setTimeout> | undefined

/**
 * Whether this reader owns the Post — Delete Map, Import and Export, and
 * (with `isModerator`) whether the Default Area control shows. Derived from
 * `access` rather than stored a second time, so there is exactly one fact
 * this can disagree with itself about.
 */
function ownsMap(): boolean {
  return !!access.userId && access.userId === access.ownerId
}

async function init(): Promise<void> {
  // MapLibre parses tiles in a Web Worker it loads from a separate file. Left to
  // itself it looks for that file next to its own module URL, which after
  // bundling is this script's, so it is built into public/ alongside this one
  // (see build:worker) and pointed at by name here.
  setWorkerUrl(new URL('maplibre-gl-worker.js', import.meta.url).href)
  installProxyProtocol()

  isPreview = readWebViewMode() === 'inline'
  document.body.classList.toggle('preview', isPreview)

  map = new MapLibreMap({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/bright',
    center: [0, 20],
    zoom: 1.5,
    // Style, sprite, glyph, and tile URLs are all external; each one is
    // rewritten here so it is fetched through the server, which is the only
    // place a Reddit app may make external requests from.
    transformRequest: proxyExternalUrl,
    // A Map of Pins is read from directly overhead, so the camera keeps two
    // degrees of freedom — where it looks and how close — and gives up the
    // other three. See ADR-0006: on a phone the abandoned three are what a
    // two-finger gesture kept landing on by accident.
    maxPitch: 0,
    pitchWithRotate: false,
    rollEnabled: false,
    dragRotate: false,
    touchPitch: false,
    // A Preview wires up no handler at all, which is both how it refuses to
    // move and how it lets the feed scroll: with nothing to pan or pinch,
    // MapLibre never claims `touch-action` over its canvas. See ADR-0007.
    interactive: !isPreview,
    pixelRatio: Math.min(window.devicePixelRatio || 1, maxPixelRatio),
  })
  if (!isPreview) wireMapGestures()

  // Fail closed until the round trip says otherwise: no capability class is
  // added yet, which on its own already leaves every control this markup
  // cannot answer for hidden — see the `body:not(...)` rules in map.html.
  deletePostBtn.hidden = true
  areaBtn.hidden = true
  pinsIoBtn.hidden = true

  const data = await fetchGetMap(!isPreview)
  // Nothing to draw and nothing wired up, so the toolbar the page painted
  // before the fetch would be a set of controls that answer to nothing. It
  // keeps the read-only face it started with, and says why it is empty.
  if (!data) {
    setStatus('This map could not be loaded. Try again in a moment.')
    return
  }

  access = {
    userId: context.userId,
    ownerId: data.ownerId,
    collaborative: data.collaborative,
    isModerator: data.isModerator,
  }
  ownerName = data.ownerName
  pins = data.pins
  summary = data.summary
  defaultArea = data.defaultArea
  document.body.classList.toggle('collaborative', access.collaborative)
  document.body.classList.toggle('can-add-pin', canAddPin(access))
  document.body.classList.toggle('owns-map', ownsMap())
  document.body.classList.toggle('can-edit-summary', canEditSummary(access))
  // The Preview has no toolbar to hold either of them.
  deletePostBtn.hidden = isPreview || !ownsMap()
  pinsIoBtn.hidden = isPreview || !ownsMap()
  // Unlike every other control in the toolbar this one answers to moderating
  // the subreddit rather than to owning the Map, and the two have nothing to do
  // with each other: a moderator sets where every Map opens from whichever Map
  // Post they happen to be reading, including someone else's.
  areaBtn.hidden = isPreview || !access.isModerator

  // A Preview is the markers and nothing else: no Pin Cards to build, no
  // toolbar to fill in, and one button that leaves for the reading that has all
  // three.
  if (isPreview) {
    categoryColorByName = categoryColors(pins)
    renderMarkers(pins)
    fitToPins()
    wireOpenMap()
    return
  }

  initSidebar({
    onSelectCard: pinId => togglePin(pinId, 'card'),
    onEditPin: pinId => {
      const pin = pins.find(candidate => candidate.id === pinId)
      if (pin) openEditDialog(pin)
    },
    onOpenLink: url => navigateTo(url),
    onToggle: () => map.resize(),
  })

  renderCategoryOptions()
  renderSummary()
  render()
  // Open where there is room for a column and something to list; a narrow
  // viewport or an empty Map both start collapsed.
  setSidebarOpen(!isNarrowViewport() && pins.length > 0)
  fitToPins()
  wireEvents()
}

/** Everything the Map answers a gesture with, and so nothing a Preview does. */
function wireMapGestures(): void {
  // Pinch keeps zooming but stops rotating. Note this leaves the handler
  // enabled: MapLibre only claims the browser's touch gestures — the
  // `touch-action: none` that stops the host scrolling instead of panning —
  // while both pinch-zoom and drag-pan are on, so turning pinch off wholesale
  // would hand pinch back to the browser.
  map.touchZoomRotate.disableRotation()
  for (const name of disabledGestureHandler) {
    map._handlers._handlersById[name]?.disable()
  }
  // The Sidebar takes the left edge, so the zoom controls keep the right. With
  // nothing left to rotate, the compass would only ever point north.
  map.addControl(new NavigationControl({showCompass: false}))
  map.on('click', ev => {
    if (droppingPin) {
      stopDroppingPin()
      openNewPinDialog({lat: ev.lngLat.lat, lng: ev.lngLat.lng})
      return
    }
    // Light-dismiss: where the Sidebar overlays the Map, the exposed strip of
    // Map is the quickest way to get the rest of it back.
    if (isNarrowViewport() && isSidebarOpen()) setSidebarOpen(false)
  })
}

function render(): void {
  // From every Pin, not the visible ones: see {@link categoryColorByName}.
  categoryColorByName = categoryColors(pins)
  const visible = filterPins(pins, activeCategory)
  const previouslySelected = selectedPinId
  selectedPinId = resolveSelection(selectedPinId, visible)
  renderMarkers(visible)
  renderSidebar({
    pins: visible,
    selectedPinId,
    collaborative: access.collaborative,
    canAdd: canAddPin(access),
    filtered: !!activeCategory,
    categoryColors: categoryColorByName,
    // The one place `canEditPin` runs on the client: `sidebar.ts` stays pure
    // display, taking the answer rather than the ingredients that produce it.
    pinCapabilities: new Map(visible.map(pin => [pin.id, pinCapability(pin)])),
  })
  showFilterSwatch()
  // Losing the Selected Pin to a filter or a deletion lands in the same place
  // as letting go of it deliberately: the whole Map.
  if (previouslySelected && !selectedPinId) fitToPins(true)
}

/**
 * Paints the Summary at the top of the Sidebar, and decides whether the block
 * is there at all: a reader who cannot write one and is looking at a Map that
 * has none gets no empty box, while whoever may write one is always offered the
 * control. A Preview never reaches this — `init` returns before the Sidebar
 * exists — which is how ADR-0007 stays true without a check of its own.
 */
function renderSummary(): void {
  const canEdit = canEditSummary(access)
  mapSummary.hidden = !summary && !canEdit
  mapSummaryEditBtn.hidden = !canEdit
  mapSummaryEditBtn.textContent = summary ? 'Edit summary' : 'Add a summary'
  mapSummaryBody.replaceChildren()
  if (summary) {
    mapSummaryBody.append(
      renderMarkdown(summary, {onOpenLink: url => navigateTo(url)}),
    )
  }
}

/**
 * Opens the Summary for editing, showing what is stored rather than what is on
 * screen — the two are the same string, and the rendered one has lost its
 * markup. An armed drop is disarmed on the way in for the reason Import and
 * Export disarm one: the document-level paste listener would otherwise take a
 * paste meant for this field.
 */
function openSummaryDialog(): void {
  stopDroppingPin()
  summaryText.value = summary ?? ''
  summaryClearBtn.hidden = !summary
  summaryDialog.showModal()
  summaryText.focus()
}

/**
 * Writes it, and paints what actually landed rather than what was typed — the
 * server trims and may refuse, and the response carries the stored value or
 * nothing at all where it was cleared.
 */
async function saveSummary(): Promise<void> {
  summarySaveBtn.disabled = true
  const rsp = await fetchSetSummary({summary: summaryText.value})
  summarySaveBtn.disabled = false
  if (!rsp) {
    flashStatus('Could not save the summary.')
    return
  }
  summary = rsp.summary
  renderSummary()
  summaryDialog.close()
}

/**
 * What one Pin's card may offer. `author` falls back to the Map's Owner for a
 * Pin stored before Contributors existed — the same fallback `pinAuthorId`
 * uses server-side, spelled out again here because the Sidebar wants a name
 * to print rather than a `T2` to compare.
 */
function pinCapability(pin: Pin): PinCapability {
  return {
    canEdit: canEditPin(access, pin),
    author: pin.author ?? (access.collaborative ? ownerName : undefined),
  }
}

/**
 * Frames every Pin currently shown, which is what the Map loads with and what
 * it returns to whenever nothing is selected. With nothing to frame it falls
 * back to the subreddit's Default Area, and with no area to the whole world the
 * Map was constructed on.
 */
function fitToPins(animate: boolean = false): void {
  const visible = filterPins(pins, activeCategory)
  const bounds = visible.length ? pinBounds(visible) : areaBounds(defaultArea)
  if (!bounds) return
  map.fitBounds(bounds, {
    padding: isPreview ? previewFitPadding : fitPadding,
    maxZoom: 14,
    duration: animate ? 600 : 0,
  })
}

function pinBounds(visible: readonly Pin[]): LngLatBounds {
  const bounds = new LngLatBounds()
  for (const pin of visible) bounds.extend([pin.location.lng, pin.location.lat])
  return bounds
}

/**
 * The Default Area as MapLibre wants it. An area that crosses the antimeridian
 * is stored with its west edge numerically east of its east edge, which is how
 * {@link viewBounds} spells one; MapLibre reads that as a rectangle the other
 * way round, so the east edge is carried past 180 instead — without which a Map
 * of Fiji would open on every longitude except its own.
 */
function areaBounds(area: MapBounds | undefined): LngLatBounds | undefined {
  if (!area) return
  const {west, south, east, north} = area
  return new LngLatBounds(
    [west, south],
    [east < west ? east + 360 : east, north],
  )
}

function renderMarkers(visible: Pin[]): void {
  for (const marker of markers.values()) marker.remove()
  markers.clear()
  for (const pin of visible) markers.set(pin.id, createMarker(pin))
}

function createMarker(pin: Pin): Marker {
  const selected = pin.id === selectedPinId
  // Only the Selected Pin can be moved, so an off-target tap on any other
  // marker can never drag a Pin somewhere by accident.
  const draggable = selected && canEditPin(access, pin)
  const marker = new Marker({
    color: selected ? selectedMarkerColor : pinColor(pin, categoryColorByName),
    draggable,
  })
    .setLngLat([pin.location.lng, pin.location.lat])
    .addTo(map)

  const element = marker.getElement()
  // The Title travels with the marker: a Map of unlabelled markers says where
  // the Pins are but not which is which, and in a Preview the Sidebar that
  // would otherwise say more isn't there to ask.
  const label = document.createElement('span')
  label.className = selected ? 'pin-label selected' : 'pin-label'
  label.textContent = pin.title
  element.appendChild(label)

  // A Preview's markers have nothing to click and nothing to drag.
  if (isPreview) return marker

  // Only what can actually be grabbed says so; everything else stays a click.
  element.style.cursor = draggable ? 'move' : 'pointer'
  // Markers crowd together at the zoom a Pin Card flies to; the selected one
  // has to stay on top of its neighbours to be worth highlighting.
  if (selected) element.style.zIndex = '1'

  let dragged = false
  marker.on('dragstart', () => {
    dragged = true
  })
  marker.on('dragend', () => {
    void movePin(pin.id, marker)
    // Releasing a drag also fires a click; let that one land first.
    setTimeout(() => {
      dragged = false
    }, 0)
  })
  element.addEventListener('click', ev => {
    ev.stopPropagation()
    if (dragged) return
    togglePin(pin.id, 'marker')
  })

  return marker
}

function refreshMarker(pinId: string): void {
  const existing = markers.get(pinId)
  if (!existing) return
  existing.remove()
  const pin = pins.find(candidate => candidate.id === pinId)
  if (pin) markers.set(pinId, createMarker(pin))
  else markers.delete(pinId)
}

function selectPin(pinId: string | undefined, source: SelectSource): void {
  const previousId = selectedPinId
  selectedPinId = pinId
  // Only the two markers whose appearance changed are rebuilt; the rest of the
  // Map is left alone.
  if (previousId && previousId !== pinId) refreshMarker(previousId)
  if (pinId) refreshMarker(pinId)
  setSelectedCard(pinId)

  if (!pinId) {
    if (previousId) fitToPins(true)
    return
  }

  const pin = pins.find(candidate => candidate.id === pinId)
  if (!pin) return
  switch (source) {
    case 'card':
      map.flyTo({center: [pin.location.lng, pin.location.lat], zoom: pinZoom})
      break
    case 'marker':
    case 'new':
      setSidebarOpen(true)
      scrollPinIntoView(pin.id)
      break
    case 'drag':
      break
  }
}

/**
 * Selecting the Selected Pin again lets go of it, from either the Pin Card or
 * the marker, so there is always a way back out to the whole Map.
 */
function togglePin(pinId: string, source: SelectSource): void {
  selectPin(pinId === selectedPinId ? undefined : pinId, source)
}

/**
 * Writes a dragged Pin's new location straight away, putting the marker back
 * where it came from if the write fails.
 */
async function movePin(pinId: string, marker: Marker): Promise<void> {
  const pin = pins.find(candidate => candidate.id === pinId)
  if (!pin) return

  const previousLocation = pin.location
  const lngLat = marker.getLngLat()
  pin.location = {lat: lngLat.lat, lng: lngLat.lng}

  const rsp = await fetchUpdatePin({id: pinId, location: pin.location})
  if (rsp) {
    pin.location = rsp.pin.location
    return
  }
  pin.location = previousLocation
  marker.setLngLat([previousLocation.lng, previousLocation.lat])
  flashStatus('Could not move pin.')
}

function renderCategoryOptions(): void {
  const categories = [
    ...new Set(pins.map(pin => pin.category).filter((c): c is string => !!c)),
  ].sort()

  const previousFilter = categoryFilterSelect.value
  categoryFilterSelect.innerHTML = '<option value="">All categories</option>'
  categoryOptionsDatalist.innerHTML = ''
  for (const category of categories) {
    const filterOption = document.createElement('option')
    filterOption.value = category
    filterOption.textContent = category
    categoryFilterSelect.appendChild(filterOption)

    const datalistOption = document.createElement('option')
    datalistOption.value = category
    categoryOptionsDatalist.appendChild(datalistOption)
  }
  categoryFilterSelect.value = categories.includes(previousFilter)
    ? previousFilter
    : ''
  activeCategory = categoryFilterSelect.value
  filterBtn.hidden = categories.length === 0
  filterBtn.classList.toggle('filtering', !!activeCategory)
  // Nothing left to filter by: the open face would be a lone "All categories"
  // over a toolbar the reader can no longer reach. Only the filter face is
  // dismissed — this runs after every save, and a moderator part-way through
  // framing a Default Area is not doing the thing that emptied it.
  if (filterBtn.hidden && toolbarFace === 'filter') setToolbarFace('main')
}

/**
 * Puts the active Category's own colour beside the filter, and takes it away
 * with the filter. Called from {@link render} rather than from wherever the
 * filter changed, so it always reads a {@link categoryColorByName} built from
 * the Pins now on the Map and can never disagree with the markers it describes.
 */
function showFilterSwatch(): void {
  const color = activeCategory
    ? categoryColorByName.get(activeCategory)
    : undefined
  filterSwatch.hidden = !color
  if (color) filterSwatch.style.background = color
}

/**
 * Shows one of the toolbar's faces in place of whichever is showing now. Only
 * ever one of them is in the flow, so the toolbar keeps its one-row height.
 */
function setToolbarFace(face: ToolbarFace): void {
  const previous = toolbarFace
  if (face === previous) return
  toolbarFace = face
  toolbarMain.hidden = face !== 'main'
  toolbarArea.hidden = face !== 'area'
  toolbarFilter.hidden = face !== 'filter'

  // Both modes take the Map over in their own way, and neither survives the
  // other: an armed drop belongs to the main face's Add a Pin, and the
  // instruction the area face wrote over the Map goes with the face.
  if (face !== 'main') stopDroppingPin()
  if (previous === 'area') setStatus('')
  if (face === 'area') enterAreaFace()

  // Focus follows the swap, so the keyboard lands on whatever replaced the
  // control it was on rather than falling back to the top of the document.
  if (face === 'area') areaSaveBtn.focus()
  else if (face === 'filter') categoryFilterSelect.focus()
  else if (previous === 'area' && !areaBtn.hidden) areaBtn.focus()
  else if (previous === 'filter' && !filterBtn.hidden) filterBtn.focus()
}

/**
 * Takes a Map Link pasted onto an armed drop as the Location the click on the
 * Map would have given, and the Title the Owner would have typed. The Map is
 * moved to it first: the Pin is somewhere the Map is almost certainly not
 * looking, and it arrives rather than flies because the dialog covering it
 * opens in the same breath, leaving an animation to play to nobody.
 *
 * A link that cannot be read leaves the drop armed and says why, since the
 * Owner is mid-gesture and clicking the Map is still open to them.
 */
function dropPastedLink(text: string): void {
  // A paste is the gesture the help panel describes, so arriving here is the
  // end of needing to read it — and whatever this says next is said over the
  // Map, behind a modal that would hide it.
  closeLinkHelp()

  const link = parseMapLink(text)
  if (link.kind === 'shortened') {
    flashStatus(
      'A short map link carries no location. Open it, then paste the link it lands on.',
      dropInstruction,
    )
    return
  }
  if (link.kind === 'unreadable') {
    flashStatus('No location in that link.', dropInstruction)
    return
  }

  stopDroppingPin()
  map.jumpTo({
    center: [link.location.lng, link.location.lat],
    zoom: Math.max(map.getZoom(), pinZoom),
  })
  openNewPinDialog(link.location, link.title)
}

/**
 * Opening the face shows what is already set rather than saying it: the Map
 * jumps to the stored Default Area, so a moderator adjusts a framing they can
 * see instead of a place name they have to trust. With none stored there is
 * nowhere to jump to and the view they arrived with is the starting point.
 *
 * Framed without the padding {@link fitToPins} gives it, so that what fills the
 * screen is exactly what is stored — which is what the instruction below
 * promises, and what keeps opening the face and saving again from quietly
 * widening the area by the padding every time. An empty Map still opens on the
 * padded version, the same breathing room a Map full of Pins gets.
 *
 * It arrives rather than flies. An animated framing is a camera that is still
 * moving while the button that reads it off is already focused, so a moderator
 * who opens the face and takes the framing offered would store somewhere
 * between where they were and where they were being shown.
 */
function enterAreaFace(): void {
  areaClearBtn.hidden = !defaultArea
  const bounds = areaBounds(defaultArea)
  if (bounds) map.fitBounds(bounds, {padding: 0, duration: 0})
  setStatus('Pan and zoom to the area new maps should open on.')
}

/**
 * What the Map is looking at, as the rectangle the Default Area is stored as.
 *
 * MapLibre reports a view that has been panned across the antimeridian in
 * longitudes that have run past ±180 — 182° rather than -178° — and it reports
 * a whole-world view as a range wider than 360°. Neither is a rectangle this
 * app can store, so each is spelled the way {@link areaBounds} reads one back:
 * a range that covers everything becomes the whole world outright, and anything
 * narrower is wrapped, which is what leaves a Map of Fiji with a west edge
 * numerically east of its east edge.
 */
function viewBounds(): MapBounds {
  const bounds = map.getBounds()
  const south = Math.max(bounds.getSouth(), -90)
  const north = Math.min(bounds.getNorth(), 90)
  const west = bounds.getWest()
  const east = bounds.getEast()
  if (east - west >= 360) return {west: -180, south, east: 180, north}
  return {west: wrapLng(west), south, east: wrapLng(east), north}
}

/** A longitude brought back into [-180, 180). 180° itself becomes -180°. */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180
}

/** Makes the framing on screen the area every empty Map on the subreddit opens on. */
async function saveDefaultArea(): Promise<void> {
  const bounds = viewBounds()
  areaSaveBtn.disabled = true
  const rsp = await fetchSetDefaultArea({bounds})
  areaSaveBtn.disabled = false
  if (!rsp) {
    flashStatus('Could not save the default map area.')
    return
  }
  defaultArea = bounds
  setToolbarFace('main')
  flashStatus('New maps with no pins will open on this view.')
}

/**
 * Puts empty Maps back on the whole world. It asks nothing first, unlike Delete
 * Map: framing the Map again is all it takes to undo, so a modal here would be
 * a deliberate step in front of a reversible one.
 */
async function clearDefaultArea(): Promise<void> {
  areaClearBtn.disabled = true
  const rsp = await fetchClearDefaultArea()
  areaClearBtn.disabled = false
  if (!rsp) {
    flashStatus('Could not clear the default map area.')
    return
  }
  defaultArea = undefined
  setToolbarFace('main')
  flashStatus('New maps with no pins will open on the whole world.')
}

/** Puts a message over the Map until something replaces or clears it. */
function setStatus(text: string): void {
  if (statusTimeout) clearTimeout(statusTimeout)
  statusTimeout = undefined
  writeStatus(text)
}

/**
 * Writes what the status line says and decides what it carries beside the
 * words. The pill hides itself when there is nothing to say — it can no longer
 * do that with `:empty`, since the help button lives inside it.
 *
 * The help button appears only alongside {@link dropInstruction}, and only
 * where that instruction mentions pasting at all: it explains the one gesture
 * the Map cannot demonstrate, and a device that was never offered the paste has
 * nothing to be told. See ADR-0015.
 */
function writeStatus(text: string): void {
  mapStatusText.textContent = text
  mapStatus.hidden = !text
  mapStatusHelp.hidden = !canPasteMapLink || text !== dropInstruction
}

/**
 * Reports something that has already finished happening, which nothing later
 * will clear — so it clears itself. Where the Map was in the middle of saying
 * something standing, `thenShow` is what it goes back to saying; a mode that
 * ends before the timer does clears it through {@link setStatus}, so the
 * standing message cannot outlive the mode it belongs to.
 */
function flashStatus(text: string, thenShow: string = ''): void {
  setStatus(text)
  statusTimeout = setTimeout(() => {
    writeStatus(thenShow)
    statusTimeout = undefined
  }, flashStatusMs)
}

function openEditDialog(pin: Pin): void {
  editingPinId = pin.id
  pendingImageDataUrl = undefined
  removeImage = false

  pinDialogTitle.textContent = 'Edit Pin'
  pinTitleInput.value = pin.title
  pinCategoryInput.value = pin.category ?? ''
  pinDescriptionInput.value = pin.description ?? ''
  pinLinkInput.value = pin.link ?? ''
  pinImageInput.value = ''
  pinImagePreview.hidden = !pin.imageUrl
  if (pin.imageUrl) pinImagePreview.src = pin.imageUrl
  pinRemoveImageBtn.hidden = !pin.imageUrl
  pinDeleteBtn.hidden = false

  pinDialog.showModal()
}

function openNewPinDialog(location: LatLng, title?: string): void {
  editingPinId = undefined
  editingLocation = location
  pendingImageDataUrl = undefined
  removeImage = false

  pinDialogTitle.textContent = 'New Pin'
  pinForm.reset()
  // A Map Link arrives already knowing what the place is called; a click on the
  // Map does not. Either way the Title is the Owner's, and this one is offered
  // in the field they were going to type it in rather than saved behind their
  // back.
  if (title) pinTitleInput.value = title
  pinImagePreview.hidden = true
  pinRemoveImageBtn.hidden = true
  pinDeleteBtn.hidden = true

  // A dropped Pin isn't a Pin until it is saved, so it has a marker but no Pin
  // Card until then.
  pendingMarker = new Marker({color: '#888'})
    .setLngLat([location.lng, location.lat])
    .addTo(map)

  pinDialog.showModal()
  pinTitleInput.focus()
}

function closePinDialog(): void {
  pendingMarker?.remove()
  pendingMarker = undefined
  editingPinId = undefined
  editingLocation = undefined
  pendingImageDataUrl = undefined
  removeImage = false
  pinForm.reset()
  // Reached both ways round: as the reason the dialog is closing, and as the
  // `close` event it fires on the way. Closing a closed dialog does nothing,
  // which is what makes the second pass harmless.
  if (pinDialog.open) pinDialog.close()
}

async function savePin(): Promise<void> {
  const title = pinTitleInput.value.trim()
  if (!title) return
  const category = pinCategoryInput.value.trim()
  const description = pinDescriptionInput.value.trim()
  const link = pinLinkInput.value.trim()

  if (editingPinId) {
    // No location: a Pin is moved by dragging its marker, never by this form.
    const req: UpdatePinReq = {
      id: editingPinId,
      title,
      category,
      description,
      link,
    }
    if (pendingImageDataUrl) req.imageDataUrl = pendingImageDataUrl
    else if (removeImage) req.removeImage = true

    const result = await fetchUpdatePinResult(req)
    if (!result.ok) {
      reconcileAfterPinAccessFailure(result.status)
      return
    }
    const rsp = result.value
    const index = pins.findIndex(pin => pin.id === editingPinId)
    if (index !== -1) pins[index] = rsp.pin

    const savedId = rsp.pin.id
    renderCategoryOptions()
    render()
    closePinDialog()
    // A changed Category moves the Pin Card to another group; follow it there
    // rather than leaving the reader looking at the gap it left.
    scrollPinIntoView(savedId)
    return
  }

  if (!editingLocation) return
  const req: AddPinReq = {location: editingLocation, title}
  if (category) req.category = category
  if (description) req.description = description
  if (link) req.link = link
  if (pendingImageDataUrl) req.imageDataUrl = pendingImageDataUrl

  const rsp = await fetchAddPin(req)
  if (!rsp) {
    // Unlike the update and delete paths, there is nothing stale here to
    // reconcile — this Pin never existed for anyone else to have touched —
    // so a status code has nothing more to say than a plain failure does.
    flashStatus('Could not add pin. Try again.')
    return
  }
  pins.push(rsp.pin)

  const addedId = rsp.pin.id
  renderCategoryOptions()
  render()
  closePinDialog()
  selectPin(addedId, 'new')
}

/**
 * What a racing edit on a Collaborative Map looks like, now that two people
 * editing the same Pin at once is routine rather than unreachable.
 * `fetchJson`'s own reasoning for collapsing every failure into `undefined`
 * — "none of them can do anything with the reason" — stops being true here:
 * a **404** is the one signal that tells this deliberately-stale client it is
 * actually stale, because the Pin was deleted by its author or a Moderator
 * while this reader still had the card open, and a **403** means a
 * permission answer changed underneath them mid-edit (the Pin's author, or
 * this reader's own moderator standing). Both leave the dialog exactly as
 * wrong to keep open as an ordinary failure does, but only these two have
 * something more specific to say about why.
 */
function reconcileAfterPinAccessFailure(status: number): void {
  if (status === 404) {
    pins = pins.filter(pin => pin.id !== editingPinId)
    renderCategoryOptions()
    render()
    closePinDialog()
    flashStatus('That pin has been deleted.')
    return
  }
  if (status === 403) {
    closePinDialog()
    flashStatus('You can no longer edit this pin.')
    return
  }
  flashStatus('Could not save. Try again.')
}

async function deleteEditingPin(): Promise<void> {
  if (!editingPinId) return
  const result = await fetchDeletePinResult({id: editingPinId})
  if (!result.ok) {
    reconcileAfterPinAccessFailure(result.status)
    return
  }
  pins = pins.filter(pin => pin.id !== editingPinId)
  renderCategoryOptions()
  // A deleted Pin can't stay selected; render() drops it.
  render()
  closePinDialog()
}

/**
 * Arms the Pin Drop: the next click on the Map is a Location rather than a
 * selection, and — where there is a keyboard for it — a Map Link pasted with
 * nothing focused is the same answer given a different way.
 */
function startDroppingPin(): void {
  droppingPin = true
  addPinBtn.setAttribute('aria-pressed', 'true')
  document.getElementById('map')?.style.setProperty('cursor', 'crosshair')
  setStatus(dropInstruction)
}

function stopDroppingPin(): void {
  if (!droppingPin) return
  droppingPin = false
  addPinBtn.setAttribute('aria-pressed', 'false')
  document.getElementById('map')?.style.removeProperty('cursor')
  closeLinkHelp()
  setStatus('')
}

/**
 * How the paste is done, which the instruction over the Map has room to name
 * but not to explain. It opens over the armed drop rather than replacing it:
 * the Owner reads it and pastes, and the drop they armed is still waiting.
 */
function closeLinkHelp(): void {
  if (linkHelpDialog.open) linkHelpDialog.close()
}

/**
 * Opens Import and Export, which are one dialog because they are one idea from
 * either end: the text Export writes is the text Import reads.
 *
 * On a Solo Map, Export needs no round trip: the Map already holds every Pin
 * it is showing — that is what the Sidebar is drawn from — so the text is
 * written from the same array, current by construction. That stops being true
 * on a Collaborative Map, where another Contributor can have added a Pin
 * since this page loaded and this app otherwise never refetches — the one
 * place the no-refetch rule (ADR-0019) would hand back a wrong *document*
 * rather than a merely stale *view*. So this refetches once, on this explicit
 * gesture, before formatting — Owner-only in practice, since Export already
 * is.
 *
 * An armed drop is disarmed on the way in. The document-level paste listener is
 * live while one is armed and would take a paste meant for the Import field,
 * feeding an Export to `parseMapLink` and refusing it as an unreadable Map Link.
 */
async function openPinsIo(): Promise<void> {
  stopDroppingPin()
  if (access.collaborative) {
    // No `full` reading: this only needs the Pins, not a second moderator
    // round trip.
    const data = await fetchGetMap(false)
    if (data) {
      pins = data.pins
      renderCategoryOptions()
      render()
    }
  }
  pinsIoExportText.value = formatPinsFile(pins)
  pinsIoImportText.value = ''
  setPinsIoNote('')
  pinsIoDialog.showModal()
}

/**
 * Copies the Export. A web view is a sandboxed frame and may refuse both ways
 * of writing to the clipboard, so this says which of the two happened rather
 * than reporting a success it did not have — and either way the field is
 * selectable and left selected, so the Owner can always finish the copy
 * themselves.
 */
async function copyExport(): Promise<void> {
  pinsIoExportText.focus()
  pinsIoExportText.select()
  try {
    await navigator.clipboard.writeText(pinsIoExportText.value)
    setPinsIoNote(`Copied ${countLabel(pins.length)}.`)
    return
  } catch {
    // Falls through to the older gesture, which some sandboxes still allow.
  }
  if (document.execCommand('copy')) {
    setPinsIoNote(`Copied ${countLabel(pins.length)}.`)
    return
  }
  setPinsIoNote(
    'Could not copy for you — the text is selected, so press ⌘C or Ctrl+C.',
    true,
  )
}

/**
 * Adds the pasted Export's Pins to this Map. The text is read here first, with
 * the same reader the server uses, so an Owner who has mistyped something is
 * told which entry and where without waiting on a round trip.
 *
 * The server reads it again and is the authority. It failing after this
 * succeeded means the two disagreed rather than that the text was bad, which is
 * not something the Owner can act on — so that case says so plainly instead of
 * inventing a reason, and leaves the text where it is either way.
 */
async function importPins(): Promise<void> {
  const read = parsePinsFile(pinsIoImportText.value)
  if ('error' in read) {
    setPinsIoNote(read.error, true)
    return
  }

  pinsIoAddBtn.disabled = true
  setPinsIoNote(`Adding ${countLabel(read.pins.length)}…`)
  const rsp = await fetchImportPins({pins: read.pins})
  pinsIoAddBtn.disabled = false
  if (!rsp) {
    setPinsIoNote('Those pins could not be added. Try again in a moment.', true)
    return
  }

  pins = [...pins, ...rsp.pins]
  renderCategoryOptions()
  // Nothing selected is what frames the whole Map, which is the only view that
  // shows an Owner what they just added alongside what was already there.
  selectedPinId = undefined
  render()
  setSidebarOpen(!isNarrowViewport() && pins.length > 0)
  fitToPins(true)
  pinsIoDialog.close()
  flashStatus(addedLabel(rsp.pins.length, rsp.droppedImages))
}

/** What the Map says once an Import has landed and the dialog has gone. */
function addedLabel(added: number, droppedImages: number): string {
  const pinsAdded = `Added ${countLabel(added)}.`
  if (!droppedImages) return pinsAdded
  const images =
    droppedImages === 1 ? 'One image was' : `${droppedImages} images were`
  return `${pinsAdded} ${images} left out — only images uploaded here can be carried over.`
}

function countLabel(count: number): string {
  return count === 1 ? '1 pin' : `${count} pins`
}

/** What the dialog has to say about the last thing tried in it. */
function setPinsIoNote(text: string, isError: boolean = false): void {
  pinsIoNote.textContent = text
  pinsIoNote.classList.toggle('error', isError && !!text)
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * The web view's presentation mode, or nothing where the host doesn't answer
 * for one. `devvit` is a global Reddit injects into the web view, so asking
 * throws anywhere else — a plain browser, the local test harness — and there
 * the full screen control is simply never offered.
 */
function readWebViewMode(): WebViewMode | undefined {
  try {
    return getWebViewMode()
  } catch {
    return
  }
}

/**
 * Runs one of the two mode changes. Both want the trusted click that triggered
 * them, and both throw if the web view is already in the mode being asked for.
 */
function changeWebViewMode(change: () => void): void {
  try {
    change()
  } catch (err) {
    console.error(
      `web view mode change failed; ${err instanceof Error ? err.message : err}`,
    )
  }
}

/**
 * The Preview's one control, and the only way into the reading that has the
 * rest of the interface.
 */
function wireOpenMap(): void {
  openMapBtn.addEventListener('click', ev =>
    changeWebViewMode(() => requestExpandedMode(ev, expandedEntrypoint)),
  )
}

/**
 * The one action in the app that cannot be undone, so it asks first — through
 * Reddit's own modal, whose Delete button is the confirmation.
 *
 * There is nowhere to return to afterwards: the Post this page is running
 * inside has just been deleted, so it leaves for the subreddit rather than
 * re-rendering a Map that no longer exists.
 */
function wireDeletePost(): void {
  deletePostBtn.addEventListener('click', () => void confirmDeletePost())
}

async function confirmDeletePost(): Promise<void> {
  const form = await showForm(deletePostForm(access.collaborative))
  if (form.action !== 'SUBMITTED') return

  deletePostBtn.disabled = true
  const rsp = await fetchDeletePost()
  if (!rsp) {
    deletePostBtn.disabled = false
    flashStatus('The map could not be deleted.')
    return
  }
  navigateTo(`https://www.reddit.com/r/${context.subredditName}`)
}

function wireEvents(): void {
  wireDeletePost()

  // Wired above the Pin gates below, which it does not answer to: writing a
  // Summary is the Owner's or a Moderator's, and neither of those is what
  // `canReachPinControls` or `ownsMap()` is asking about. See ADR-0020.
  if (canEditSummary(access)) {
    mapSummaryEditBtn.addEventListener('click', () => openSummaryDialog())
    summaryForm.addEventListener('submit', ev => {
      ev.preventDefault()
      void saveSummary()
    })
    summaryCancelBtn.addEventListener('click', () => summaryDialog.close())
    // Clearing goes through the same save, so there is one path that writes a
    // Summary and one that paints the answer.
    summaryClearBtn.addEventListener('click', () => {
      summaryText.value = ''
      void saveSummary()
    })
  }

  filterBtn.addEventListener('click', () => setToolbarFace('filter'))
  filterCloseBtn.addEventListener('click', () => setToolbarFace('main'))
  toolbarFilter.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') setToolbarFace('main')
  })

  categoryFilterSelect.addEventListener('change', () => {
    activeCategory = categoryFilterSelect.value
    filterBtn.classList.toggle('filtering', !!activeCategory)
    // A Selected Pin the filter excludes stops being selected; render() sorts
    // that out for both views at once.
    render()
  })

  // Moderating the subreddit and owning the Map are unrelated, so this is wired
  // above the Owner check rather than inside it: a moderator reading someone
  // else's Map still sets where every Map opens.
  areaBtn.addEventListener('click', () => setToolbarFace('area'))
  areaCloseBtn.addEventListener('click', () => setToolbarFace('main'))
  areaSaveBtn.addEventListener('click', () => void saveDefaultArea())
  areaClearBtn.addEventListener('click', () => void clearDefaultArea())
  toolbarArea.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') setToolbarFace('main')
  })

  // Reaches Pin Drop and the New/Edit Pin dialog: anyone who might need them.
  // `access.collaborative` stands on its own rather than folding into
  // `canAddPin(access)` — `canAddPin` is false for a logged-out reader, who
  // still needs Add a Pin wired so clicking it can prompt login (below)
  // rather than doing nothing. `access.isModerator` covers a Moderator's own
  // use of the dialog; on a Solo Map that isn't theirs nothing here is ever
  // reachable — no button to click, no Pin Card offering Edit — so wiring it
  // regardless costs nothing.
  const canReachPinControls =
    access.collaborative || canAddPin(access) || access.isModerator
  if (!canReachPinControls) return

  // Adding a Pin is one gesture now that there is one add-path: the button arms
  // the drop rather than opening a face to choose from.
  addPinBtn.addEventListener('click', () => {
    // A logged-out reader on a Collaborative Map still sees this button — a
    // control that isn't there teaches no one the app exists — but tapping it
    // can only ask them to log in, never arm the drop.
    if (!context.userId) {
      try {
        showLoginPrompt()
      } catch (err) {
        console.error(
          `login prompt failed; ${err instanceof Error ? err.message : err}`,
        )
      }
      return
    }
    if (droppingPin) stopDroppingPin()
    else startDroppingPin()
  })
  mapStatusHelp.addEventListener('click', () => linkHelpDialog.showModal())
  linkHelpCloseBtn.addEventListener('click', () => linkHelpDialog.close())

  // An armed drop is waiting on the Map, so it has to be cancellable from
  // there — by then the keyboard is nowhere near the toolbar. The help panel
  // takes Escape first, though: the dialog closes on it and the event carries
  // on up to here, and one press should not both close what was opened over
  // the drop and cancel the drop underneath it.
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || !droppingPin) return
    if (linkHelpDialog.open) return
    stopDroppingPin()
  })

  // The other way to answer an armed drop, and the reason it needs no field of
  // its own: the reader has just clicked Add a Pin and is holding the pointer
  // over the Map with nothing focused, so ⌘V lands on the document. Read the
  // moment it arrives rather than behind a Confirm, which could only ever say
  // yes. See ADR-0015.
  document.addEventListener('paste', ev => {
    if (!droppingPin) return
    const pasted = ev.clipboardData?.getData('text')
    if (!pasted?.trim()) return
    // The armed drop has taken this paste, so the browser must not also carry
    // out its own: placing a Pin focuses the New Pin dialog's Title field, and
    // the default action would then insert the whole URL into it, behind the
    // name this just put there.
    ev.preventDefault()
    dropPastedLink(pasted)
  })

  pinImageInput.addEventListener('change', () => {
    const file = pinImageInput.files?.[0]
    if (!file) return
    void readImageAsDataUrl(file).then(dataUrl => {
      pendingImageDataUrl = dataUrl
      removeImage = false
      pinImagePreview.src = dataUrl
      pinImagePreview.hidden = false
      pinRemoveImageBtn.hidden = false
    })
  })

  pinRemoveImageBtn.addEventListener('click', () => {
    pendingImageDataUrl = undefined
    removeImage = true
    pinImageInput.value = ''
    pinImagePreview.hidden = true
    pinRemoveImageBtn.hidden = true
  })

  pinForm.addEventListener('submit', ev => {
    ev.preventDefault()
    void savePin()
  })
  pinCancelBtn.addEventListener('click', () => closePinDialog())
  // Escape closes a modal dialog itself, without passing through Cancel, so
  // the tidying up hangs off the dialog rather than off that button. Without
  // it a dismissed New Pin leaves its provisional marker on the Map with
  // nothing left holding a reference to remove it by.
  pinDialog.addEventListener('close', () => closePinDialog())
  pinDeleteBtn.addEventListener('click', () => void deleteEditingPin())

  // Import and Export stay the Owner's alone, on both kinds of Map — see
  // ADR-0019. `ownsMap()` implies `canReachPinControls` above (an Owner is
  // always logged in with `canAddPin` true), so this never wires without
  // having already passed that gate.
  if (!ownsMap()) return

  pinsIoBtn.addEventListener('click', () => void openPinsIo())
  pinsIoCopyBtn.addEventListener('click', () => void copyExport())
  pinsIoAddBtn.addEventListener('click', () => void importPins())
  pinsIoCloseBtn.addEventListener('click', () => pinsIoDialog.close())
  // Escape closes the dialog without passing through Close, so what has to be
  // forgotten hangs off the dialog rather than off that button: a paste left
  // behind would be waiting in the field the next time it opened, and an
  // Import is not something to re-offer someone who walked away from it.
  pinsIoDialog.addEventListener('close', () => {
    pinsIoImportText.value = ''
    setPinsIoNote('')
  })
}

void init()
