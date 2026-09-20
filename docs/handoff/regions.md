# Handoff — Regions

**Status:** designed, not started. No code written.
**Delete this file once the work has shipped.**
**Branch:** `regions`, cut from `main` (`c8dfbb7`) — this document is its first
commit, so the implementation continues on the branch it is already on.
**Prerequisite reading:** `CLAUDE.md` → `docs/agents/domain.md`, then `CONTEXT.md`,
then ADRs `0020`, `0019`, `0018`, `0017`, `0007`, `0006`.

> Items marked 🚨 are ones that will ship silently broken if implemented the
> obvious way. Read those before writing the code they touch.

**Suggested order:** §8 (glossary + ADR-0021 + ADR-0022) → §2 (`canEditMap`) →
§3 (`region.ts`) → §4 (colour) → §5 (the file format) → §6 (storage) → §9
(routes) → §10–12 (client). Everything in §2–§5 is a pure function with a test
and no DOM, and every later step is asserted against them.

**A natural two-commit split:** everything except the tour, then the tour
(§12's second half). The first commit is a complete, shippable feature —
Regions drawn, grouped, imported and exported — and the second is the only part
that touches scroll behaviour.

All `file:line` anchors are recorded against `c8dfbb7` ("Add a Map Summary, and
render Markdown in it and in Pin descriptions"). Each one names its symbol too,
so it can be re-located after drift.

---

## 1. Context

A Map Post today has two axes of meaning: where a Pin is (its Location) and what
it is (its Category). It has no way to say *which part of the map* a Pin belongs
to. On a forty-Pin city Map, "North Side" and "East End" are things an Owner can
only express by typing them into Categories — which collides with the axis
Categories already carry, and which the Map itself cannot draw.

**Intended outcome.** A Map gains **Regions**: named polygons its Owner traces
over parts of the Map. The Map draws them in their own colours with their own
labels; the Sidebar groups Pin Cards under them; and full screen, on a wide
viewport, scrolling the Sidebar takes the reader on a tour — as a Region's
section comes into view, the camera flies to that Region and the Map narrows to
its Pins. Export and Import carry Regions and the Summary alongside the Pins.

## 2. Decisions already made — do not relitigate

These four were asked and answered before this document existed.

1. **The Sidebar's scroll drives the camera** — not a Map gesture, and not
   click-only. The landing state is every polygon and every Pin; the tour begins
   at the reader's first scroll.
2. **A Region is traced by clicking vertices on the Map**, armed from the
   toolbar the way Pin Drop is. A vertex can be dragged later to reshape it.
   Not a framed rectangle (that is the Default Area's gesture, and a Region is a
   polygon), and not import-only.
3. **Membership is geometric** — a Pin is in a Region if its Location falls
   inside the polygon. Nothing is stored on the Pin: no new field, no migration,
   no Import question, and dragging a Pin into a Region just works.
4. **Import replaces the Summary and the Regions it carries**, behind a
   confirmation. Pins still only ever add. This reverses part of ADR-0020 and
   amends ADR-0017 — see §7, the riskiest part of this document.

## 3. Who may draw one 🚨

A Region is the Map speaking about itself, exactly as a Summary is — it is not a
Contributor's work. So it answers to `canEditSummary`'s rule: the Owner on
either kind of Map, plus a Moderator on a Collaborative one. On a Solo Map
moderating grants nothing, as everywhere else.

🚨 **Do not add a second predicate with an identical body.** `canEditRegions`
sitting beside `canEditSummary` is two spellings of one rule, and they will
drift the first time one of them is amended.

**Rename** `canEditSummary` → `canEditMap` (`src/shared/permissions.ts:76`) and
widen its doc comment to "the Map's own account of itself — its Summary and its
Regions". The body is unchanged, including the logged-out guard going first.
Call sites: `routeSetSummary` (`src/server/server.ts:483`), and `map.ts:408`
(body class), `:507` (`renderSummary`), `:1354` (`wireEvents`). The body class
`can-edit-summary` becomes `can-edit-map` (`public/map.html:607`).

The exhaustive table in `src/shared/permissions.test.ts` is renamed with it and
keeps the two rows that carry the design: a Moderator gets nothing on a Solo
Map, and the Owner keeps the Summary on a Collaborative Map even though they
have no power over its Pins.

## 4. Geometry — `src/client/region.ts` (new)

Client-only, **not `src/shared/`**, for the reason ADR-0020 gives `markdown.ts`:
the server never asks which Region a Pin is in — it stores polygons and hands
them back. Putting this in `shared/` would claim a constraint that does not
exist.

It imports nothing from `maplibre-gl`. It returns a `MapBounds`, and `map.ts`'s
existing `areaBounds()` (`src/client/map.ts:595`) turns that into a
`LngLatBounds` with the antimeridian handling already written.

```ts
export function containsLocation(region: Region, at: LatLng): boolean
export function regionForPin(pin: Pin, regions: readonly Region[]): Region | undefined
export function groupPinsByRegion(pins: Pin[], regions: readonly Region[]): RegionGroup[]
export function regionBounds(region: Region): MapBounds
```

- Containment is even-odd ray casting.
- 🚨 **Unwrap longitudes before casting the ray.** A polygon over Fiji has
  vertices at `179.4` and `-179.8`; on the raw numbers the ray crosses the whole
  world the wrong way round and every answer is wrong. Walk the ring adding
  ±360 whenever a step jumps more than 180° from the previous vertex, and
  unwrap the test point into the same frame. `viewBounds()` (`map.ts:873`) and
  `areaBounds()` (`map.ts:595`) already carry this concern; this is the third
  place that has to.
- **Overlapping polygons: the smallest containing Region wins**, ties broken by
  `id`, so the answer is total and stable rather than depending on the order
  Redis returned the hash in. A Pin inside nothing is in no Region.
- `groupPinsByRegion` orders groups oldest first by `createdAt`, `id` as the
  tie-break — the same total order `isOlder` already defines
  (`src/client/category-color.ts:121`) — with the no-Region group **last**,
  mirroring how `groupPinsByCategory` (`src/client/sidebar.ts:22`) puts
  uncategorized last.

**Tests** (`src/client/region.test.ts`) — pure, no DOM, the idiom of
`sidebar.test.ts`: inside, outside, and on a vertex; a concave polygon; a Fiji
polygon crossing the antimeridian; nested polygons picking the smaller; a Pin in
no Region; an empty Region list leaving every Pin ungrouped.

## 5. Colour — reuse ADR-0018, do not invent a rule

A Region's colour is its name, broken by age, from the same seven-colour palette
Categories use. In `category-color.ts`, extract the assignment loop (`:84-102`)
into a private `assignColors(namesOldestFirst: string[])` and give it two public
callers: the existing `categoryColors(pins)` and a new `regionColors(regions)`.

The same palette serves both axes on purpose: **a colour identifies within an
axis and never across one.** What tells them apart is where the colour appears
and what shape it is — a Category is a round `.category-swatch` on a marker and
a chip; a Region is a **squared-off** `.region-swatch` on a section heading, and
a translucent fill on the Map. Record this in ADR-0021, or the first reader to
notice a Category and a Region sharing a hue will "fix" it with an eighth
colour; ADR-0018 already explains at length why an eighth does not exist.

Test the property ADR-0018 exists for, now at the second axis: **adding a Region
repaints none of the Regions already on the Map.**

## 6. The file format — `src/shared/pins-file.ts` → `src/shared/map-file.ts`

An Export stops being "the Pins" and becomes the Map. Rename the module and its
test; `map-file.ts` is what it now is.

```ts
export const MapFileVersion = 2
export type RegionExport = {name: string; polygon: LatLng[]}
export type MapFile = {
  version: number
  summary?: string
  regions?: RegionExport[]
  pins: PinExport[]
}
```

- `parseMapFile` / `readMapValue` replace `parsePinsFile` / `readPinsValue`,
  keeping the existing shape exactly (`pins-file.ts:79-120`): forgiving about
  the envelope, strict about the contents, every entry checked before any is
  accepted, an error naming the entry by its position.
- 🚨 **A v1 file and a bare array must still read** — as Pins, with no Summary
  and no Regions. That is most of what is in the wild, and it is also what makes
  the no-confirmation path in §7 the common one.
- `toRegionExport` is an **allowlist**, like `toPinExport` (`pins-file.ts:160`)
  and for the same reason: `name` and `polygon` only. No `id` (it belongs to the
  Map holding the Region, not to the Region's account of itself) and no
  `createdAt` (ADR-0018 — an imported Region is stamped fresh, so its colour is
  re-derived where it lands).

Caps, beside `PinTitleMaxLen` and its siblings. Import is the first Region text
this app did not watch someone draw, which is ADR-0017's reasoning for every
ceiling it already has:

```ts
export const RegionNameMaxLen = 60      // as PinCategoryMaxLen
export const RegionMaxCount = 24        // per Map
export const RegionVertexMaxCount = 200 // per Region
export const RegionVertexMinCount = 3
```

A Region is refused for: a name that is missing or over its ceiling, fewer than
3 or more than `RegionVertexMaxCount` vertices, any vertex failing `isLatLng`
(`src/shared/api.ts:15`), or more Regions than `RegionMaxCount`.

## 7. Import and Export 🚨 — the reversal

**This contradicts shipped decisions and has to be done deliberately, in the
open.** ADR-0020 says an Export must not carry the Summary. ADR-0017 says
*"Import only ever adds… so it asks for no confirmation"*, and that Delete Map
is the only thing in the app that cannot be undone. Regions and the Summary in
Import/Export were asked for explicitly, with replacement chosen over merge.

**The rule.** Pins are added, exactly as today. The Summary and the Regions in
the file **replace** what the Map has. The confirmation appears **exactly when
something would actually be replaced** — the file carries a Summary or Regions
*and* the Map already has one or some. A file carrying neither (every v1 export)
is add-only and asks nothing, as now.

- `src/shared/api.ts`: `importOverwriteForm({summary, regions})` beside
  `deletePostForm` (`:352`) — Reddit's own modal, whose accept button is the
  whole confirmation, the same shape Delete Map uses. It names what will be
  replaced and says it cannot be undone. Like the others it cannot name the
  Post: a web view is not told the title of the post it is running inside.
- Endpoint `api/pin/import` → **`api/map/import`**; `ImportPinsReq`/`Rsp` →
  `ImportMapReq`/`Rsp`. Renaming is free — nothing persists a path — and the old
  name is a lie once the route takes a whole Map.
- ```ts
  export type ImportMapRsp = {
    pins: Pin[]
    droppedImages: number
    regions: Region[]
    summary?: string
    replaced: {summary: boolean; regions: number}
  }
  ```
  The client paints what landed rather than what it sent, the way
  `AddPinRsp`/`UpdatePinRsp` already do.
- `routeImportPins` → `routeImportMap` (`src/server/server.ts:376`) stays
  Owner-only on both kinds of Map, keeps reading the value with the shared
  reader, and keeps all-or-nothing. It writes Pins with `dbAddPins`, Regions
  with `dbReplaceRegions`, and the Summary with `dbSetSummary`/`dbClearSummary`
  — Regions and the Summary **only where the file carries them**.
- 🚨 **Absent and empty mean different things.** A file with no `regions` key
  leaves the Map's Regions alone; `"regions": []` clears them. That is the same
  distinction `summary: ''` already draws against an absent `summary`, and
  getting it wrong silently erases a Map's Regions on every v1 import.
- The Export half already refetches on a Collaborative Map before writing the
  text (`openPinsIo`, `src/client/map.ts:1173`, ADR-0019). It now needs the
  Regions to be current too, which the same refetch gives it.

🚨 **Three sentences elsewhere become false and must be corrected in the same
commit**, or the documentation actively lies:

- `CONTEXT.md` **Import** — "only ever adds: what is already on the Map is
  untouched, which is why it asks for no confirmation".
- `CONTEXT.md` **Export** — "It carries Pins and only Pins: a Map's Summary is
  not one".
- `CONTEXT.md` **Delete Map** / **Import** — "the one thing in the app that
  cannot be undone" / "Delete Map stays the one thing…". It is now one of two.

## 8. Glossary and ADRs — write these first

`0020` is the highest ADR, so the next free numbers are `0021` and `0022`.

### `CONTEXT.md`

New entry, **Region** — a named polygon an Owner traces over part of a Map,
grouping the Pins whose Location falls inside it. Drawn, never typed; its
membership is geometric and stored nowhere; written by the Owner, and by a
Moderator on a Collaborative Map; drawn in the Preview and carried by an Export.
_Avoid_: zone, area (the **Default Area** is a different thing, and the
collision is why), layer, group, tag (a Category is the tag axis, and a Region
is deliberately not one).

Amend: **Sidebar** (Regions are now its outer grouping, and its scroll moves the
camera), **Pin Card**, **Map**, **Preview** (draws polygons and still answers
nothing), **Export**, **Import**, **Delete Map**, **Moderator** (the list of
what moderating decides gains a fifth item), **Summary**, **Selected Pin**.

### ADR-0021 — "A Region is drawn, and the Sidebar's scroll drives the camera"

1. **Membership is geometric, not stored**, and why: ADR-0018's
   derive-don't-store reasoning, plus the fact that a dragged Pin then needs no
   reconciliation and a deleted Region orphans nothing.
2. **One palette across two axes** (§5) — a colour identifies within an axis,
   never across one; the swatch's shape and place are what carry the axis.
3. **The tour does not touch ADR-0006 or ADR-0007.** The camera still only pans
   and zooms; nothing new is bound to a gesture, because it is the *app* moving
   the camera in response to a scroll, not a new degree of freedom handed to the
   reader. A Preview draws polygons and still wires up no handler at all.
4. **Why a fourth toolbar face is right here when ADR-0017 refused one.** That
   refusal was about a form, which became a `<dialog>`. Tracing happens *on the
   Map* and needs controls while it runs — which is exactly what the Default
   Area face already is.
5. **`canEditSummary` → `canEditMap`** (§3), and why it is one predicate.
6. **Why the tour is wide-viewport only** (§12).

### ADR-0022 — "An Export is the whole Map, and an Import replaces what it carries"

Supersedes ADR-0020's export paragraph and amends ADR-0017. It must say plainly
what was given up — the no-confirmation property, and Delete Map's uniqueness as
the only irreversible act — and what bought it: an Export that is a real
snapshot of a Map rather than a list of its Pins, restorable in one gesture.
Record the narrow shape of the rule (Pins add, Summary and Regions replace, the
confirmation appears only when something would actually be replaced) and the
absent-versus-empty distinction, which is the part most likely to be
"simplified" into a bug.

## 9. Routes

Three, all authorized by `canEditMap`, all naming no Map — it is the Post the
request came from, exactly as every Pin route and the Summary route already
work.

| Endpoint | Req | Rsp |
| --- | --- | --- |
| `api/region/add` | `{name, polygon}` | `{region}` |
| `api/region/update` | `{id, name?, polygon?}` | `{region}` |
| `api/region/delete` | `{id}` | `{ok: true}` |

- 🚨 **Authorize before `readJson`, and reach `isModerator()` only after the
  Owner check has failed.** `routeSetSummary` (`server.ts:470-500`) already
  spells out both, with the reasoning: an unauthorized request never pays for
  buffering a body, and ADR-0019's cost rule says the Reddit round trip is paid
  on the branch that needs it, never on the common one. Copy that block rather
  than re-deriving it.
- 🚨 `EndpointMethod` is `satisfies {[E in Endpoint]: …}`, so a **missing**
  entry is a compile error — but adding an `Endpoint` without its `route()`
  case (`server.ts:190`) is not, and silently 404s.
- `normalizeRegionName` and `normalizePolygon` go beside the existing
  normalizers (`server.ts:903-982`), applying §6's caps and `isLatLng`, and
  typed-as-a-string-checked-as-though-it-were-not for `normalizeTitle`'s stated
  reason: the type is a claim about a body this route did not write.
- `GetMapRsp` gains `regions: Region[]` — **always present, `[]` when there are
  none.** Unlike `summary?`, a list has an honest empty value, so the absent-is-
  a-fact argument does not apply.
- `src/client/fetch.ts`: `fetchAddRegion`, `fetchUpdateRegion`,
  `fetchDeleteRegion`, `fetchImportMap`, in the shape of `fetchSetSummary`
  (`:158`). No `devvit.json` change — `/api/` paths are what a page may fetch;
  only menus, forms and scheduler tasks are registered there.

**Server tests**, in the shape of the `set summary:` block
(`src/server/server.test.ts:524-648`): the Owner adds, updates and deletes; a
Viewer, a Contributor and a logged-out reader are each 403; a Moderator may on a
Collaborative Map and may not on a Solo one; the Owner of a Collaborative Map
pays no moderator round trip; an over-long name, too few vertices, too many
Regions and a malformed vertex are each 400; deleting a Map leaves no
`regions:` key; an Import replaces Regions and the Summary while adding Pins;
and a v1 file imports with the Map's Summary and Regions untouched.

## 10. Storage — `src/server/db.ts`

- `regionsKey(t3)` → `` `regions:${t3}` ``, a **hash**, one field per Region id
  — mirroring `pinsKey` (`:397`), so one Region can be written without a
  read-modify-write of the whole set. It gets its own key for the documented
  reason `summaryKey` (`:412`) and `kindKey` (`:408`) do: `owner:{t3}`'s mere
  existence is what `dbIsMap` reads to tell a Map Post from an Index Post, and
  nothing may ever be overloaded onto it.
- `MapData` gains `regions: Region[]`; `dbGetMap`'s `Promise.all` (`:32`) takes
  a sixth independent read alongside the five already running together.
- `dbAddRegion`, `dbUpdateRegion`, `dbDeleteRegion` — each after
  `requireOwnerExists(t3)`, like every other writer in this file.
  `dbUpdateRegion` is a whole-object read-modify-write and deliberately
  last-write-wins, for the reason `dbUpdatePin` (`:174-198`) gives at length.
  **Do not add locking**; ADR-0019's closing paragraph is the argument.
- `dbReplaceRegions(t3, regions)` — `del` then `hSet` inside `atomically`
  (`:119`), for Import. All or nothing: a crash between the two would leave a
  Map with no Regions at all.
- 🚨 **`dbDeleteMap` (`:317`) must delete `regionsKey(t3)`.** This is the exact
  trap the Summary handoff flagged and the Summary shipped correctly — an
  orphaned Redis key per deleted Map, invisible, permanent, and impossible to
  find later. There is already a test for the Summary
  (`server.test.ts:639`); add its sibling.
- `dbGetMapMeta` (`:61`) is deliberately **not** extended, for the reason it
  already gives: it authorizes without reading what it does not need, and no
  Region route needs a Region in order to authorize.

## 11. Markup and CSS — `public/map.html`

- `#regions-btn` in `#toolbar-main`, an icon (a pentagon outline) like every
  other control in that row, hidden by `body:not(.can-edit-map)` the way
  `#pins-io-btn` is (`:295`).
- **A fourth toolbar face**, `#toolbar-region`, beside the three at
  `:1025-1065`: `Undo point` · `Done` · a close ✕. 🚨 **Add it to the
  `[hidden] {display: none}` list at `:146`** — without that line the face is
  permanently visible, because the `display: flex` rule above outranks the user
  agent's `[hidden]`. The file says so in as many words; it is still the easiest
  line in this step to miss.
- `#regions-dialog` — the list of Regions (swatch, name, pin count, **Reshape**,
  **Rename**, **Delete**) plus a **Draw a new region** button. Modelled on
  `#pins-io-dialog`.
- `#region-dialog` — one name field, serving both a new Region and a Rename.
- CSS: `.region-group`; `.region-group-heading` (sticky like
  `.pin-group-heading` at `:442`, but a level above it); `.region-swatch`
  (squared off, `border-radius: 0.15rem`, so it reads as a different axis from
  the round `.category-swatch` at `:520`); `.region-vertex` (a small draggable
  handle); `.region-label` (reuse `.pin-label`'s treatment at `:875`).

## 12. The client — `src/client/sidebar.ts` and `src/client/map.ts`

### The Sidebar

Regions become the **outer** grouping and Categories the inner one.

- `SidebarState` gains `regions`, `regionColors`, `activeRegionId`, and
  `pinRegion: Map<string, string>`. 🚨 **Membership is computed once in
  `render()` and passed in**, never computed inside `sidebar.ts`. That module
  stays pure display — the same rule `pinCapabilities` (`:113`) already follows,
  and the reason `canEditPin` runs in exactly one place on the client.
- `renderSidebar` (`:164`): when `state.regions.length === 0` the output is
  **exactly what it is today**, category groups and all. That is the whole
  compatibility story for every Map that already exists.
- With Regions: one `<section class="region-group" data-region-id>` each, a
  sticky heading carrying the squared swatch, the name and the pin count, and
  then the existing category grouping *within* it — `groupPinsByCategory` and
  `showsHeadings` unchanged, called once per Region. Pins in no Region go in a
  final group headed **Elsewhere**.
- A heading click calls a new `handlers.onSelectRegion(id)`.
- New export `scrollRegionIntoView(regionId)` beside `scrollPinIntoView`
  (`:222`), for a click on a polygon.

### Drawing the polygons 🚨

🚨 **Nothing in this app has ever added a source or a layer.** Every marker is a
DOM `Marker`, which needs no style to exist. `map.addSource()` before the style
has loaded **throws**, and `init()` awaits `fetchGetMap` (`map.ts:386`)
immediately, so in practice the data arrives first and the temptation is to draw
straight away. Await `map.once('load')` before the first `addSource`, and keep a
`regionsReady` guard so a later `renderRegions()` cannot run ahead of it.

One GeoJSON source, `regions`, refreshed with `setData`, and two layers beneath
the markers: `regions-fill` (`fill-opacity` 0.12, 0.24 for the active Region)
and `regions-line` (2px, the same colour), both reading `color` off the feature.

🚨 **Do not use a `symbol` layer for the labels.** A symbol layer needs glyphs
from the style's font stack through the proxy, and a font name OpenFreeMap
Bright does not have fails *silently* — no labels, no error, nothing in the
console. Use a DOM `Marker` at the polygon's centroid carrying a
`.region-label`, exactly as `createMarker` (`:610`) hangs a `.pin-label` off a
Pin. It is also then a real click target, and it is themed by the CSS that
already exists.

Clicking a polygon: `map.on('click', 'regions-fill', …)` → `selectRegion(id)` →
`scrollRegionIntoView(id)`. 🚨 **Register this before the bare `map.on('click')`
at `:463`**, which light-dismisses the Sidebar on a narrow viewport, and return
early there when the click landed on a Region — otherwise tapping a polygon on a
phone closes the Sidebar it was meant to scroll.

**The Preview draws polygons, fills and labels, and wires up nothing.** `init()`
returns at `:421`, before any handler, so this needs no check of its own — the
same way the Summary needed none. `fitToPins` (`:571`) frames Pins **and**
Region bounds, so a Map whose Regions reach past its Pins still opens on all of
it.

### Tracing and reshaping

`ToolbarFace` (`:276`) gains `'region'`. The face is entered from the Regions
dialog and behaves like Pin Drop: each click on the Map pushes a vertex, the
ring previews live through the same GeoJSON source, `Undo point` pops one, and
`Done` — enabled at three vertices — opens `#region-dialog` for the name.

An armed Pin Drop and this mode are mutually exclusive. `setToolbarFace`
(`:778`) already calls `stopDroppingPin()` whenever the face changes; the new
face has to be added to that rule, and leaving the region face must clear its
in-progress ring the way leaving the area face clears its status line.

**Reshape** re-enters the same face with the Region's existing vertices as
draggable `.region-vertex` markers. `dragend` writes the polygon through
`fetchUpdateRegion` and puts the vertex back where it came from if the write
fails, exactly as `movePin` (`:711`) does for a Pin.

### The tour 🚨

State: `activeRegionId: string | undefined` and `tourStarted: boolean`.

- An `IntersectionObserver` over the `.region-group` sections, root `#sidebar`,
  `rootMargin: '0px 0px -60% 0px'`; the topmost intersecting section is active.
- 🚨 **The observer fires immediately on `observe()`.** Ignore every callback
  until `tourStarted`, which a one-shot `scroll` listener on `#sidebar` sets.
  That is literally what "once the user begins scrolling" asks for, and it is
  what keeps the landing state — all polygons, all Pins, fit to everything —
  from being destroyed on first paint.
- 🚨 **Programmatic scrolls must not drive the tour.** `scrollPinIntoView` is
  called after a save, after an edit, and on selecting a marker (`:692`,
  `:1053`, `:1078`). It scrolls the Sidebar smoothly, which would fire the
  observer and yank the camera somewhere the reader never asked to go. Suppress
  the observer for ~700 ms around every programmatic scroll.
- On a genuine change: `setActiveRegion(id)` → `render()` (the markers narrow) →
  `map.fitBounds(areaBounds(regionBounds(region)), {padding: fitPadding,
  duration: 600})`. Scrolling back above the first section clears the active
  Region and refits everything.
- 🚨 **Compose with the Category filter, do not replace it.** The visible Pins
  are `filterPins(pins, activeCategory)` (`:479`) *and then* narrowed by
  `activeRegionId`. `resolveSelection` (`sidebar.ts:57`) already drops a
  Selected Pin the visible set no longer holds, which is what keeps the Map and
  the Sidebar from disagreeing when the tour moves on.
- **A narrow viewport does not tour.** The Sidebar overlays 85% of the Map there
  (`map.html:404-417`), so a camera move nobody can see would leave the Map
  silently somewhere else by the time the panel is dismissed. Gate the observer
  on `!isNarrowViewport()` (`sidebar.ts:147`), and re-evaluate on resize;
  tapping a heading or a polygon still zooms.
- Honour `prefers-reduced-motion`: `duration: 0` rather than 600.

## 13. Done when

- `npm test` passes — types, lint, unit, build.
- A Fiji polygon (crossing the antimeridian) answers containment correctly, in
  a test.
- Adding a Region repaints no existing Region's colour, in a test.
- A Moderator can draw a Region on a Collaborative Map and cannot on a Solo one,
  in `server.test.ts`; a Contributor and a logged-out reader are both 403.
- Deleting a Map leaves no `regions:` key behind.
- A v1 export still imports, adds only Pins, and asks for no confirmation.
- A v2 export carrying a Summary and Regions, imported into a Map that has both,
  asks first and then replaces them.
- A Map with no Regions renders a Sidebar identical to today's.
- A Preview draws polygons and answers no gesture; the feed still scrolls past
  it.
- On a phone, scrolling the Sidebar moves no camera.

## 14. Open questions — flagged, not blocking

- **Phone behaviour** (§12) is a judgement call made here, not a settled
  requirement. Giving a phone the tour would mean the Sidebar becoming a bottom
  sheet over a visible Map, which is a larger design change and should be its
  own piece of work.
- **Regions on an Index Post Entry** (`· 3 regions`) is deliberately left out.
