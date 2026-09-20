# Handoff — Map Summary, and Markdown in Pin descriptions

**Status:** designed, not started. No code written.
**Delete this file once the work has shipped.**
**Branch:** `map-summary-and-markdown`, cut from `in-flight-work` (`a953862`).
**Prerequisite reading:** `CLAUDE.md` → `docs/agents/domain.md`, then `CONTEXT.md`,
then ADRs `0019`, `0017`, `0015`, `0007`.

> Items marked 🚨 are ones that will ship silently broken if implemented the
> obvious way. Read those before writing the code they touch.

**Suggested order:** §6 (glossary + ADR-0020) → Step 1 (`canEditSummary` + its
table test) → Step 2 (`markdown.ts` + its test) → Step 3 (storage) → Step 4
(route) → Step 5 (client). The predicate and the renderer come first because
every later step is asserted against them.

---

## 1. Context

A Map Post today is a Map, a set of Pins, and nothing that speaks for the Map as
a whole. `CONTEXT.md` calls the Sidebar "the only place a Pin's details are
read" — there is no place at all where the *Map's* own details are read. A
subreddit that builds a forty-Pin Collaborative Map has nowhere to say what it
is for, what belongs on it, or who to ask.

Separately, every piece of user text in this app is rendered with
`textContent` — `sidebar.ts:316` for a Title, `:344` for a byline, `:358` for a
description. That is safe and it is also flat: a description cannot carry a
link, a list, or an emphasised word.

**Intended outcome.** A Map gains an optional **Summary**: free text at the top
of the Sidebar, above the Pin Cards, written by whoever may write it and read by
everyone. Both that Summary and every Pin's description render a small Markdown
subset. Nothing else about a Map Post changes.

## 2. Decisions already made — do not relitigate

These four were asked and answered before this document existed.

1. **The Summary lives at the top of the Sidebar**, above the Pin Cards — not in
   its own panel over the Map, and not on an Index Post's Entry. The Sidebar is
   already the surface where a Map's contents are read; making it the place the
   Map's own account of itself is read is the smallest new idea available.
2. **Owner, plus Moderators on a Collaborative Map.** See §3 — this deliberately
   differs from `canEditPin`, and the difference is the point.
3. **A small hand-rolled Markdown subset**, not a library. No new dependency, and
   safe by construction rather than by filtering — see §4.
4. **Not in the Preview.** A Preview stays the Map alone, per ADR-0007.

## 3. Who may write a Summary 🚨

New predicate, beside the two already in `src/shared/permissions.ts`:

```ts
export function canEditSummary(access: MapAccess): boolean {
  if (!access.userId) return false
  if (!access.collaborative) return access.userId === access.ownerId
  return access.userId === access.ownerId || access.isModerator
}
```

🚨 **This contradicts `canEditPin` on the Owner question, on purpose.** On a
Collaborative Map `canEditPin` gives the Owner *no* power over a Contributor's
Pin (`permissions.ts:50`, ADR-0019). `canEditSummary` gives the Owner full power.
Side by side these read as an inconsistency, and the next reader will "fix" one
to match the other. They must not.

ADR-0019 already drew the line this falls on: *"ownership here is of the Post,
not of what other people put on it."* A Pin is what someone else put on the Map.
A Summary is the Map's own account of itself — it is the Post, the same way the
title and the byline are, and the Owner owns the Post. Nobody else's work is
being taken when the Owner rewrites it, because the Summary was never anyone
else's work.

A Moderator can too, for the reason ADR-0019 gives them power over a Pin: a
subreddit needs someone able to take down abusive text without deleting the Map
underneath it. A Summary is more visible than any single Pin, so leaving it as
the one piece of user text on a Collaborative Map with no takedown path would be
the one hole in that story.

**On a Solo Map, moderating grants nothing** — the first branch returns before
`isModerator` is ever consulted. That is `CONTEXT.md`'s Moderator entry
("moderating grants nothing over a Solo Map") and it is load-bearing.

The logged-out guard goes first, matching `canEditPin`'s ordering. There is no
`authorId` here for `undefined === undefined` to go wrong on, so the hazard is
not literally the same one — keep the ordering anyway, because a reader comparing
the three predicates should find one shape, not two.

## 4. The Markdown renderer 🚨

New file `src/client/markdown.ts`. **Not `src/shared/`** — `permissions.ts` and
`pins-file.ts` live there because client and server must ask an identical
question of identical facts. Nothing on the server renders Markdown; it stores
the source text and hands it back. Putting this in `shared/` for symmetry would
claim a constraint that does not exist.

### It returns nodes, never a string

```ts
export function renderMarkdown(
  source: string,
  handlers: {onOpenLink(url: string): void},
): DocumentFragment
```

🚨 **`innerHTML` must never appear in this file, and nothing may return an HTML
string.** This is the whole security argument and the entire reason no sanitizer
is needed: the renderer builds `document.createElement` nodes and sets
`textContent` on the leaves, so the set of elements that can ever exist is the
set this file names. There is no parse step for a payload to survive, and
therefore nothing to filter. A future change that switches to building a string
and assigning `innerHTML` reintroduces XSS *and* silently removes the reason the
code has no sanitizer.

### The subset

Supported: paragraphs (blank-line separated), `**bold**` → `<strong>`,
`*italic*` and `_italic_` → `<em>`, `` `code` `` → `<code>`, `- ` / `* ` bullets
→ `<ul><li>`, `1. ` → `<ol><li>`, `[text](url)` → link, single newline within a
paragraph → `<br>`.

Not supported, and rendered as the literal characters typed: headings, images,
blockquotes, tables, reference links, autolinks, and raw HTML. An unterminated
`**` is two asterisks, not an error.

### Links 🚨

Two traps, both of which look fine in a browser and fail on Reddit.

🚨 **The scheme must be checked.** `[click](javascript:alert(1))` must not become
an `href`. Reuse `isHttpUrl` from `src/shared/pins-file.ts:254` — it is already
exported and already the rule `normalizeLink` applies to a typed link. Do not
write a second URL check; two will drift. A link whose URL fails the check keeps
its text and loses its link, rather than disappearing.

🚨 **A bare `<a href>` does not work in this app.** The Pin Card's existing link
does not navigate — `sidebar.ts:327-331` calls `ev.preventDefault()` and routes the
click to `handlers.onOpenLink(url)`, which reaches Devvit's `navigateTo` in
`map.ts`. A web view is a sandboxed frame; an ordinary href either does nothing
or tries to break out of it. Every link this renderer produces must take the
same path, which is why `onOpenLink` is a parameter rather than something
`markdown.ts` reaches for itself — it keeps this file free of app knowledge, the
same way `sidebar.ts` stays pure display.

## 5. What changes, file by file

### Step 1 — the predicate

- `src/shared/permissions.ts`: add `canEditSummary` exactly as §3 gives it.
- `src/shared/permissions.test.ts`: add an exhaustive table in the shape of the
  existing `canEditPin` test (`:73`) — collaborative × isModerator × who is
  asking. It must assert the two rows that carry the design: `[false, true,
  OTHER, false]` (a Moderator gets nothing on a Solo Map) and `[true, false,
  OWNER, true]` (the Owner keeps the Summary on a Collaborative Map even though
  they have no power over its Pins).

### Step 2 — the renderer

- `src/client/markdown.ts`: per §4.
- `src/client/markdown.test.ts`: the subset, and the refusals — a `javascript:`
  link renders as text, `<script>` renders as literal characters, an unterminated
  `**` stays two asterisks. Node's test runner, `node:assert/strict`, same
  imports as `permissions.test.ts:1-2`.

  Note the test needs a DOM. The other client tests in this repo
  (`sidebar.test.ts`, `category-color.test.ts`) only cover the pure functions and
  never touch `document`. Keep that true: export the parse step as a pure
  function returning a small node-description tree and test *that*, with the
  DOM-building step a thin uninteresting layer over it. Do not add a DOM shim to
  the test setup for this.

### Step 3 — storage

- `src/server/db.ts`:
  - `summaryKey(t3)` → `` `summary:${t3}` ``, absent when unset. Modelled on
    `kindKey` (`:383`), including its reasoning: it gets its own key rather than
    riding on `owner:{t3}`, whose *mere existence* is what `dbIsMap` reads to
    tell a Map Post from an Index Post.
  - `MapData` gains `summary?: string`; `dbGetMap` reads it in the existing
    `Promise.all` (`:30`) — a fifth independent read alongside four that already
    run together, which is the same trade `routeGetMap` already makes for the
    Default Area.
  - `dbSetSummary(t3, summary)` / `dbClearSummary(t3)`, both after
    `requireOwnerExists(t3)` like every other writer here.
  - `dbDeleteMap` (`:293`) must delete `summaryKey(t3)` too. 🚨 Forgetting this
    leaves an orphaned Redis key per deleted Map — invisible, permanent, and
    impossible to find later.
  - `dbGetMapMeta` is deliberately **not** extended. It exists to authorize
    without reading anything it does not need (`:54`), and the Summary route
    authorizes without reading the Summary.

### Step 4 — the route

- `src/shared/api.ts`:
  - `SetSummaryReq = {summary: string}`, `SetSummaryRsp = {summary?: string}`.
    Answering with the stored value — absent when cleared — so the client paints
    what landed rather than what it typed, the way `AddPinRsp`/`UpdatePinRsp`
    return the server's Pin.
  - `Endpoint.SetSummary = 'api/summary/set'`, plus its `EndpointMethod` entry
    (`POST`). 🚨 `EndpointMethod` is `satisfies {[E in Endpoint]: ...}`, so a
    missing entry is a compile error — but adding the endpoint without the
    `route()` case is not, and silently 404s.
  - `GetMapRsp` gains `summary?: string` — **absent, not `''`**, matching
    `defaultArea` and `IndexEntry.collaborative`. Absent is a fact; empty string
    is a claim that there is a Summary and it is blank.
  - `MapSummaryMaxLen = 4000`, beside `PostTitleMaxLen`. It goes here rather than
    in `pins-file.ts` because a Summary is not a Pin and never appears in an
    Export; both ends need the number, which is what `api.ts` is for.
- `src/server/server.ts`:
  - `routeSetSummary`, `AnyRsp` union member, and the `route()` case.
  - Authorization, in this order:

    ```ts
    const t3 = requirePostId()
    const meta = await dbGetMapMeta(t3)
    if (!meta) throw new HttpError(404, 'map not found')
    if (!meta.collaborative) requireSoloOwner(meta)
    else if (context.userId !== meta.ownerId && !(await isModerator())) {
      throw new HttpError(403, 'not authorized')
    }
    const req = await readJson<SetSummaryReq>(reqMsg)
    ```

    🚨 **Authorize before `readJson`.** `routeUpdatePin` reads the body first
    only because it needs `req.id` to find the Pin (`:303`). This route needs no
    id, so it can do what `requireSoloOwner`'s doc comment (`:939`) says is the
    point: an unauthorized request never pays for buffering a body.

    🚨 **`isModerator()` is only reached when the Owner check has already
    failed.** That is ADR-0019's cost rule — a Reddit round trip on the branch
    that needs it, never on the common one. Writing it as
    `if (!(await isModerator()) && context.userId !== meta.ownerId)` is the same
    boolean and pays the round trip on every Owner edit.
  - `normalizeSummary`: trim, then `capped(trimmed, MapSummaryMaxLen, 'summary')`.
    Empty clears — store nothing and answer `{}`, the idiom
    `routeUpdatePin:312-315` already uses for an emptied description, and which
    `server.test.ts:661` already tests for Pins.
- `src/client/fetch.ts`: `fetchSetSummary`, in the shape of `fetchSetDefaultArea`
  (`:139`). No `devvit.json` change — `/api/` paths are what a page may fetch;
  only menus, forms and scheduler tasks are registered there.

### Step 5 — the client

- `public/map.html`, inside `#sidebar` and **as a sibling before `#pin-list`**:

  ```html
  <section id="map-summary" hidden>
    <div id="map-summary-body"></div>
    <button id="map-summary-edit" type="button" hidden>Edit summary</button>
  </section>
  ```

  🚨 **It must not go inside `#pin-list`.** `renderSidebar` opens with
  `listEl.replaceChildren()` (`sidebar.ts:166`), so a Summary living in there is
  destroyed on every filter change and every Pin edit.

- A `#summary-dialog` beside the three that exist, with a `<textarea>`, Save,
  Cancel, and Clear. A dialog rather than an inline textarea because that is this
  app's idiom for editing text (`#pin-dialog`, `#pins-io-dialog`), and the edit
  affordance sits in the Summary block rather than the toolbar because the
  toolbar row is already full — `map.html:354-355` says so in as many words, and it
  is why the status line lives over the Map.

- `src/client/map.ts`:
  - `init()` — add `document.body.classList.toggle('can-edit-summary',
    canEditSummary(access))` to the block at `:367-372`. The positive-capability
    pattern is fail-closed by default (`map.html:278-291`): with no class added,
    the markup already hides the control.
  - Render the Summary after `initSidebar(...)` and before `render()`.
  - 🚨 **The Preview needs no work and must be given none.** `init()` returns at
    `:382-388`, before `initSidebar`, so a Preview never reaches any of this.
    Adding the Summary inline would reopen ADR-0007.
  - Empty states: no Summary and the reader may edit → the section shows "Add a
    summary". No Summary and they may not → the section stays `hidden` entirely,
    rather than showing a Viewer an empty box.

- `src/client/sidebar.ts:355-359` — the Pin description:
  - `document.createElement('p')` becomes a `div`. 🚨 A `<p>` may not contain a
    `<ul>` or another `<p>`; because we append nodes rather than parse HTML the
    browser will not hoist them, so this stays invalid-but-working and will
    confuse whoever next reads the DOM.
  - `.textContent = pin.description` becomes
    `.append(renderMarkdown(pin.description, {onOpenLink: handlers.onOpenLink}))`.
  - 🚨 **Drop `white-space: pre-wrap` from `.pin-card-description`**
    (`map.html:559`). The renderer now produces the line breaks; leaving the CSS
    doubles every one of them.

## 6. Glossary and ADR

### `CONTEXT.md`

New entry, **Summary** — the Map's own account of itself, optional, at the top of
the Sidebar, Markdown, written by the Owner (and by a Moderator on a
Collaborative Map), read by everyone, absent from a Preview and from an Export.
_Avoid_: description (that word is a Pin's field, and the collision is the reason
this one is called a Summary), about, intro, blurb.

Amend: **Sidebar** (it is now where the Map's own details are read, not only a
Pin's), **Pin** (its description is Markdown), **Pin Card**, **Moderator** (the
list of what moderating decides gains a fourth item), **Preview** (no Summary),
**Export** (carries Pins, and explicitly not the Summary).

### ADR-0020 — "A Map has a Summary, and its text is rendered to nodes"

Next free number; `0019` is the highest. Three things belong in it, each being
something a future reader would otherwise reverse:

1. Why `canEditSummary` gives the Owner what `canEditPin` withholds (§3).
2. Why the renderer builds nodes instead of a string, and why that is what
   replaces a sanitizer (§4).
3. Why an **Export does not carry the Summary.** 🚨 The obvious move is to add a
   `summary` field to `PinsFile` "for completeness." It breaks Import's central
   promise: `CONTEXT.md` says an Import *"only ever adds: what is already on the
   Map is untouched, which is why it asks for no confirmation."* A summary in the
   file would make Import overwrite something, which costs the no-confirmation
   rule and makes Import the second irreversible act in an app that has exactly
   one. `toPinExport` (`pins-file.ts:160`) is already an allowlist for this class
   of reason — keep the Summary out of it and say why here.

Also record, without reopening: staleness is unchanged. A Moderator's edit does
not appear on an open page, and an Owner and a Moderator saving at once is
last-write-wins — the same posture as `dbUpdatePin` (`db.ts:150-162`) and for the
same reason. Do not add locking; ADR-0019's closing paragraph is the argument.

## 7. Done when

- `npm test` passes (types, lint, unit, build).
- `canEditSummary`'s table covers collaborative × moderator × who, including the
  two rows named in Step 1.
- A `javascript:` link in a Summary renders as text, in a test.
- A Moderator can edit a Collaborative Map's Summary and cannot edit a Solo
  Map's, in `server.test.ts`.
- A Contributor is refused (403), and so is a logged-out reader.
- An over-length Summary is refused (400); an empty one clears.
- Deleting a Map leaves no `summary:` key behind.
- A Preview shows no Summary.
