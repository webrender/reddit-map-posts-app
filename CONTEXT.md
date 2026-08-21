# Map Posts

A Reddit app (Devvit) that lets a subreddit member create a Map Post containing an interactive Map. The creator adds Pins to the Map; anyone viewing the Map Post can see the Pins, but only the creator can edit them. A moderator can also create an Index Post, which lists every Map on the subreddit worth listing.

## Language

**Map Post**:
A Reddit post (submission) that hosts exactly one Map. Each Map Post is a self-contained, single-player session — one Post, one Map, one Owner. Its Reddit-facing title is the Owner's to choose, in the New Post Form, before the Post exists. A Map Post has two readings: inline, where Reddit gives it a slot in the feed and forbids it to answer a gesture, and full screen, where it has the device to itself. Inline it shows a Preview; full screen it shows the whole interface. Both are the same page asking at load which of the two it is, since Reddit builds a fresh web view for each — so crossing between them reloads the Map and opens it framing every Pin, exactly as first paint does.
_Avoid_: Game, session, Post unqualified (there are two kinds now; see Index Post)

**Index Post**:
A Reddit post that lists the subreddit's Map Posts rather than hosting a Map of its own — meant to be pinned at the top of a community, though the app never pins it. Only a moderator can create one, and a subreddit may hold any number: they are all the same page reading the same Redis, so two of them can never disagree. Unlike a Map Post it has one reading, not two — it never opens full screen, so the whole app is whatever fits inline, which is where the Listing's pagination comes from. See ADR-0010.
_Avoid_: Directory, hub, splash (Devvit's deprecated name for a launch screen)

**Delete Index Post**:
A moderator's way to take down the Index Post they are looking at, from a control in its header — the same gesture as Delete Map, on the other post type. Only a moderator of the subreddit sees it, and only a moderator may run it: an Index Post is owned by no one, so moderating here is what stands in for owning. It takes the Index Post and nothing else — the Maps it listed, and the Map Posts hosting them, are untouched, because an Index Post owns nothing and is owned by nothing, and nothing about it is written to Redis to clean up. The route refuses a post that is a Map before it looks at anything else, so it can never become a way around a Map's Owner. Like Delete Map it asks first, through Reddit's own modal, and it cannot be undone.
_Avoid_: Reset, clear, purge (all suggest the Maps go too, and they do not); deleting every Index Post at once (there is no such action — one post, one control)

**Listing**:
The Index Post's page of Map Posts: five Entries at a time, filtered by the Search Query, ordered by the Sort, and moved through a page at a time because nothing inline may scroll. It shows a Map Post only once that Map has a Pin on it and only while its Reddit post still exists — a Map with nothing on it has nothing to browse to, and a deleted one has nowhere to go.

**Entry**:
One Map Post's row in the Listing: its title on one line, then `u/{Owner} · {n} pins · {score} ▲ · {age}`. The whole row is tappable and goes to that Map Post; the counts are decorative. Its score is the Map Post's Reddit upvote count, and is omitted rather than shown as zero when Reddit cannot be reached. See ADR-0011.
_Avoid_: Row, card, result

**Sort**:
Which order the Listing is in: **Newest** by default, or **Top** — all-time upvotes, ties broken by newest. Both are a toggle in the Index Post's header, and neither is remembered: every load of an Index Post starts at Newest, page one, with no Search Query.

**Search Query**:
What a reader types into the Index Post's one field, matched as a case-insensitive substring against a Map Post's title and its Owner's username — never against the Pins inside it. It filters the whole subreddit's Maps rather than the page on screen, which is why the Listing is assembled on the server. Changing it returns to page one.

**Create a Map**:
The Index Post's one accented control, at the foot of the Listing in the same accent, shape and size as the Open Map button on a Preview. It shows the New Post Form in place, without leaving the Index Post, and goes to the new Map Post once Reddit has it. A logged-out reader sees it and is asked to log in on tapping it, because a control that isn't there teaches no one that the app exists.

**Delete Map**:
The Owner's way to take their Map Post down, from the toolbar, full screen only — a Viewer never sees the control and a Preview has no toolbar to put it in. It asks first, through Reddit's own modal, whose Delete button is the whole of the confirmation: the modal is the deliberate step, and a field inside it would be a second one for the same decision. Neither this modal nor Delete Index Post's names the post it is about, because a web view is not told the title of the post it is running inside. It cannot be undone: the Map Post goes, and the Pins go with it. Reddit is asked first and the app forgets the Map only once Reddit has actually taken the Map Post, so a refusal leaves a Map that is whole and still listed rather than a Map Post standing over pins that have already been erased. Afterwards there is nowhere to return to, so it leaves for the subreddit.
_Avoid_: Remove (that is the moderator's action, and Reddit's own; it hides a Map Post without touching the Map)

**New Post Form**:
The form Reddit shows when someone asks for a new Map Post, asking for its title and nothing else. It is Reddit's own modal, not part of the Map — the app describes the fields and Reddit renders, validates, and submits them — so it is the one place in the app where a Map Post's title can be set, and there is no Map Post yet to abandon if the form is cancelled. Its title field arrives pre-filled with "{Owner's username}'s Map", which is what the Map Post used to be called unconditionally. It is reached two ways, from the subreddit menu and from Create a Map on an Index Post, and it is the same form both times. The Index Post has a form of its own, asked of the moderator creating it and pre-filled with "r/{subreddit} Community Maps".
_Avoid_: Menu, dialog, modal (all name the mechanism; the form is the setup step)

**Preview**:
The Map Post as it is read inline: the Map alone, framed on every Pin, with labelled markers, no toolbar, no Sidebar, and no Selected Pin. It is locked — no click, drag, or pinch reaches it — because inline the gesture belongs to the feed the Map Post is scrolling past, and a Map Post that answers one steals it. Its single control, Open Map, floats over the Map and opens the Map Post full screen where everything else is. An Index Post lives under the same rule and answers it differently: it has no full screen to send anyone to, so it stays tappable and paginates instead. See ADR-0007 and ADR-0010.
_Avoid_: Splash, launch screen (Devvit's own name for a native screen that can precede a web view; a Preview is the web view, showing the real Map)

**Map**:
The interactive map rendered inside a Map Post, built with MapLibre GL using OpenFreeMap's Bright style. A Map holds zero or more Pins. It is always seen from directly overhead and north-up: one finger always pans, two fingers zoom, and the camera does nothing else — outside a Preview, where it does nothing at all.

**Pin**:
A single marked location on a Map. Requires a Location and a Title; Category, description, link, and an uploaded image are all optional. A Pin remembers which of the two add-paths it came from, and that is the only thing the paths leave behind: a Place Search Pin's Location is the place's own and can't be moved afterwards, while a Manual Pin Drop Pin's Location was chosen by the Owner and can be re-chosen by dragging. Everything else about the two is the same.
_Avoid_: Marker, point

**Place Search**:
The primary way an Owner adds a Pin: an autocomplete search backed by the Google Places API. Only the place's name and lat/lng coordinates are fetched from Google — everything else on the resulting Pin is entered manually — to keep API usage minimal. It works only where a moderator has stored that subreddit's own API key (see ADR-0009); without one, Manual Pin Drop is the only add-path.
_Avoid_: Geocoding (this app never fetches full place details, just autocomplete name + coordinates)

**Manual Pin Drop**:
The secondary way to add a Pin: the Owner clicks directly on the Map to place a Pin at that location, then types its Title by hand (no name is auto-filled). Both add-paths are reached the same way — one control on the toolbar replaces it with a row holding the Place Search field beside the button that arms the drop — so adding a Pin is one decision (which path) rather than two unrelated controls, and a Viewer's toolbar loses both by losing one.

**Places API Key**:
The Google Places API key that makes Place Search work, one per subreddit, supplied by a moderator through a masked form and stored where only the server can reach it. It travels in one direction: the app can tell you whether a key exists, never what it is, and replacing or removing it is the only thing a moderator can do to one. See ADR-0009.
_Avoid_: Setting, secret (it is neither — Devvit's own settings can't mask a per-subreddit value, and its Secrets are app-wide)

**Default Area**:
The part of the world a subreddit's Maps open on when they have no Pins to frame — Europe, Hawaii, Tokyo — set by a moderator from the subreddit menu and held for the whole install, one per subreddit like the Places API Key. It is a rectangle rather than a place and a zoom: the moderator names a place, what gets stored is Google's own box around it, and each Map solves for the zoom that fits that box in the space it has, so one setting frames the same area in a Preview and full screen alike. Naming it takes two steps, a search and then a pick, because one word is usually several places and this app is not the one to choose between them. It needs a Places API Key, since looking a place up is a place search, and it repays that by biasing Place Search towards itself — near places rank first, distant ones are still findable. It is read live rather than copied into a Map Post as it is made, so correcting it corrects every empty Map at once, and where none is set a Map opens on the whole world, as every Map used to. See ADR-0012.
_Avoid_: Home view, default zoom (both name a camera, and what is stored is a place); bounding box, viewport (the mechanism, not the setting)

**Category**:
A label an Owner assigns to a Pin, drawn from that Map's own accumulating set of categories rather than a fixed predefined list — typing a new name creates it, typing an existing one reuses it. A Pin has exactly one Category (never zero-to-many), which is what makes sorting and filtering a Map by Category well-defined. The set of categories isn't a separately managed entity — it's just the distinct Category values currently in use across the Map's Pins.

**Sidebar**:
A collapsible panel alongside the Map, listing every Pin the Map currently shows. It is the only place a Pin's details are read — there is no per-Pin detail popup — and it is available to Owners and Viewers alike.
_Avoid_: Drawer, panel (positional descriptions that stop being true if it ever docks elsewhere)

**Pin Card**:
One Pin's entry in the Sidebar, showing that Pin's full details. Pin Cards are grouped by Category, with uncategorized Pins last. An Owner's Pin Card also offers editing; a Viewer's does not.
_Avoid_: Row, list item, entry

**Selected Pin**:
The single Pin the Map and the Sidebar are both currently focused on, or none. Selection is shared state, so the two views can never disagree about it, but what selecting does — zooming the Map, scrolling the Sidebar, both, or neither — depends on how the Pin came to be selected. Selecting the Selected Pin again lets go of it, and with nothing selected the Map frames every Pin it is showing, which is also how it loads — or the subreddit's Default Area, when there is no Pin to frame. Only the Selected Pin's marker can be dragged, and only by the Owner, and only if it came from a Manual Pin Drop.

**Owner**:
The Reddit user who created a Map Post. Only the Owner can add, edit, or delete Pins on that Map Post's Map, and only the Owner can Delete Map.
_Avoid_: Creator, author (informal synonyms; Owner is canonical because it denotes edit rights, not just authorship)

**Viewer**:
Any Reddit user viewing a Map Post who is not its Owner. Viewers can see all Pins but cannot modify them. Every reader of an Index Post is a Viewer of it; nothing on one is owned.
