import {
  context,
  navigateTo,
  showForm,
  showLoginPrompt,
} from '@devvit/web/client'
import {
  type CreateMapPostReq,
  type CreateMapPostRsp,
  type DeleteIndexPostRsp,
  defaultMapPostTitle,
  deleteIndexPostForm,
  Endpoint,
  type GetIndexRsp,
  type IndexEntry,
  IndexPageSize,
  IndexSort,
  newPostForm,
} from '../shared/api.ts'
import {fetchJson} from './json.ts'
import './theme.css'

const searchInput = document.getElementById('search') as HTMLInputElement
const sortNewBtn = document.getElementById('sort-new') as HTMLButtonElement
const sortTopBtn = document.getElementById('sort-top') as HTMLButtonElement
const entriesList = document.getElementById('entries') as HTMLUListElement
const message = document.getElementById('message') as HTMLParagraphElement
const pageLabel = document.getElementById('page-label') as HTMLSpanElement
const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement
const nextBtn = document.getElementById('next-btn') as HTMLButtonElement
const createBtn = document.getElementById('create-btn') as HTMLButtonElement
const deleteBtn = document.getElementById(
  'delete-index-btn',
) as HTMLButtonElement

/**
 * How long a keystroke waits before it becomes a request. The Listing is
 * assembled on the server (ADR-0010), so a request per keystroke would be a
 * request per keystroke; the previous Entries stay on screen until the new ones
 * land, so the wait is never a blank screen.
 */
const searchDebounceMillis = 250

/**
 * What the Listing is currently showing. None of it is remembered: every load
 * of an Index Post starts at Newest, page one, with no Search Query, because
 * there is nowhere per-reader to keep it and no version of this that is worth a
 * round trip to find out.
 */
let sort: IndexSort = IndexSort.New
let page = 1
let query = ''
/**
 * Which request is allowed to paint. Answers can overtake each other — a slow
 * page one and a fast page two — and the one that arrives last is not
 * necessarily the one that was asked for last.
 */
let latestReq = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

function init(): void {
  renderSkeleton()

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      query = searchInput.value.trim()
      // A different set of Maps makes the page number meaningless.
      page = 1
      void load()
    }, searchDebounceMillis)
  })

  sortNewBtn.addEventListener('click', () => setSort(IndexSort.New))
  sortTopBtn.addEventListener('click', () => setSort(IndexSort.Top))

  prevBtn.addEventListener('click', () => {
    page--
    void load()
  })
  nextBtn.addEventListener('click', () => {
    page++
    void load()
  })

  createBtn.addEventListener('click', () => void createMap())
  deleteBtn.addEventListener('click', () => void confirmDeleteIndexPost())

  void load()
}

function setSort(next: IndexSort): void {
  if (sort === next) return
  sort = next
  page = 1
  sortNewBtn.ariaPressed = `${next === IndexSort.New}`
  sortTopBtn.ariaPressed = `${next === IndexSort.Top}`
  void load()
}

async function load(): Promise<void> {
  const req = ++latestReq
  const params = new URLSearchParams({sort, page: `${page}`})
  if (query) params.set('q', query)

  const rsp = await fetchJson<GetIndexRsp>(`${Endpoint.GetIndex}?${params}`)
  if (req !== latestReq) return

  if (!rsp) {
    // Whatever is on screen is better than nothing on screen, so this only
    // speaks up when there is nothing to keep.
    if (!entriesList.childElementCount || isSkeleton()) {
      showMessage('Maps could not be loaded.')
    }
    return
  }

  // Revealed only once the server has said who is reading, so a reader who is
  // not a moderator never sees it flicker past on the way to being hidden. It
  // is answered on every load rather than once, since nothing here is state.
  deleteBtn.hidden = !rsp.isModerator

  // The server clamps the page to what exists, so a Next that outran the last
  // page comes back corrected rather than empty.
  page = rsp.page
  render(rsp)
}

function render(rsp: GetIndexRsp): void {
  if (!rsp.total) {
    showMessage(
      query
        ? `No maps match “${searchInput.value.trim()}”.`
        : 'No maps yet — be the first.',
    )
    return
  }

  document.body.classList.remove('message-only', 'no-pager')
  pageLabel.textContent = `${rsp.page} / ${rsp.pageCount}`
  prevBtn.disabled = rsp.page <= 1
  nextBtn.disabled = rsp.page >= rsp.pageCount

  // A page can come back short, or empty, when the Map Posts on it turned out
  // to be gone or removed — the pager stays so the reader can step off it, and
  // the index has already been mended for next time.
  if (!rsp.entries.length) {
    showMessage('These maps are no longer available.', {keepPager: true})
    return
  }
  entriesList.replaceChildren(...rsp.entries.map(renderEntry))
}

function renderEntry(entry: IndexEntry): HTMLLIElement {
  const title = document.createElement('span')
  title.className = 'entry-title'
  title.textContent = entry.title

  const meta = document.createElement('span')
  meta.className = 'entry-meta'
  // A missing score is left out rather than printed as zero: absent means
  // Reddit could not be reached, and zero would be a claim about the post.
  // See ADR-0011. `community` is the same shape, for the same reason: absent
  // means Solo, and printing it only when true is what keeps `u/{Owner}` from
  // misattributing every Contributor's Pin to the Owner. See ADR-0019.
  meta.textContent = [
    `u/${entry.author}`,
    entry.collaborative ? 'community' : undefined,
    `${entry.pinCount} ${entry.pinCount === 1 ? 'pin' : 'pins'}`,
    entry.score === undefined ? undefined : `${entry.score} ▲`,
    age(entry.createdAt),
  ]
    .filter(part => part !== undefined)
    .join(' · ')

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'entry'
  button.append(title, meta)
  button.addEventListener('click', () =>
    navigateTo(`https://www.reddit.com/comments/${entry.t3.slice(3)}`),
  )

  const item = document.createElement('li')
  item.append(button)
  return item
}

/** The five rows that hold the frame open until the first answer arrives. */
function renderSkeleton(): void {
  document.body.classList.remove('message-only')
  document.body.classList.add('no-pager')
  entriesList.replaceChildren(
    ...Array.from({length: IndexPageSize}, () => {
      const title = document.createElement('span')
      title.className = 'entry-title'
      title.textContent = ' '
      const meta = document.createElement('span')
      meta.className = 'entry-meta'
      meta.textContent = ' '
      const row = document.createElement('div')
      row.className = 'entry skeleton'
      row.append(title, meta)
      const item = document.createElement('li')
      item.append(row)
      return item
    }),
  )
}

function isSkeleton(): boolean {
  return !!entriesList.querySelector('.skeleton')
}

function showMessage(text: string, opts?: {keepPager: boolean}): void {
  message.textContent = text
  document.body.classList.add('message-only')
  document.body.classList.toggle('no-pager', !opts?.keepPager)
}

/**
 * The New Post Form, raised here rather than from the subreddit menu — the same
 * form object either way, so the two can't drift. A logged-out reader still
 * sees the control, and is asked to log in on tapping it: a control that isn't
 * there teaches no one that the app exists.
 */
async function createMap(): Promise<void> {
  if (!context.userId) {
    showLoginPrompt()
    return
  }

  const form = await showForm(
    newPostForm(defaultMapPostTitle(context.username)),
  )
  if (form.action !== 'SUBMITTED') return
  const title = `${form.values.title ?? ''}`.trim()
  if (!title) return

  createBtn.disabled = true
  // A Devvit `select` submits its choice as `string[]`, unwrapped here since
  // `CreateMapPostReq` — a shape this app's own code builds — takes a plain
  // value; see the doc comment on `NewPostFormReq`, which carries the raw
  // array because Reddit posts that one directly.
  const req: CreateMapPostReq = {title, kind: form.values.kind?.[0]}
  const rsp = await fetchJson<CreateMapPostRsp>(Endpoint.CreateMapPost, req)
  createBtn.disabled = false
  if (!rsp) {
    showMessage('The map could not be created.')
    return
  }

  // The new Map has no Pins yet, so it is deliberately not in the Listing the
  // reader is leaving; it appears when they drop their first Pin. See ADR-0010.
  navigateTo(rsp.url)
}

/**
 * A moderator's way to take this Index Post down, the same shape as Delete Map
 * on a Map Post: Reddit's own modal asks, and its Delete button is the
 * confirmation. The Maps in the Listing are not touched — an Index Post owns
 * none of them — so what is lost is this list and nothing that was on it.
 *
 * There is nowhere to return to afterwards, so it leaves for the subreddit.
 */
async function confirmDeleteIndexPost(): Promise<void> {
  const form = await showForm(deleteIndexPostForm())
  if (form.action !== 'SUBMITTED') return

  deleteBtn.disabled = true
  const rsp = await fetchJson<DeleteIndexPostRsp>(Endpoint.DeleteIndexPost, {})
  if (!rsp) {
    deleteBtn.disabled = false
    showMessage('This index post could not be deleted.')
    return
  }
  navigateTo(`https://www.reddit.com/r/${context.subredditName}`)
}

/** Compact enough to sit in a meta line that also holds three other things. */
function age(createdAt: number): string {
  const seconds = Math.max(0, (Date.now() - createdAt) / 1000)
  const minutes = seconds / 60
  if (minutes < 1) return 'just now'
  const hours = minutes / 60
  if (hours < 1) return `${Math.floor(minutes)}m ago`
  const days = hours / 24
  if (days < 1) return `${Math.floor(hours)}h ago`
  const years = days / 365
  if (years < 1) return `${Math.floor(days)}d ago`
  return `${Math.floor(years)}y ago`
}

init()
