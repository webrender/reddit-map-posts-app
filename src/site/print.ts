import {LngLatBounds, Map as MapLibreMap, setWorkerUrl} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './print.css'
import {uncategorizedColor} from '../client/category-color.ts'
import {renderMarkdown} from '../client/markdown.ts'
import {regionBounds, regionCentroid, regionRing} from '../client/region.ts'
import type {LatLng, MapBounds, Pin, Region} from '../shared/api.ts'
import {parseMapFile} from '../shared/map-file.ts'
import {
  type NumberedPin,
  type Plan,
  planPrint,
  type Section,
  showsOverview,
} from './plan.ts'
import {type Point, spreadPoints} from './spread.ts'

const svgNs = 'http://www.w3.org/2000/svg'
const styleUrl = 'https://tiles.openfreemap.org/styles/bright'
const attribution = '© OpenStreetMap contributors · OpenFreeMap · MapLibre'
/** Each map is drawn this many times denser than the screen, so it prints sharp. */
const pixelRatio = 3
const mapPadding = {top: 70, bottom: 50, left: 50, right: 50}
const idleTimeoutMs = 20_000
/** A numbered marker's diameter in CSS px; keep it in step with `.pin-badge` in print.css. */
const badgeSize = 24
/** Clear space kept between two markers' edges. */
const badgeGap = 3
/** Half the height of a Region's label, which markers keep clear of. */
const labelHalfHeight = 11
/** A marker moved less than this is not worth a leader line back to where it was. */
const leaderMinDistance = 4

const papers = {
  letter: {size: 'letter', width: '7.5in', height: '10in'},
  a4: {size: 'A4', width: '7.27in', height: '10.69in'},
} as const
type PaperName = keyof typeof papers

const jsonEl = byId<HTMLTextAreaElement>('json')
const paperEl = byId<HTMLSelectElement>('paper')
const renderBtn = byId<HTMLButtonElement>('render-btn')
const printBtn = byId<HTMLButtonElement>('print-btn')
const statusEl = byId<HTMLElement>('status')
const pagesEl = byId<HTMLElement>('pages')
const pageStyleEl = document.createElement('style')
document.head.append(pageStyleEl)

/** Bumped by every render, so a render that has been superseded stops. */
let generation = 0
let rendered = false

/** One map page waiting to be drawn. */
type MapJob = {
  frame: HTMLElement
  /** Regions to outline and label. */
  regions: Region[]
  /** Numbered markers; empty on the overview, which draws dots instead. */
  numbered: NumberedPin[]
  /** Every Pin to frame, and to draw as a dot where `numbered` is empty. */
  pins: Pin[]
  plan: Plan
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`missing #${id}`)
  return element as T
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function setStatus(text: string, isError: boolean = false): void {
  statusEl.textContent = text
  statusEl.classList.toggle('error', isError)
}

function applyPaper(): void {
  const paper = papers[paperEl.value as PaperName] ?? papers.letter
  document.documentElement.style.setProperty('--page-w', paper.width)
  document.documentElement.style.setProperty('--page-h', paper.height)
  // `@page` cannot read a custom property, so it is rewritten instead.
  pageStyleEl.textContent = `@page {size: ${paper.size} portrait; margin: 0.5in}`
}

async function render(): Promise<void> {
  const mine = ++generation
  rendered = false
  printBtn.disabled = true
  pagesEl.replaceChildren()

  const read = parseMapFile(jsonEl.value)
  if ('error' in read) {
    setStatus(read.error, true)
    return
  }
  applyPaper()
  const plan = planPrint(read)

  const jobs: MapJob[] = []
  const overview = showsOverview(plan)
  if (overview) pagesEl.append(overviewUnit(plan, jobs))
  if (read.summary) pagesEl.append(summaryUnit(read.summary))
  for (const section of plan.sections) {
    pagesEl.append(mapUnit(plan, section, jobs))
    pagesEl.append(listingUnit(plan, section))
  }

  renderBtn.disabled = true
  try {
    for (const [index, job] of jobs.entries()) {
      if (mine !== generation) return
      setStatus(`Drawing map ${index + 1} of ${jobs.length}…`)
      await drawMap(job)
    }
  } catch (err) {
    setStatus(
      `A map could not be drawn: ${err instanceof Error ? err.message : err}`,
      true,
    )
    return
  } finally {
    if (mine === generation) renderBtn.disabled = false
  }
  if (mine !== generation) return
  rendered = true
  printBtn.disabled = false
  const dropped = read.droppedImages
    ? ` ${read.droppedImages} image${read.droppedImages === 1 ? ' was' : 's were'} left out because they were not uploaded by the app.`
    : ''
  setStatus(`Ready to print.${dropped}`)
}

function overviewUnit(plan: Plan, jobs: MapJob[]): HTMLElement {
  const unit = el('section', 'unit')
  const frame = el('div', 'map-frame')
  unit.append(frame)
  jobs.push({
    frame,
    regions: plan.regions,
    numbered: [],
    pins: plan.pins,
    plan,
  })
  return unit
}

function summaryUnit(summary: string): HTMLElement {
  const unit = el('section', 'unit summary')
  unit.append(el('h2', 'section-heading', 'About this map'))
  const body = el('div', 'markdown')
  body.append(renderMarkdown(summary, {onOpenLink: url => window.open(url)}))
  unit.append(body)
  return unit
}

function mapUnit(plan: Plan, section: Section, jobs: MapJob[]): HTMLElement {
  const unit = el('section', 'unit')
  const frame = el('div', 'map-frame')
  unit.append(frame)
  if (section.name) {
    const chip = el('div', 'map-title')
    chip.append(el('h2', undefined, section.name))
    const count = section.pins.length
    chip.append(el('p', undefined, `${count} place${count === 1 ? '' : 's'}`))
    frame.append(chip)
  }
  jobs.push({
    frame,
    regions: section.region ? [section.region] : [],
    numbered: section.pins,
    pins: section.pins.map(entry => entry.pin),
    plan,
  })
  return unit
}

function listingUnit(plan: Plan, section: Section): HTMLElement {
  const unit = el('section', 'unit')
  if (section.name) {
    const heading = el('h2', 'section-heading')
    if (section.region) {
      heading.append(
        swatch(
          plan.regionColors.get(section.region.name) ?? uncategorizedColor,
          'region',
        ),
      )
    }
    heading.append(section.name)
    heading.append(el('span', 'count', `${section.pins.length}`))
    unit.append(heading)
  }
  if (!section.pins.length) {
    unit.append(el('p', 'empty', 'No places in this region.'))
    return unit
  }
  const columns = el('div', 'columns')
  for (const group of section.groups) {
    const groupEl = el('section', 'pin-group')
    if (section.headings) {
      const heading = el('h3', 'pin-group-heading')
      heading.append(
        swatch(
          (group.category && plan.categoryColors.get(group.category)) ||
            uncategorizedColor,
        ),
        group.category ?? 'Uncategorized',
      )
      groupEl.append(heading)
    }
    for (const entry of group.pins) groupEl.append(card(plan, entry))
    columns.append(groupEl)
  }
  unit.append(columns)
  return unit
}

function card(plan: Plan, {number, pin}: NumberedPin): HTMLElement {
  const article = el('article', 'card')
  if (pin.imageUrl) {
    const image = el('img', 'card-image')
    image.src = pin.imageUrl
    image.alt = ''
    article.append(image)
  }
  const head = el('div', 'card-head')
  const badge = el('span', 'num', `${number}`)
  badge.style.background = pinColorOf(plan, pin)
  head.append(badge, el('h3', undefined, pin.title))
  article.append(head)
  if (pin.link) article.append(el('p', 'card-link', shortLink(pin.link)))
  if (pin.description) {
    const body = el('div', 'markdown')
    body.append(
      renderMarkdown(pin.description, {onOpenLink: url => window.open(url)}),
    )
    article.append(body)
  }
  return article
}

/** A link as it reads on paper: no scheme, no `www.`, no trailing slash. */
function shortLink(link: string): string {
  return link
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

function pinColorOf(plan: Plan, pin: Pin): string {
  return (
    (pin.category && plan.categoryColors.get(pin.category)) ||
    uncategorizedColor
  )
}

function swatch(color: string, kind?: 'region'): HTMLElement {
  const element = el('span', kind ? `swatch ${kind}` : 'swatch')
  element.style.background = color
  return element
}

/**
 * Draws one map page. Only one MapLibre instance is ever alive: a browser
 * allows a handful of WebGL contexts at once and a Map may have two dozen
 * Regions, so each page is drawn, captured as an image, and its map removed
 * before the next begins. The markers are laid over the image afterwards as
 * plain elements, positioned as a fraction of the frame so they keep their
 * place at any print size.
 */
async function drawMap(job: MapJob): Promise<void> {
  const {frame, plan} = job
  const width = frame.clientWidth
  const height = frame.clientHeight
  const holder = el('div', 'map-holder')
  frame.prepend(holder)

  const map = new MapLibreMap({
    container: holder,
    style: styleUrl,
    center: [0, 20],
    zoom: 1,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio,
    canvasContextAttributes: {preserveDrawingBuffer: true},
  })
  try {
    await once(map, 'load')
    if (job.regions.length) drawRegionShapes(map, job.regions, plan)
    const bounds = framing(job)
    if (bounds)
      map.fitBounds(bounds, {padding: mapPadding, maxZoom: 15, duration: 0})
    await idle(map)

    const blob = await new Promise<Blob | null>(resolve =>
      map.getCanvas().toBlob(resolve, 'image/jpeg', 0.9),
    )
    if (!blob) throw new Error('the map could not be captured')

    const overlay = el('div', 'overlay')
    frame.append(overlay)
    const at = (location: LatLng): [string, string] => {
      const point = map.project([location.lng, location.lat])
      return [`${(point.x / width) * 100}%`, `${(point.y / height) * 100}%`]
    }
    for (const region of job.regions) {
      const label = el('div', 'region-label', region.name)
      label.style.borderColor =
        plan.regionColors.get(region.name) ?? uncategorizedColor
      ;[label.style.left, label.style.top] = at(regionCentroid(region))
      overlay.append(label)
    }
    if (job.numbered.length) {
      // Markers are moved apart until none overlap, so a cluster of Pins can
      // still be told one from another. A line back to the true spot says where
      // each one really is.
      const truth = job.numbered.map(({pin}) => {
        const point = map.project([pin.location.lng, pin.location.lat])
        return {x: point.x, y: point.y}
      })
      const placed = spreadPoints(truth, {
        minDistance: badgeSize + badgeGap,
        width,
        height,
        margin: badgeSize / 2 + 2,
        obstacles: labelObstacles(frame, overlay),
        obstacleDistance: badgeSize / 2 + labelHalfHeight + badgeGap,
      })
      const leaders = document.createElementNS(svgNs, 'svg')
      leaders.setAttribute('viewBox', `0 0 ${width} ${height}`)
      leaders.setAttribute('class', 'leaders')
      const badges: HTMLElement[] = []
      for (const [index, {number, pin}] of job.numbered.entries()) {
        const from = truth[index] as Point
        const to = placed[index] as Point
        const color = pinColorOf(plan, pin)
        if (Math.hypot(to.x - from.x, to.y - from.y) >= leaderMinDistance) {
          const line = document.createElementNS(svgNs, 'line')
          line.setAttribute('x1', `${from.x}`)
          line.setAttribute('y1', `${from.y}`)
          line.setAttribute('x2', `${to.x}`)
          line.setAttribute('y2', `${to.y}`)
          line.setAttribute('class', 'leader')
          const anchor = document.createElementNS(svgNs, 'circle')
          anchor.setAttribute('cx', `${from.x}`)
          anchor.setAttribute('cy', `${from.y}`)
          anchor.setAttribute('r', '3')
          anchor.setAttribute('class', 'leader-anchor')
          anchor.style.fill = color
          leaders.append(line, anchor)
        }
        const badge = el('div', 'pin-badge', `${number}`)
        badge.style.background = color
        badge.style.left = `${(to.x / width) * 100}%`
        badge.style.top = `${(to.y / height) * 100}%`
        badges.push(badge)
      }
      overlay.append(leaders, ...badges)
    } else {
      for (const pin of job.pins) {
        const dot = el('div', 'pin-dot')
        dot.style.background = pinColorOf(plan, pin)
        ;[dot.style.left, dot.style.top] = at(pin.location)
        overlay.append(dot)
      }
      overlay.append(legend(plan))
    }

    const image = el('img')
    image.alt = ''
    image.src = URL.createObjectURL(blob)
    frame.prepend(image)
    frame.append(el('div', 'attribution', attribution))
  } finally {
    map.remove()
    holder.remove()
  }
}

/**
 * Each Region label as a row of points down its middle, spaced closely enough
 * that a marker kept `obstacleDistance` from every one of them clears the whole
 * label. Measured from the page, since a label's width is the text's.
 */
function labelObstacles(frame: HTMLElement, overlay: HTMLElement): Point[] {
  const origin = frame.getBoundingClientRect()
  const points: Point[] = []
  for (const label of overlay.querySelectorAll('.region-label')) {
    const box = label.getBoundingClientRect()
    const y = box.top - origin.top + box.height / 2
    for (let x = box.left - origin.left; x <= box.right - origin.left; x += 8) {
      points.push({x, y})
    }
    points.push({x: box.right - origin.left, y})
  }
  return points
}

function legend(plan: Plan): HTMLElement {
  const box = el('div', 'legend')
  for (const [name, color] of plan.categoryColors) {
    const row = el('div')
    row.append(swatch(color), name)
    box.append(row)
  }
  return box
}

function drawRegionShapes(
  map: MapLibreMap,
  regions: readonly Region[],
  plan: Plan,
): void {
  map.addSource('regions', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: regions.map(region => ({
        type: 'Feature',
        properties: {
          color: plan.regionColors.get(region.name) ?? uncategorizedColor,
        },
        geometry: {type: 'Polygon', coordinates: [regionRing(region.polygon)]},
      })),
    },
  })
  map.addLayer({
    id: 'regions-fill',
    type: 'fill',
    source: 'regions',
    paint: {'fill-color': ['get', 'color'], 'fill-opacity': 0.14},
  })
  map.addLayer({
    id: 'regions-line',
    type: 'line',
    source: 'regions',
    paint: {'line-color': ['get', 'color'], 'line-width': 2.5},
  })
}

/** Every Pin and every outlined Region, or nothing to frame. */
function framing(job: MapJob): LngLatBounds | undefined {
  let bounds: LngLatBounds | undefined
  for (const pin of job.pins) {
    bounds ??= new LngLatBounds()
    bounds.extend([pin.location.lng, pin.location.lat])
  }
  for (const region of job.regions) {
    const extent = areaBounds(regionBounds(region))
    if (bounds) bounds.extend(extent)
    else bounds = extent
  }
  return bounds
}

/** As `map.ts` does: an area over the antimeridian has its east edge carried past 180. */
function areaBounds({west, south, east, north}: MapBounds): LngLatBounds {
  return new LngLatBounds(
    [west, south],
    [east < west ? east + 360 : east, north],
  )
}

function once(map: MapLibreMap, event: 'load'): Promise<void> {
  return new Promise((resolve, reject) => {
    void map.once(event, () => resolve())
    void map.once('error', ev => reject(ev.error))
  })
}

/** Resolves when tiles and glyphs have all arrived, or gives up and draws what it has. */
function idle(map: MapLibreMap): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, idleTimeoutMs)
    void map.once('idle', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

setWorkerUrl(new URL('maplibre-gl-worker.js', import.meta.url).href)
applyPaper()
renderBtn.addEventListener('click', () => void render())
printBtn.addEventListener('click', () => window.print())
paperEl.addEventListener('change', () => {
  applyPaper()
  if (rendered) void render()
})
