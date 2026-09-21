# The print view is a standalone page fed by an Export

A Map on paper wants what the Sidebar already has — every Pin, grouped by Region
and Category — plus a full-page map for each Region. The obvious build is a
print button in the Map Post that lays the page out and calls `window.print()`.
That cannot work here, and finding out why took several attempts, each recorded
so nobody tries them again.

**A Map Post cannot print itself.** A web view is a sandboxed frame; from inside
it `window.print()` returns without throwing and does nothing — no dialog, and
neither `beforeprint` nor `afterprint` fires. Every way of handing the browser
a document to open instead failed the same way: a `blob:` URL by anchor
download, by `window.open` and by `target=_blank`, and a `blob:` or `data:` URL
given to Devvit's `navigateTo`. Blob storage is not an option either; its
permission is described by Devvit's own schema as "not yet publicly available".

**What did work was `media.upload`,** which turns a data URL into a Reddit CDN
image that `navigateTo` will open. It was rejected because an image is one page:
a print job of N pages would be N uploads, N tabs and N separate prints, each
permanent on Reddit's CDN with no way to delete it, and the text would be
raster.

**So the print view is not in the Map Post at all.** It is a static page, built
from `src/site/` and published to GitHub Pages, where `window.print()` is an
ordinary top-level call. An Export already carries everything it needs — Pins,
Regions and the Summary, ADR-0022 — so the page takes the JSON pasted into it
and nothing else: no Reddit, no server, no account, and nothing pasted leaves
the browser. It reuses the app's own reader (`parseMapFile`) and its colour,
Region, grouping and Markdown code rather than restating them, so a Map reads
the same on paper as it does in the Sidebar.

**Each map page is drawn one at a time and kept as an image.** A browser allows
only a handful of WebGL contexts at once and a Map may have two dozen Regions,
so a single MapLibre instance draws a page, its canvas is captured, and the
instance is removed before the next. The captured image is what prints, which is
also why a page cannot come out blank the way a live WebGL canvas sometimes does.
The numbered markers and Region labels are laid over it as elements positioned as
a fraction of the frame, so they keep their place at any paper size.

**Markers are numbered, and the numbers restart in every Region.** A page has no
hover and no click, so a marker has to say which card it is; the number is the
card's, and a Region's map shows only that Region's Pins, so a reader only ever
matches within one page. The overview shows plain dots instead, because forty
numbers on one map is noise.

An Export carries no ids and no ages, so the page makes both up from the order
the file lists things in — the order an Import would have stamped them in — which
is what keeps a Category's colour on paper the colour it has on the Map.

Not done, deliberately: a link from the Map Post to the page. It would be a
`navigateTo` to an external URL, and the app has no setting for where the page
lives yet.
