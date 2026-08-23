# The Default Area is framed, not named

A moderator sets where their subreddit's empty Maps open by pointing a real Map at it: open any Map Post full screen, pan and zoom until the screen is showing what you mean, press **Use this view**. What gets stored is the rectangle that was on the screen. Nothing is typed, nothing is searched, and nothing is resolved.

This keeps everything ADR-0012 decided about *what* a Default Area is — a rectangle, live-read, one per install, Pins always winning — and replaces only *where the rectangle comes from*, which was a Google Places viewport and is now the camera.

**The forcing move was ADR-0013, but the result is better anyway.** Naming a place needed a search, and the search made this app guess which Springfield a subreddit meant; ADR-0012 spent a second form on refusing to guess. A framing cannot be ambiguous, because the moderator is looking at the answer while they choose it. It also removes the failure mode that ADR-0012 worried about most — that the whole setting became unreachable when Google refused a key — since there is nothing left to be unreachable.

**A picker needs a Map, and a menu item cannot have one.** Devvit's subreddit menu items can only raise a native Reddit form; there is no way to open a web view from one. So the picker lives where a Map already is: the toolbar of a Map Post, full screen, moderators only. Both subreddit menu items for this are gone, and with them `routeMenuDefaultArea`, both forms, and the two-step search-then-pick flow.

That makes this the only control in a Map Post's toolbar that answers to moderating the subreddit rather than to owning the Map, and the two are deliberately unrelated: a moderator uses it on whichever Map Post they happen to have open, including someone else's. Nothing about that post changes — panning a Map is not editing it, and the moderator gains no power over its Pins.

**Show, don't tell.** ADR-0012's `MapArea` carried a `name`, because a moderator who typed "Hawaii" needed to be told that "Hawaii, USA" was what got stored. There is no name here and no need for one: opening the picker frames the Map on the stored area, so what is set is *seen*. `MapArea` collapses into `MapBounds`, and `parseMapArea` into `parseMapBounds`.

The framing on open uses no padding, unlike every other `fitBounds` in the client. What fills the screen has to be exactly what would be stored, or opening the picker and pressing the button without touching anything would widen the area by the padding — every time. An empty Map still opens on the padded version, the same breathing room a Map full of Pins gets. The framing also arrives rather than flies: an animated camera is one that is still moving while the button that reads it off already has focus.

**A stored area from the old version is unreadable on purpose.** Redis still holds `{"name": …, "bounds": {…}}` for any subreddit that set one, and those four numbers are a Google viewport. `parseMapBounds` does not accept that shape, so such a subreddit has no Default Area until a moderator frames one — the coordinates stop being used the moment this ships, without a migration that has to run. Clear on the picker is what actually removes the value, since it is a delete rather than a read-modify-write and so reaches a value nothing can parse.

This is the opposite call from the one ADR-0013 makes about Pins, and the difference is whose work it is. A Pin is content someone made; a Default Area is a setting, replaceable in four gestures, whose loss costs a subreddit one slightly worse first paint.

**Two routes, and the moderator check is load-bearing.** `api/area/set` and `api/area/clear` are `/api/` paths, which a web view may fetch — unlike the `/internal/on/form/…` endpoints the forms used, where ADR-0012 could lean on `devvit.json`'s `forUserType` and the platform being the only caller. Here `isModerator()` on the server is the whole of what stops a Viewer moving every Map on the subreddit, so both routes check it, and the client's hidden button is decoration.

**The moderator answer is not free, so the Preview does not buy it.** Whether a reader moderates costs a Reddit round trip. A Preview renders every time the post scrolls past in a feed and has no toolbar to put the control in, so `api/map` only resolves it when asked with `?full=1`, which the full screen reading sends and the Preview does not.

**Reading the camera back.** MapLibre reports a view panned across the antimeridian with longitudes past ±180 — `182.65` rather than `-177.35` — and a fully zoomed-out view as a range wider than 360°. Neither is storable, so `viewBounds()` spells the first by wrapping into `[-180, 180)`, which is what leaves an area over Fiji with a west edge numerically east of its east edge, exactly as ADR-0012's reader expects; and the second as the whole world outright. Verified in a browser: a stored Fiji rectangle of `west: 176.9, east: -178.5` frames, reads back, and re-stores as the same two numbers, with only the latitudes widening to the viewport's aspect ratio.

A future reader should not add a text field back to this because framing on a phone is fiddly, without first checking where the names would be resolved.
