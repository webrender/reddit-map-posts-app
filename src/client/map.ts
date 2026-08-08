import {
  LngLatBounds,
  MapLibreMap,
  Marker,
  NavigationControl,
  type Subscription,
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
} from './fetch.ts'

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

const viewDialog = document.getElementById('view-dialog') as HTMLDialogElement
const viewTitle = document.getElementById('view-title') as HTMLHeadingElement
const viewCategory = document.getElementById('view-category') as HTMLSpanElement
const viewImage = document.getElementById('view-image') as HTMLImageElement
const viewDescription = document.getElementById(
  'view-description',
) as HTMLParagraphElement
const viewLink = document.getElementById('view-link') as HTMLAnchorElement
const viewCloseBtn = document.getElementById('view-close') as HTMLButtonElement

let map: MapLibreMap
let isOwner = false
let pins: Pin[] = []
const markers = new Map<string, Marker>()

let activeCategory = ''
let editingPinId: string | undefined
let editingLocation: LatLng | undefined
let pendingImageDataUrl: string | undefined
let removeImage = false
let pendingMarker: Marker | undefined
let editingDragSubscription: Subscription | undefined
let droppingPin = false
let searchDebounce: ReturnType<typeof setTimeout> | undefined
let searchToken = 0

async function init(): Promise<void> {
  map = new MapLibreMap({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/bright',
    center: [0, 20],
    zoom: 1.5,
  })
  map.addControl(new NavigationControl())
  map.on('click', ev => {
    if (!droppingPin) return
    stopDroppingPin()
    openNewPinDialog({lat: ev.lngLat.lat, lng: ev.lngLat.lng})
  })

  const data = await fetchGetMap()
  if (!data) return

  isOwner = data.isOwner
  pins = data.pins
  document.body.classList.toggle('viewer-mode', !isOwner)

  renderCategoryOptions()
  renderMarkers()
  fitToPins()
  wireEvents()
}

function fitToPins(): void {
  if (!pins.length) return
  const bounds = new LngLatBounds()
  for (const pin of pins) bounds.extend([pin.location.lng, pin.location.lat])
  map.fitBounds(bounds, {padding: 60, maxZoom: 14, duration: 0})
}

function renderMarkers(): void {
  for (const marker of markers.values()) marker.remove()
  markers.clear()

  for (const pin of pins) {
    if (activeCategory && pin.category !== activeCategory) continue
    const marker = new Marker()
      .setLngLat([pin.location.lng, pin.location.lat])
      .addTo(map)
    marker.getElement().style.cursor = 'pointer'
    marker.getElement().addEventListener('click', ev => {
      ev.stopPropagation()
      openPin(pin)
    })
    markers.set(pin.id, marker)
  }
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

function openPin(pin: Pin): void {
  if (isOwner) openEditDialog(pin)
  else openViewDialog(pin)
}

function openViewDialog(pin: Pin): void {
  viewTitle.textContent = pin.title

  viewCategory.hidden = !pin.category
  viewCategory.textContent = pin.category ?? ''

  viewImage.hidden = !pin.imageUrl
  if (pin.imageUrl) viewImage.src = pin.imageUrl

  viewDescription.hidden = !pin.description
  viewDescription.textContent = pin.description ?? ''

  viewLink.hidden = !pin.link
  if (pin.link) viewLink.href = pin.link

  viewDialog.showModal()
}

function openEditDialog(pin: Pin): void {
  editingPinId = pin.id
  editingLocation = pin.location
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

  const marker = markers.get(pin.id)
  if (marker) {
    marker.setDraggable(true)
    editingDragSubscription = marker.on('dragend', () => {
      const lngLat = marker.getLngLat()
      editingLocation = {lat: lngLat.lat, lng: lngLat.lng}
    })
  }

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

  pendingMarker = new Marker({color: '#888'})
    .setLngLat([location.lng, location.lat])
    .addTo(map)

  pinDialog.showModal()
  pinTitleInput.focus()
}

function closePinDialog(): void {
  if (editingPinId) markers.get(editingPinId)?.setDraggable(false)
  editingDragSubscription?.unsubscribe()
  editingDragSubscription = undefined
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
  if (!title || !editingLocation) return
  const category = pinCategoryInput.value.trim()
  const description = pinDescriptionInput.value.trim()
  const link = pinLinkInput.value.trim()

  if (editingPinId) {
    const req: UpdatePinReq = {
      id: editingPinId,
      title,
      category,
      description,
      link,
      location: editingLocation,
    }
    if (pendingImageDataUrl) req.imageDataUrl = pendingImageDataUrl
    else if (removeImage) req.removeImage = true

    const rsp = await fetchUpdatePin(req)
    if (!rsp) return
    const index = pins.findIndex(pin => pin.id === editingPinId)
    if (index !== -1) pins[index] = rsp.pin
  } else {
    const req: AddPinReq = {location: editingLocation, title}
    if (category) req.category = category
    if (description) req.description = description
    if (link) req.link = link
    if (pendingImageDataUrl) req.imageDataUrl = pendingImageDataUrl

    const rsp = await fetchAddPin(req)
    if (!rsp) return
    pins.push(rsp.pin)
  }

  renderCategoryOptions()
  renderMarkers()
  closePinDialog()
}

async function deleteEditingPin(): Promise<void> {
  if (!editingPinId) return
  const rsp = await fetchDeletePin({id: editingPinId})
  if (!rsp) return
  pins = pins.filter(pin => pin.id !== editingPinId)
  renderCategoryOptions()
  renderMarkers()
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
  renderMarkers()
  map.easeTo({center: [result.location.lng, result.location.lat], duration: 0})
  openEditDialog(rsp.pin)
}

function wireEvents(): void {
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

  categoryFilterSelect.addEventListener('change', () => {
    activeCategory = categoryFilterSelect.value
    renderMarkers()
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

viewCloseBtn.addEventListener('click', () => viewDialog.close())

void init()
