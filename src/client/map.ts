import {
  LngLatBounds,
  MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type {
  AddPinReq,
  LatLng,
  Pin,
  PlaceResult,
  UpdatePinReq,
} from '../shared/api.ts'
import {
  fetchAddPin,
  fetchDeletePin,
  fetchGetMap,
  fetchSearchPlaces,
  fetchUpdatePin,
  installProxyProtocol,
  proxyExternalUrl,
} from './fetch.ts'
import {
  filterPins,
  initSidebar,
  isNarrowViewport,
  isSidebarOpen,
  renderSidebar,
  resolveSelection,
  scrollPinIntoView,
  setSelectedCard,
  setSidebarOpen,
} from './sidebar.ts'

const searchInput = document.getElementById('search-input') as HTMLInputElement
const searchResultsList = document.getElementById(
  'search-results',
) as HTMLUListElement
const searchStatus = document.getElementById('search-status') as HTMLSpanElement
const manualPinBtn = document.getElementById(
  'manual-pin-btn',
) as HTMLButtonElement
const categoryFilterSelect = document.getElementById(
  'category-filter',
) as HTMLSelectElement
const categoryOptionsDatalist = document.getElementById(
  'category-options',
) as HTMLDataListElement

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

/** MapLibre's default marker colour, restated so selection can swap it. */
const markerColor = '#3fb1ce'
const selectedMarkerColor = '#e11d48'

/**
 * How a Pin came to be selected. Selection itself is shared state, but each
 * origin drives a different side effect — that is what keeps a Map click from
 * yanking the Map's zoom, and a Pin Card click from re-scrolling the list the
 * user just clicked in.
 */
type SelectSource = 'card' | 'marker' | 'new' | 'drag'

let map: MapLibreMap
let isOwner = false
let pins: Pin[] = []
const markers = new Map<string, Marker>()

let activeCategory = ''
let selectedPinId: string | undefined
let editingPinId: string | undefined
let editingLocation: LatLng | undefined
let pendingImageDataUrl: string | undefined
let removeImage = false
let pendingMarker: Marker | undefined
let droppingPin = false
let searchDebounce: ReturnType<typeof setTimeout> | undefined
let searchToken = 0

async function init(): Promise<void> {
  // MapLibre parses tiles in a Web Worker it loads from a separate file. Left to
  // itself it looks for that file next to its own module URL, which after
  // bundling is this script's, so it is built into public/ alongside this one
  // (see build:worker) and pointed at by name here.
  setWorkerUrl(new URL('maplibre-gl-worker.js', import.meta.url).href)
  installProxyProtocol()

  map = new MapLibreMap({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/bright',
    center: [0, 20],
    zoom: 1.5,
    // Style, sprite, glyph, and tile URLs are all external; each one is
    // rewritten here so it is fetched through the server, which is the only
    // place a Reddit app may make external requests from.
    transformRequest: proxyExternalUrl,
  })
  // The Sidebar takes the left edge, so the zoom controls keep the right.
  map.addControl(new NavigationControl())
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

  const data = await fetchGetMap()
  if (!data) return

  isOwner = data.isOwner
  pins = data.pins
  document.body.classList.toggle('viewer-mode', !isOwner)

  initSidebar({
    onSelectCard: pinId => togglePin(pinId, 'card'),
    onEditPin: pinId => {
      const pin = pins.find(candidate => candidate.id === pinId)
      if (pin) openEditDialog(pin)
    },
    onToggle: () => map.resize(),
  })

  renderCategoryOptions()
  render()
  // Open where there is room for a column and something to list; a narrow
  // viewport or an empty Map both start collapsed.
  setSidebarOpen(!isNarrowViewport() && pins.length > 0)
  fitToPins()
  wireEvents()
}

function render(): void {
  const visible = filterPins(pins, activeCategory)
  const previouslySelected = selectedPinId
  selectedPinId = resolveSelection(selectedPinId, visible)
  renderMarkers(visible)
  renderSidebar({
    pins: visible,
    selectedPinId,
    isOwner,
    filtered: !!activeCategory,
  })
  // Losing the Selected Pin to a filter or a deletion lands in the same place
  // as letting go of it deliberately: the whole Map.
  if (previouslySelected && !selectedPinId) fitToPins(true)
}

/**
 * Frames every Pin currently shown, which is what the Map loads with and what
 * it returns to whenever nothing is selected.
 */
function fitToPins(animate: boolean = false): void {
  const visible = filterPins(pins, activeCategory)
  if (!visible.length) return
  const bounds = new LngLatBounds()
  for (const pin of visible) bounds.extend([pin.location.lng, pin.location.lat])
  map.fitBounds(bounds, {padding: 60, maxZoom: 14, duration: animate ? 600 : 0})
}

function renderMarkers(visible: Pin[]): void {
  for (const marker of markers.values()) marker.remove()
  markers.clear()
  for (const pin of visible) markers.set(pin.id, createMarker(pin))
}

function createMarker(pin: Pin): Marker {
  const selected = pin.id === selectedPinId
  const marker = new Marker({
    color: selected ? selectedMarkerColor : markerColor,
    // Only the Selected Pin can be moved, so an off-target tap on any other
    // marker can never drag a Pin somewhere by accident.
    draggable: selected && isOwner,
  })
    .setLngLat([pin.location.lng, pin.location.lat])
    .addTo(map)

  const element = marker.getElement()
  element.style.cursor = 'pointer'
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
      map.flyTo({center: [pin.location.lng, pin.location.lat], zoom: 15})
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
  searchStatus.textContent = 'Could not move pin.'
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
  categoryFilterSelect.hidden = categories.length === 0
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

function openNewPinDialog(location: LatLng): void {
  editingPinId = undefined
  editingLocation = location
  pendingImageDataUrl = undefined
  removeImage = false

  pinDialogTitle.textContent = 'New Pin'
  pinForm.reset()
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
  pinDialog.close()
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

    const rsp = await fetchUpdatePin(req)
    if (!rsp) return
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
  if (!rsp) return
  pins.push(rsp.pin)

  const addedId = rsp.pin.id
  renderCategoryOptions()
  render()
  closePinDialog()
  selectPin(addedId, 'new')
}

async function deleteEditingPin(): Promise<void> {
  if (!editingPinId) return
  const rsp = await fetchDeletePin({id: editingPinId})
  if (!rsp) return
  pins = pins.filter(pin => pin.id !== editingPinId)
  renderCategoryOptions()
  // A deleted Pin can't stay selected; render() drops it.
  render()
  closePinDialog()
}

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function stopDroppingPin(): void {
  droppingPin = false
  manualPinBtn.setAttribute('aria-pressed', 'false')
  manualPinBtn.textContent = 'Drop a Pin'
  document.getElementById('map')?.style.removeProperty('cursor')
}

function clearSearchResults(): void {
  searchResultsList.innerHTML = ''
  searchStatus.textContent = ''
}

function renderSearchResults(results: PlaceResult[]): void {
  searchResultsList.innerHTML = ''
  for (const result of results) {
    const item = document.createElement('li')
    item.textContent = result.name
    item.addEventListener('click', () => void selectSearchResult(result))
    searchResultsList.appendChild(item)
  }
}

async function runSearch(query: string): Promise<void> {
  const token = ++searchToken
  searchStatus.textContent = 'Searching…'
  const result = await fetchSearchPlaces(query)
  if (token !== searchToken) return // superseded by a newer search or a cleared input

  if (!result.ok) {
    searchResultsList.innerHTML = ''
    searchStatus.textContent = result.unavailable
      ? 'Ask a moderator to set up place search for this subreddit.'
      : 'Search failed.'
    return
  }
  searchStatus.textContent = ''
  renderSearchResults(result.results)
}

async function selectSearchResult(result: PlaceResult): Promise<void> {
  searchToken++ // invalidate any in-flight search
  clearSearchResults()
  searchInput.value = ''
  const rsp = await fetchAddPin({location: result.location, title: result.name})
  if (!rsp) {
    searchStatus.textContent = 'Could not add pin.'
    return
  }
  pins.push(rsp.pin)
  renderCategoryOptions()
  render()
  map.easeTo({center: [result.location.lng, result.location.lat], duration: 0})
  selectPin(rsp.pin.id, 'new')
  openEditDialog(rsp.pin)
}

function wireEvents(): void {
  categoryFilterSelect.addEventListener('change', () => {
    activeCategory = categoryFilterSelect.value
    // A Selected Pin the filter excludes stops being selected; render() sorts
    // that out for both views at once.
    render()
  })

  if (!isOwner) return

  manualPinBtn.addEventListener('click', () => {
    if (droppingPin) {
      stopDroppingPin()
      return
    }
    droppingPin = true
    manualPinBtn.setAttribute('aria-pressed', 'true')
    manualPinBtn.textContent = 'Click the map…'
    document.getElementById('map')?.style.setProperty('cursor', 'crosshair')
  })

  searchInput.addEventListener('input', () => {
    if (searchDebounce) clearTimeout(searchDebounce)
    const query = searchInput.value.trim()
    if (!query) {
      searchToken++ // invalidate any in-flight search
      clearSearchResults()
      return
    }
    searchDebounce = setTimeout(() => void runSearch(query), 300)
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
  pinDeleteBtn.addEventListener('click', () => void deleteEditingPin())
}

void init()
