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
  type GeoJSONSource,
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
  type ImportMapReq,
  type ImportMapRsp,
  importOverwriteForm,
  type LatLng,
  type MapBounds,
  type Pin,
  type Region,
  type UpdatePinReq,
} from '../shared/api.ts'
import {
  formatMapFile,
  parseMapFile,
  RegionMaxCount,
  RegionVertexMaxCount,
  RegionVertexMinCount,
} from '../shared/map-file.ts'
import {
  canAddPin,
  canEditMap,
  canEditPin,
  type MapAccess,
} from '../shared/permissions.ts'
import {
  categoryColors,
  pinColor,
  regionColors,
  uncategorizedColor,
} from './category-color.ts'
import {
  fetchAddPin,
  fetchAddRegion,
  fetchClearDefaultArea,
  fetchDeletePinResult,
  fetchDeletePost,
  fetchDeleteRegion,
  fetchGetMap,
  fetchImportMap,
  fetchSetDefaultArea,
  fetchSetSummary,
  fetchUpdatePin,
  fetchUpdatePinResult,
  fetchUpdateRegion,
  installProxyProtocol,
  proxyExternalUrl,
} from './fetch.ts'
import {parseMapLink} from './map-link.ts'
import {renderMarkdown} from './markdown.ts'
import {
  groupPinsByRegion,
  regionAtLocation,
  regionBounds,
  regionCentroid,
  regionRing,
  sortRegionsOldestFirst,
} from './region.ts'
import {
  filterPins,
  initSidebar,
  isNarrowViewport,
  isSidebarOpen,
  type PinCapability,
  renderSidebar,
  resolveSelection,
  scrollPinIntoView,
  scrollRegionIntoView,
  setActiveRegionSection,
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

const regionsBtn = document.getElementById('regions-btn') as HTMLButtonElement
const toolbarRegion = document.getElementById(
  'toolbar-region',
) as HTMLDivElement
const regionUndoBtn = document.getElementById(
  'region-undo-btn',
) as HTMLButtonElement
const regionDoneBtn = document.getElementById(
  'region-done-btn',
) as HTMLButtonElement
const regionCloseBtn = document.getElementById(
  'region-close',
) as HTMLButtonElement
const regionsDialog = document.getElementById(
  'regions-dialog',
) as HTMLDialogElement
const regionsList = document.getElementById('regions-list') as HTMLUListElement
const regionsEmpty = document.getElementById(
  'regions-empty',
) as HTMLParagraphElement
const regionsNote = document.getElementById(
  'regions-note',
) as HTMLParagraphElement
const regionsDrawBtn = document.getElementById(
  'regions-draw',
) as HTMLButtonElement
const regionsCloseBtn = document.getElementById(
  'regions-close',
) as HTMLButtonElement
const regionDialog = document.getElementById(
  'region-dialog',
) as HTMLDialogElement
const regionForm = document.getElementById('region-form') as HTMLFormElement
const regionDialogTitle = document.getElementById(
  'region-dialog-title',
) as HTMLHeadingElement
const regionNameInput = document.getElementById(
  'region-name',
) as HTMLInputElement
const regionCancelBtn = document.getElementById(
  'region-cancel',
) as HTMLButtonElement
const regionSaveBtn = document.getElementById(
  'region-save',
) as HTMLButtonElement

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

/** The one GeoJSON source every Region, and the ring being traced, is drawn from. */
const regionSourceId = 'regions'
const regionFillLayerId = 'regions-fill'
const regionLineLayerId = 'regions-line'

/** How long a camera move that is only a nicety takes, unless the reader has asked for none. */
const flightMs = 600

/** What the Map is waiting for while a new Region is being traced. */
const traceInstruction = 'Click the map to place each corner of the region.'
const reshapeInstruction = 'Drag a point to reshape the region.'

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
 * Which of the toolbar's four faces is showing. The two that aren't `main` are
 * modes: they replace the controls rather than sitting beside them, because a
 * control wide enough to be worth reading leaves a narrow toolbar no room for
 * the buttons.
 */
type ToolbarFace = 'main' | 'area' | 'region' | 'filter'

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
/**
 * The Map's Regions, in no particular order. Which Pins are in which is never
 * stored: {@link regionIdByPin} is worked out from these and the Pins' Locations
 * every time `render()` runs. See ADR-0021.
 */
let regions: Region[] = []
/** Every Region's name to its colour, rebuilt whenever the Regions change. */
let regionColorByName = new Map<string, string>()
/** Pin id to the id of the Region it is in; absent for a Pin in none. */
let regionIdByPin = new Map<string, string>()
/**
 * The Region the Sidebar's scroll has taken the camera to, or none. While one is
 * set the Map's markers are narrowed to its Pins — composed with the Category
 * filter, not replacing it.
 */
let activeRegionId: string | undefined
/**
 * Whether the style has loaded, which is what a source and a layer need before
 * they can be added: `addSource` before it throws. Nothing in this app added
 * either until Regions, because every marker is a DOM `Marker`.
 */
let regionsReady = false
const regionLabels = new Map<string, Marker>()
/**
 * The ring being traced, or a Region being reshaped (`regionId` set). Present
 * exactly while the toolbar shows its region face.
 */
type RegionDraft = {regionId: string | undefined; vertices: LatLng[]}
let regionDraft: RegionDraft | undefined
let regionVertexMarkers: Marker[] = []
/** The Region the name dialog is renaming, or none where it is naming the traced one. */
let namingRegionId: string | undefined
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
  // A source and a layer cannot be added before the style has loaded — the
  // first `addSource` would throw — and `init` awaits `fetchGetMap` straight
  // away, so in practice the data arrives first and the temptation is to draw at
  // once. `regionsReady` is what every later `renderRegions()` waits behind.
  void map.once('load', () => {
    regionsReady = true
    renderRegions()
  })
  if (!isPreview) wireMapGestures()

  // Fail closed until the round trip says otherwise: no capability class is
  // added yet, which on its own already leaves every control this markup
  // cannot answer for hidden — see the `body:not(...)` rules in map.html.
  deletePostBtn.hidden = true
  areaBtn.hidden = true
  pinsIoBtn.hidden = true
  regionsBtn.hidden = true

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
  setRegions(data.regions)
  document.body.classList.toggle('collaborative', access.collaborative)
  document.body.classList.toggle('can-add-pin', canAddPin(access))
  document.body.classList.toggle('owns-map', ownsMap())
  document.body.classList.toggle('can-edit-map', canEditMap(access))
  // The Preview has no toolbar to hold either of them.
  deletePostBtn.hidden = isPreview || !ownsMap()
  pinsIoBtn.hidden = isPreview || !ownsMap()
  // Regions are the Map speaking about itself, like the Summary, so this is not
  // the Owner's alone: see `canEditMap`.
  regionsBtn.hidden = isPreview || !canEditMap(access)
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
    // Drawn, filled and labelled, and answering nothing: no handler is wired.
    renderRegions()
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
    onSelectRegion: regionId => selectRegion(regionId),
    onActiveRegionChange: regionId => setActiveRegion(regionId),
  })

  renderCategoryOptions()
  renderSummary()
  render()
  renderRegions()
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
    // Tracing: every click is a corner, wherever it lands — including on
    // another Region, which is why this is asked before that is.
    if (regionDraft) {
      if (!regionDraft.regionId) addRegionVertex(ev.lngLat.wrap())
      return
    }
    // A click that lands on a Region selects it and stops here. It has to stop
    // here: falling through would light-dismiss the Sidebar on a phone, closing
    // the very panel the tap was meant to scroll. It is answered from the
    // polygons rather than from a layer query, so it needs no layer to exist and
    // agrees with Pin membership by construction.
    const hit = regionAtLocation(ev.lngLat, regions)
    if (hit) {
      if (!isNarrowViewport()) setSidebarOpen(true)
      selectRegion(hit.id)
      return
    }
    // Light-dismiss: where the Sidebar overlays the Map, the exposed strip of
    // Map is the quickest way to get the rest of it back.
    if (isNarrowViewport() && isSidebarOpen()) setSidebarOpen(false)
  })
}

// --- Regions -----------------------------------------------------------------

/** Takes the Map's Regions and the colours their names ask for. */
function setRegions(next: Region[]): void {
  regions = next
  regionColorByName = regionColors(regions)
}

/**
 * Draws every Region: a translucent fill and an outline from one GeoJSON source
 * beneath the markers, and a DOM label at each polygon's middle. Safe to call
 * at any time — the labels are DOM and need no style, and the source waits
 * behind {@link regionsReady}, which is what stops the first `addSource` from
 * running ahead of the style and throwing.
 */
function renderRegions(): void {
  renderRegionShapes()
  renderRegionLabels()
}

type RegionFeature = {
  type: 'Feature'
  properties: {color: string; active: boolean}
  geometry:
    | {type: 'Polygon'; coordinates: [number, number][][]}
    | {type: 'LineString'; coordinates: [number, number][]}
}

function regionFeatures(): RegionFeature[] {
  const features: RegionFeature[] = []
  for (const region of regions) {
    // The Region being reshaped is drawn from the draft instead, so the ring the
    // reader is dragging is the only one on screen.
    if (region.id === regionDraft?.regionId) continue
    features.push({
      type: 'Feature',
      properties: {
        color: regionColorByName.get(region.name) ?? uncategorizedColor,
        active: region.id === activeRegionId,
      },
      geometry: {type: 'Polygon', coordinates: [regionRing(region.polygon)]},
    })
  }
  const vertices = regionDraft?.vertices
  if (vertices && vertices.length >= 2) {
    features.push({
      type: 'Feature',
      properties: {color: selectedMarkerColor, active: true},
      geometry:
        vertices.length >= 3
          ? {type: 'Polygon', coordinates: [regionRing(vertices)]}
          : {
              type: 'LineString',
              coordinates: vertices.map(v => [v.lng, v.lat]),
            },
    })
  }
  return features
}

function renderRegionShapes(): void {
  if (!regionsReady) return
  const data = {type: 'FeatureCollection' as const, features: regionFeatures()}
  const source = map.getSource<GeoJSONSource>(regionSourceId)
  if (source) {
    source.setData(data)
    return
  }
  map.addSource(regionSourceId, {type: 'geojson', data})
  map.addLayer({
    id: regionFillLayerId,
    type: 'fill',
    source: regionSourceId,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['case', ['get', 'active'], 0.24, 0.12],
    },
  })
  map.addLayer({
    id: regionLineLayerId,
    type: 'line',
    source: regionSourceId,
    paint: {'line-color': ['get', 'color'], 'line-width': 2},
  })
}

/**
 * A Region's name at the middle of its polygon, as a DOM marker rather than a
 * symbol layer for the reason a Pin's label is one: a symbol layer needs glyphs
 * from the style's font stack, and a font name the style does not have fails
 * silently — no labels, no error, nothing in the console. A DOM marker is also a
 * real click target, and is themed by the CSS that already exists.
 */
function renderRegionLabels(): void {
  for (const label of regionLabels.values()) label.remove()
  regionLabels.clear()
  for (const region of regions) {
    if (region.id === regionDraft?.regionId) continue
    const element = document.createElement('div')
    element.className = 'region-label'
    element.textContent = region.name
    element.style.borderColor =
      regionColorByName.get(region.name) ?? uncategorizedColor
    // A Preview's labels have nothing to click.
    if (!isPreview) {
      element.addEventListener('click', ev => {
        ev.stopPropagation()
        if (!isNarrowViewport()) setSidebarOpen(true)
        selectRegion(region.id)
      })
    }
    const at = regionCentroid(region)
    regionLabels.set(
      region.id,
      new Marker({element, anchor: 'center'})
        .setLngLat([at.lng, at.lat])
        .addTo(map),
    )
  }
}

/**
 * Makes a Region the one the tour is on — or, with none, the whole Map — and
 * narrows what the Map draws to match. It does not rebuild the Sidebar: the tour
 * moves every few hundred pixels of scroll, and a rebuild would throw away the
 * position the reader is scrolling from.
 */
function setActiveRegion(id: string | undefined, fit: boolean = true): void {
  if (id === activeRegionId) return
  activeRegionId = id
  selectedPinId = resolveSelection(selectedPinId, mapVisiblePins())
  renderMarkers(mapVisiblePins())
  setSelectedCard(selectedPinId)
  setActiveRegionSection(id)
  renderRegionShapes()
  if (fit) fitToPins(true)
}

/**
 * A click on a Region's heading, label or polygon. Selecting the active Region
 * again lets go of it, as it does for a Pin, so there is always a way back out
 * to the whole Map. The Sidebar is scrolled to it too: this is the app
 * scrolling, and the tour ignores that.
 */
function selectRegion(id: string | undefined): void {
  const next = id === activeRegionId ? undefined : id
  setActiveRegion(next)
  if (next) scrollRegionIntoView(next)
}

function enterRegionFace(): void {
  document.body.classList.add('tracing-region')
  regionUndoBtn.hidden = !!regionDraft?.regionId
  setStatus(regionDraft?.regionId ? reshapeInstruction : traceInstruction)
  renderRegionDraft()
}

/** Leaves the face, and with it whatever was half traced. */
function endRegionDraft(): void {
  document.body.classList.remove('tracing-region')
  regionDraft = undefined
  clearVertexMarkers()
  setStatus('')
  renderRegions()
}

function clearVertexMarkers(): void {
  for (const marker of regionVertexMarkers) marker.remove()
  regionVertexMarkers = []
}

/**
 * Starts tracing a new Region, or — given an id — reshaping an existing one,
 * which re-enters the same face with its vertices as draggable handles.
 */
function beginRegionDraft(regionId?: string): void {
  const existing = regions.find(region => region.id === regionId)
  regionDraft = {
    regionId: existing?.id,
    vertices: existing ? existing.polygon.map(v => ({...v})) : [],
  }
  if (existing) {
    map.fitBounds(areaBounds(regionBounds(existing)) as LngLatBounds, {
      padding: fitPadding,
      duration: 0,
    })
  }
  setToolbarFace('region')
}

function addRegionVertex(at: LatLng): void {
  const draft = regionDraft
  if (!draft) return
  if (draft.vertices.length >= RegionVertexMaxCount) {
    flashStatus(
      `A region can have at most ${RegionVertexMaxCount} points.`,
      traceInstruction,
    )
    return
  }
  draft.vertices.push({lat: at.lat, lng: at.lng})
  renderRegionDraft()
}

function undoRegionVertex(): void {
  if (!regionDraft || regionDraft.regionId) return
  regionDraft.vertices.pop()
  renderRegionDraft()
}

/** Redraws the ring, its handles, and which of the face's buttons are live. */
function renderRegionDraft(): void {
  clearVertexMarkers()
  const draft = regionDraft
  if (draft) {
    const reshaping = !!draft.regionId
    draft.vertices.forEach((vertex, index) => {
      regionVertexMarkers.push(createVertexMarker(vertex, index, reshaping))
    })
    regionUndoBtn.disabled = draft.vertices.length === 0
    // A reshape is written a handle at a time, so there is nothing left for
    // Done to save; a new ring is not a Region until it has enough corners.
    regionDoneBtn.disabled =
      !reshaping && draft.vertices.length < RegionVertexMinCount
  }
  renderRegions()
}

function createVertexMarker(
  vertex: LatLng,
  index: number,
  draggable: boolean,
): Marker {
  const element = document.createElement('div')
  element.className = draggable ? 'region-vertex' : 'region-vertex fixed'
  // A click on a handle must not also be a click on the Map, which would add
  // another corner beneath it.
  element.addEventListener('click', ev => ev.stopPropagation())
  const marker = new Marker({element, draggable})
    .setLngLat([vertex.lng, vertex.lat])
    .addTo(map)
  if (draggable) {
    marker.on('drag', () => {
      const at = marker.getLngLat().wrap()
      const draft = regionDraft
      if (draft) draft.vertices[index] = {lat: at.lat, lng: at.lng}
      renderRegionShapes()
    })
    marker.on('dragend', () => void commitReshape(marker))
  }
  return marker
}

/**
 * Writes a reshaped polygon as soon as a handle is let go, and puts the ring
 * back where it was if the write fails, exactly as {@link movePin} does for a
 * Pin. Membership is geometric, so a Pin the new outline now encloses simply is
 * in the Region: nothing else is written.
 */
async function commitReshape(marker: Marker): Promise<void> {
  const draft = regionDraft
  const region = regions.find(r => r.id === draft?.regionId)
  if (!draft || !region) return
  const at = marker.getLngLat().wrap()
  const index = regionVertexMarkers.indexOf(marker)
  if (index === -1) return
  draft.vertices[index] = {lat: at.lat, lng: at.lng}

  const rsp = await fetchUpdateRegion({id: region.id, polygon: draft.vertices})
  if (!rsp) {
    draft.vertices = region.polygon.map(v => ({...v}))
    renderRegionDraft()
    flashStatus('Could not reshape the region.', reshapeInstruction)
    return
  }
  setRegions(regions.map(r => (r.id === rsp.region.id ? rsp.region : r)))
  render()
  renderRegions()
}

/** Done: a reshape is already saved, and a new ring asks for its name. */
function finishRegionDraft(): void {
  const draft = regionDraft
  if (!draft) return
  if (draft.regionId) {
    setToolbarFace('main')
    return
  }
  if (draft.vertices.length < RegionVertexMinCount) return
  openRegionNameDialog()
}

function openRegionNameDialog(regionId?: string): void {
  namingRegionId = regionId
  regionDialogTitle.textContent = regionId
    ? 'Rename region'
    : 'Name this region'
  regionNameInput.value = regions.find(r => r.id === regionId)?.name ?? ''
  regionDialog.showModal()
  regionNameInput.focus()
  regionNameInput.select()
}

async function saveRegionName(): Promise<void> {
  const name = regionNameInput.value.trim()
  if (!name) return
  regionSaveBtn.disabled = true
  try {
    if (namingRegionId) {
      const rsp = await fetchUpdateRegion({id: namingRegionId, name})
      if (!rsp) {
        flashStatus('Could not rename the region.')
        return
      }
      setRegions(regions.map(r => (r.id === rsp.region.id ? rsp.region : r)))
      regionDialog.close()
      render()
      renderRegions()
      renderRegionsList()
      return
    }
    const draft = regionDraft
    if (!draft) {
      regionDialog.close()
      return
    }
    const rsp = await fetchAddRegion({name, polygon: draft.vertices})
    if (!rsp) {
      flashStatus('Could not add the region. Try again.')
      return
    }
    setRegions([...regions, rsp.region])
    regionDialog.close()
    // Leaving the face is what clears the ring it was tracing.
    setToolbarFace('main')
    render()
    renderRegions()
    flashStatus(`Added the region "${rsp.region.name}".`)
  } finally {
    regionSaveBtn.disabled = false
  }
}

function openRegionsDialog(): void {
  stopDroppingPin()
  setRegionsNote('')
  renderRegionsList()
  regionsDialog.showModal()
}

/** The list of Regions: swatch, name, how many Pins are in it, and what can be done. */
function renderRegionsList(): void {
  regionsList.replaceChildren()
  regionsEmpty.hidden = regions.length > 0
  const counts = new Map<string, number>()
  for (const group of groupPinsByRegion(pins, regions)) {
    if (group.region) counts.set(group.region.id, group.pins.length)
  }
  for (const region of sortRegionsOldestFirst(regions)) {
    const item = document.createElement('li')

    const swatch = document.createElement('span')
    swatch.className = 'region-swatch'
    swatch.style.background =
      regionColorByName.get(region.name) ?? uncategorizedColor
    swatch.setAttribute('aria-hidden', 'true')

    const name = document.createElement('span')
    name.className = 'region-name'
    name.textContent = region.name

    const count = document.createElement('span')
    count.className = 'region-count'
    count.textContent = countLabel(counts.get(region.id) ?? 0)

    item.append(
      swatch,
      name,
      count,
      regionAction('Reshape', region.name, () => {
        regionsDialog.close()
        beginRegionDraft(region.id)
      }),
      regionAction('Rename', region.name, () =>
        openRegionNameDialog(region.id),
      ),
      regionAction('Delete', region.name, () => void deleteRegion(region)),
    )
    regionsList.append(item)
  }
  const full = regions.length >= RegionMaxCount
  regionsDrawBtn.disabled = full
  if (full) {
    setRegionsNote(`A map can have at most ${RegionMaxCount} regions.`)
  }
}

function regionAction(
  label: string,
  regionName: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.setAttribute('aria-label', `${label} ${regionName}`)
  button.addEventListener('click', onClick)
  return button
}

function setRegionsNote(text: string): void {
  regionsNote.textContent = text
  regionsNote.hidden = !text
}

/**
 * Deletes a Region, with no confirmation, as deleting a Pin has none: the Pins
 * inside it are not touched, since membership was never stored, and drawing it
 * again puts everything back.
 */
async function deleteRegion(region: Region): Promise<void> {
  const rsp = await fetchDeleteRegion({id: region.id})
  if (!rsp) {
    setRegionsNote(`Could not delete "${region.name}". Try again.`)
    return
  }
  setRegions(regions.filter(r => r.id !== region.id))
  if (activeRegionId === region.id) activeRegionId = undefined
  render()
  renderRegions()
  renderRegionsList()
  // Nothing left to tour, or nothing that held the camera: back to the whole Map.
  if (!regions.length) fitToPins(true)
}

function render(): void {
  // From every Pin, not the visible ones: see {@link categoryColorByName}.
  categoryColorByName = categoryColors(pins)
  // Membership is worked out here, once, from every Pin and every Region, and
  // handed to the Sidebar — which stays pure display and never learns what a
  // polygon is, the way `canEditPin` runs in exactly one place on the client.
  const membership = regions.length ? groupPinsByRegion(pins, regions) : []
  regionIdByPin = new Map()
  for (const group of membership) {
    if (!group.region) continue
    for (const pin of group.pins) regionIdByPin.set(pin.id, group.region.id)
  }
  if (activeRegionId && !regions.some(r => r.id === activeRegionId)) {
    activeRegionId = undefined
  }

  const visible = filterPins(pins, activeCategory)
  const onMap = mapVisiblePins()
  const previouslySelected = selectedPinId
  // Resolved against what the Map shows, so that when the tour narrows the Map
  // a Selected Pin it no longer holds is let go of in both views at once.
  selectedPinId = resolveSelection(selectedPinId, onMap)
  renderMarkers(onMap)
  const shown = new Set(visible.map(pin => pin.id))
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
    regionGroups: regions.length
      ? membership
          .map(group => ({
            region: group.region,
            pins: group.pins.filter(pin => shown.has(pin.id)),
          }))
          .filter(group => group.region || group.pins.length)
      : undefined,
    regionColors: regionColorByName,
    activeRegionId,
  })
  showFilterSwatch()
  // Losing the Selected Pin to a filter or a deletion lands in the same place
  // as letting go of it deliberately: the whole Map.
  if (previouslySelected && !selectedPinId) fitToPins(true)
}

/**
 * The Pins the Map draws: the Category filter's, and then — while the tour is
 * on a Region — only that Region's. Composed rather than replaced, so filtering
 * to Cafes and touring the North Side shows the North Side's cafes.
 */
function mapVisiblePins(): Pin[] {
  const visible = filterPins(pins, activeCategory)
  if (!activeRegionId) return visible
  return visible.filter(pin => regionIdByPin.get(pin.id) === activeRegionId)
}

/**
 * Paints the Summary at the top of the Sidebar, and decides whether the block
 * is there at all: a reader who cannot write one and is looking at a Map that
 * has none gets no empty box, while whoever may write one is always offered the
 * control. A Preview never reaches this — `init` returns before the Sidebar
 * exists — which is how ADR-0007 stays true without a check of its own.
 */
function renderSummary(): void {
  const canEdit = canEditMap(access)
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
 * Frames what the Map is showing, which is what it loads with and what it
 * returns to whenever nothing is selected. That is the Region the tour is on,
 * where it is on one; otherwise every visible Pin *and* every Region, so a Map
 * whose Regions reach past its Pins still opens on all of it. With nothing to
 * frame it falls back to the subreddit's Default Area, and with no area to the
 * whole world the Map was constructed on.
 */
function fitToPins(animate: boolean = false): void {
  const bounds = framing()
  if (!bounds) return
  map.fitBounds(bounds, {
    padding: isPreview ? previewFitPadding : fitPadding,
    maxZoom: 14,
    duration: animate ? animationMs() : 0,
  })
}

function framing(): LngLatBounds | undefined {
  const active = regions.find(region => region.id === activeRegionId)
  if (active) return areaBounds(regionBounds(active))

  const visible = filterPins(pins, activeCategory)
  let bounds = visible.length ? pinBounds(visible) : undefined
  for (const region of regions) {
    const extent = areaBounds(regionBounds(region))
    if (!extent) continue
    if (bounds) bounds.extend(extent)
    else bounds = extent
  }
  return bounds ?? areaBounds(defaultArea)
}

/** How long a flight takes: none, for a reader who has asked for less motion. */
function animationMs(): number {
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : flightMs
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
  // A card outside the Region the tour is on was chosen. The Map cannot select
  // a Pin it is not drawing, so the tour moves to that Pin's Region (or off
  // Regions, for a Pin in none) rather than leaving the two views to disagree.
  if (pinId && activeRegionId && regionIdByPin.get(pinId) !== activeRegionId) {
    activeRegionId = regionIdByPin.get(pinId)
    renderMarkers(mapVisiblePins())
    setActiveRegionSection(activeRegionId)
    renderRegions()
  }
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
    // Membership is geometric, so a Pin dragged across a boundary is in
    // another Region with nothing to update — but its card has to move there.
    if (
      regions.length &&
      regionIdByPin.get(pin.id) !== regionAtLocation(pin.location, regions)?.id
    ) {
      render()
      scrollPinIntoView(pin.id)
    }
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
  toolbarRegion.hidden = face !== 'region'
  toolbarFilter.hidden = face !== 'filter'

  // Both modes take the Map over in their own way, and neither survives the
  // other: an armed drop belongs to the main face's Add a Pin, and the
  // instruction the area face wrote over the Map goes with the face.
  if (face !== 'main') stopDroppingPin()
  if (previous === 'area') setStatus('')
  if (previous === 'region') endRegionDraft()
  if (face === 'area') enterAreaFace()
  if (face === 'region') enterRegionFace()

  // Focus follows the swap, so the keyboard lands on whatever replaced the
  // control it was on rather than falling back to the top of the document.
  if (face === 'area') areaSaveBtn.focus()
  else if (face === 'region') regionCloseBtn.focus()
  else if (face === 'filter') categoryFilterSelect.focus()
  else if (previous === 'area' && !areaBtn.hidden) areaBtn.focus()
  else if (previous === 'region' && !regionsBtn.hidden) regionsBtn.focus()
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
 * either end: the text Export writes is the text Import reads. Both are the
 * whole Map now — its Pins, its Regions and its Summary. See ADR-0022.
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
      // The Regions and the Summary are as stale as the Pins are: a Moderator
      // may have changed either since this page loaded, and an Export is now
      // the whole Map.
      pins = data.pins
      summary = data.summary
      setRegions(data.regions)
      renderCategoryOptions()
      renderSummary()
      render()
      renderRegions()
    }
  }
  pinsIoExportText.value = formatMapFile(pins, regions, summary)
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
async function importMap(): Promise<void> {
  const read = parseMapFile(pinsIoImportText.value)
  if ('error' in read) {
    setPinsIoNote(read.error, true)
    return
  }

  // Pins add; a Summary and Regions replace. It asks exactly when something
  // would actually be replaced — the file carries one *and* the Map already has
  // one — so a v1 file, which carries neither, asks nothing, as it always did.
  const replacing = {
    summary: read.summary !== undefined && !!summary,
    regions: read.regions !== undefined ? regions.length : 0,
  }
  if (replacing.summary || replacing.regions) {
    const form = await showForm(importOverwriteForm(replacing))
    if (form.action !== 'SUBMITTED') return
  }

  pinsIoAddBtn.disabled = true
  setPinsIoNote(`Importing ${countLabel(read.pins.length)}…`)
  const req: ImportMapReq = {pins: read.pins}
  if (read.regions !== undefined) req.regions = read.regions
  if (read.summary !== undefined) req.summary = read.summary
  const rsp = await fetchImportMap(req)
  pinsIoAddBtn.disabled = false
  if (!rsp) {
    setPinsIoNote('That could not be imported. Try again in a moment.', true)
    return
  }

  // Paints what landed rather than what was sent.
  pins = [...pins, ...rsp.pins]
  summary = rsp.summary
  setRegions(rsp.regions)
  renderSummary()
  renderCategoryOptions()
  // Nothing selected is what frames the whole Map, which is the only view that
  // shows an Owner what they just added alongside what was already there.
  selectedPinId = undefined
  render()
  renderRegions()
  setSidebarOpen(!isNarrowViewport() && pins.length > 0)
  fitToPins(true)
  pinsIoDialog.close()
  flashStatus(importedLabel(rsp))
}

/** What the Map says once an Import has landed and the dialog has gone. */
function importedLabel(rsp: ImportMapRsp): string {
  const parts = [`Added ${countLabel(rsp.pins.length)}.`]
  const {replaced} = rsp
  if (replaced.summary && replaced.regions) {
    parts.push(
      `Replaced the summary and ${regionCountLabel(replaced.regions)}.`,
    )
  } else if (replaced.summary) parts.push('Replaced the summary.')
  else if (replaced.regions) {
    parts.push(`Replaced ${regionCountLabel(replaced.regions)}.`)
  }
  if (rsp.droppedImages) {
    const images =
      rsp.droppedImages === 1
        ? 'One image was'
        : `${rsp.droppedImages} images were`
    parts.push(
      `${images} left out — only images uploaded here can be carried over.`,
    )
  }
  return parts.join(' ')
}

function regionCountLabel(count: number): string {
  return count === 1 ? '1 region' : `${count} regions`
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
  if (canEditMap(access)) {
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

  // Regions answer to the same rule the Summary does — the Map speaking about
  // itself — so they are wired beside it, ahead of the Pin gates below. See
  // ADR-0021.
  if (canEditMap(access)) {
    regionsBtn.addEventListener('click', () => openRegionsDialog())
    regionsCloseBtn.addEventListener('click', () => regionsDialog.close())
    regionsDrawBtn.addEventListener('click', () => {
      regionsDialog.close()
      beginRegionDraft()
    })
    regionCloseBtn.addEventListener('click', () => setToolbarFace('main'))
    regionUndoBtn.addEventListener('click', () => undoRegionVertex())
    regionDoneBtn.addEventListener('click', () => finishRegionDraft())
    regionForm.addEventListener('submit', ev => {
      ev.preventDefault()
      void saveRegionName()
    })
    regionCancelBtn.addEventListener('click', () => regionDialog.close())
    // Escape leaves the tracing face — unless it was pressed to close the name
    // dialog, which handles it first and must not also throw the ring away.
    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape' || toolbarFace !== 'region') return
      if (regionDialog.open) return
      setToolbarFace('main')
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
  pinsIoAddBtn.addEventListener('click', () => void importMap())
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
