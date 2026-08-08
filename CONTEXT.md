# Map Posts

A Reddit app (Devvit) that lets a subreddit member create a Post containing an interactive Map. The creator adds Pins to the Map; anyone viewing the Post can see the Pins, but only the creator can edit them.

## Language

**Post**:
A Reddit post (submission) that hosts exactly one Map. Each Post is a self-contained, single-player session — one Post, one Map, one Owner. Its Reddit-facing title defaults to "{Owner's username}'s Map" at creation, since there's no setup step to name it explicitly.
_Avoid_: Game, session

**Map**:
The interactive map rendered inside a Post, built with MapLibre GL using OpenFreeMap's Bright style. A Map holds zero or more Pins.

**Pin**:
A single marked location on a Map. Requires a Location and a Title; Category, description, link, and an uploaded image are all optional. Identical regardless of whether it was added via Place Search or Manual Pin Drop — the two methods differ only in how the Location and Title are supplied.
_Avoid_: Marker, point

**Place Search**:
The primary way an Owner adds a Pin: an autocomplete search backed by the Google Places API. Only the place's name and lat/lng coordinates are fetched from Google — everything else on the resulting Pin is entered manually — to keep API usage minimal.
_Avoid_: Geocoding (this app never fetches full place details, just autocomplete name + coordinates)

**Manual Pin Drop**:
The secondary way to add a Pin: the Owner clicks directly on the Map to place a Pin at that location, then types its Title by hand (no name is auto-filled).

**Category**:
A label an Owner assigns to a Pin, drawn from that Map's own accumulating set of categories rather than a fixed predefined list — typing a new name creates it, typing an existing one reuses it. A Pin has exactly one Category (never zero-to-many), which is what makes sorting and filtering a Map by Category well-defined. The set of categories isn't a separately managed entity — it's just the distinct Category values currently in use across the Map's Pins.

**Owner**:
The Reddit user who created a Post. Only the Owner can add, edit, or delete Pins on that Post's Map.
_Avoid_: Creator, author (informal synonyms; Owner is canonical because it denotes edit rights, not just authorship)

**Viewer**:
Any Reddit user viewing a Post who is not its Owner. Viewers can see all Pins but cannot modify them.
