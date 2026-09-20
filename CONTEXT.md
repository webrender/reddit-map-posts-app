# Map Posts

A Reddit app (Devvit) that lets a subreddit member create a Map Post containing an interactive Map. The creator adds Pins to the Map; anyone viewing the Map Post can see the Pins, but only the creator can edit them. A moderator can also create an Index Post, which lists every Map on the subreddit worth listing.

## Language

**Map Post**:
A Reddit post (submission) that hosts exactly one Map. Its Reddit-facing title is the Owner's to choose, in the New Post Form, before the Post exists. A Map Post has two readings: inline, where Reddit gives it a slot in the feed and forbids it to answer a gesture, and full screen, where it has the device to itself. Inline it shows a Preview; full screen it shows the whole interface. Both are the same page asking at load which of the two it is, since Reddit builds a fresh web view for each — so crossing between them reloads the Map and opens it framing every Pin, exactly as first paint does. It comes in two kinds, chosen at creation and fixed thereafter: see Solo Map and Collaborative Map.
_Avoid_: Game, session, Post unqualified (there are two kinds now, in both the sense below and the sense that a Map Post is not an Index Post)

**Solo Map**:
The kind of Map Post that has always existed, named now that there are two: a self-contained, single-player session — one Post, one Map, one Owner, who alone may add, edit, or delete its Pins. Chosen (or defaulted to) in the New Post Form and fixed for the Map Post's life; there is no converting one kind to the other.
_Avoid_: private map, personal map (nothing about it is private — a Viewer reads every Pin on it, same as a Collaborative Map)

**Collaborative Map**:
The kind of Map Post a whole subreddit builds together: any logged-in member may add a Pin to it, becoming its Contributor, and a Moderator may edit or delete anything that lands on it. Its Owner still owns the Post — the byline, and Delete Map — but owns none of the Pins other people put on it; see Owner. Chosen in the New Post Form and fixed at creation, like Solo Map. See ADR-0019.
_Avoid_: public map, open map, shared map (a Solo Map is just as public and just as readable — what differs is who may write)

**Index Post**:
A Reddit post that lists the subreddit's Map Posts rather than hosting a Map of its own — meant to be pinned at the top of a community, though the app never pins it. Only a moderator can create one, and a subreddit may hold any number: they are all the same page reading the same Redis, so two of them can never disagree. Unlike a Map Post it has one reading, not two — it never opens full screen, so the whole app is whatever fits inline, which is where the Listing's pagination comes from. See ADR-0010.
_Avoid_: Directory, hub, splash (Devvit's deprecated name for a launch screen)

**Delete Index Post**:
A moderator's way to take down the Index Post they are looking at, from a control in its header — the same gesture as Delete Map, on the other post type. Only a moderator of the subreddit sees it, and only a moderator may run it: an Index Post is owned by no one, so moderating here is what stands in for owning. It takes the Index Post and nothing else — the Maps it listed, and the Map Posts hosting them, are untouched, because an Index Post owns nothing and is owned by nothing, and nothing about it is written to Redis to clean up. The route refuses a post that is a Map before it looks at anything else, so it can never become a way around a Map's Owner. Like Delete Map it asks first, through Reddit's own modal, and it cannot be undone.
_Avoid_: Reset, clear, purge (all suggest the Maps go too, and they do not); deleting every Index Post at once (there is no such action — one post, one control)

**Listing**:
The Index Post's page of Map Posts: five Entries at a time, filtered by the Search Query, ordered by the Sort, and moved through a page at a time because nothing inline may scroll. It shows a Map Post only once that Map has a Pin on it and only while its Reddit post still exists — a Map with nothing on it has nothing to browse to, and a deleted one has nowhere to go.

**Entry**:
One Map Post's row in the Listing: its title on one line, then `u/{Owner} · community · {n} pins · {score} ▲ · {age}`, the `community` marker present only for a Collaborative Map. Without it, `u/alice · 40 pins` would misattribute forty people's work to Alice. The whole row is tappable and goes to that Map Post; the counts are decorative. Its score is the Map Post's Reddit upvote count, and is omitted rather than shown as zero when Reddit cannot be reached. See ADR-0011.
_Avoid_: Row, card, result

**Sort**:
Which order the Listing is in: **Newest** by default, or **Top** — all-time upvotes, ties broken by newest. Both are a toggle in the Index Post's header, and neither is remembered: every load of an Index Post starts at Newest, page one, with no Search Query.

**Search Query**:
What a reader types into the Index Post's one field, matched as a case-insensitive substring against a Map Post's title and its Owner's username — never against the Pins inside it. It filters the whole subreddit's Maps rather than the page on screen, which is why the Listing is assembled on the server. Changing it returns to page one.

**Create a Map**:
The Index Post's one accented control, at the foot of the Listing in the same accent, shape and size as the Open Map button on a Preview. It shows the New Post Form in place, without leaving the Index Post, and goes to the new Map Post once Reddit has it. A logged-out reader sees it and is asked to log in on tapping it, because a control that isn't there teaches no one that the app exists.

**Delete Map**:
The Owner's way to take their Map Post down, from the toolbar, full screen only — a Viewer never sees the control and a Preview has no toolbar to put it in. It asks first, through Reddit's own modal, whose Delete button is the whole of the confirmation: the modal is the deliberate step, and a field inside it would be a second one for the same decision. Neither this modal nor Delete Index Post's names the post it is about, because a web view is not told the title of the post it is running inside. It cannot be undone: the Map Post goes, and the Pins go with it. On a Collaborative Map that is every Contributor's work too, not only the Owner's, which the confirmation says plainly — it stays the Owner's call regardless, since Delete Map answers to owning the Post, not to owning what is on it. Reddit is asked first and the app forgets the Map only once Reddit has actually taken the Map Post, so a refusal leaves a Map that is whole and still listed rather than a Map Post standing over pins that have already been erased. Afterwards there is nowhere to return to, so it leaves for the subreddit.
_Avoid_: Remove (that is the moderator's action, and Reddit's own; it hides a Map Post without touching the Map)

**New Post Form**:
The form Reddit shows when someone asks for a new Map Post, asking for its title and which kind of Map it will be — Solo or Collaborative, defaulting to Solo. It is Reddit's own modal, not part of the Map — the app describes the fields and Reddit renders, validates, and submits them — so it is the one place in the app where a Map Post's title can be set, and there is no Map Post yet to abandon if the form is cancelled. Its title field arrives pre-filled with "{Owner's username}'s Map", which is what the Map Post used to be called unconditionally. It is reached two ways, from the subreddit menu and from Create a Map on an Index Post, and it is the same form both times. The kind, like the title, cannot be changed once the Post exists — there is no converting a Solo Map to a Collaborative one or back. The Index Post has a form of its own, asked of the moderator creating it and pre-filled with "r/{subreddit} Community Maps"; it asks for a title only, since an Index Post has no kind.
_Avoid_: Menu, dialog, modal (all name the mechanism; the form is the setup step)

**Preview**:
The Map Post as it is read inline: the Map alone, framed on every Pin, with labelled markers in their Category Colours, no toolbar, no Sidebar, no Summary, and no Selected Pin. It is locked — no click, drag, or pinch reaches it — because inline the gesture belongs to the feed the Map Post is scrolling past, and a Map Post that answers one steals it. Its single control, Open Map, floats over the Map and opens the Map Post full screen where everything else is. An Index Post lives under the same rule and answers it differently: it has no full screen to send anyone to, so it stays tappable and paginates instead. See ADR-0007 and ADR-0010.
_Avoid_: Splash, launch screen (Devvit's own name for a native screen that can precede a web view; a Preview is the web view, showing the real Map)

**Map**:
The interactive map rendered inside a Map Post, built with MapLibre GL using OpenFreeMap's Bright style. A Map holds zero or more Pins. It is always seen from directly overhead and north-up: one finger always pans, two fingers zoom, and the camera does nothing else — outside a Preview, where it does nothing at all.

**Pin**:
A single marked location on a Map. Requires a Location and a Title; Category, description, link, and an uploaded image are all optional. Its description is written in Markdown, the same small subset a Summary is. It is marked in its Category Colour, and it also knows when this Map got it — stamped by the server, absent from an Export, and read only to decide which of a Map's Categories came first. It also knows who added it: on a Collaborative Map that is a Contributor, shown on its Pin Card; a Pin stored before this existed, or any Pin on a Solo Map, is read as the Owner's. Its Location can be re-chosen by dragging its marker, whichever way it was first given: whoever may edit it clicked the Map or pasted a Map Link carrying it, and the Title beside it is theirs to write either way, so a moved Pin can never end up disagreeing with a name it did not choose.
_Avoid_: Marker, point

**Pin Drop**:
The one way to add a Pin: the Owner arms it from the toolbar and then says where. Clicking the spot on the Map is how that is answered everywhere; on a device with a keyboard it can also be answered by pasting a Map Link, with nothing focused and no field to paste into. They are two answers to one question rather than two add-paths, which is why arming is still a single decision, the toolbar grows nothing, and a Viewer's toolbar is still made read-only by hiding a single control. See ADR-0013 and ADR-0015.
_Avoid_: Place Search, Manual Pin Drop (both name a distinction that no longer exists — there is nothing for "manual" to be the opposite of); geocoding, place lookup (this app resolves no names to coordinates at all)

**Map Link**:
A Google Maps or Apple Maps URL pasted onto an armed Pin Drop. The app takes it apart on the device for the coordinates and the place name already written in it, and offers both in the New Pin form — a Location to save and a Title to keep or retype, neither of them a Pin until the Owner saves one. It is read, never resolved: nothing is sent anywhere, there is nothing to send it with, and a link that keeps its location behind a redirect — every short share link either provider hands out — is refused rather than followed. That refusal is why this is a desktop convenience rather than a feature of the app everywhere: a phone's Maps app shares short links, and a phone cannot paste without a field to paste into, so a phone is never told the gesture exists. See ADR-0015.
_Avoid_: Lookup, search (both suggest the app asks someone something; it asks no one anything); Import (that word now names a different thing — see Import — and a Map Link is one link the Owner is standing over, not a list being applied)

**Default Area**:
The part of the world a subreddit's Maps open on when they have no Pins to frame, held for the whole install, one per subreddit. It is a rectangle rather than a place and a zoom: each Map solves for the zoom that fits the rectangle in the space it has, so one setting frames the same area in a Preview and full screen alike. A moderator sets it by framing it — they open any Map Post full screen, pan and zoom until the Map is showing what they mean, and take that view; the rectangle stored is what was on the screen. There is nothing to name and nothing to search, which is why there is no menu item for it and no way for the app to disagree with the moderator about which Springfield they meant. It is read live rather than copied into a Map Post as it is made, so correcting it corrects every empty Map at once, and where none is set a Map opens on the whole world, as every Map used to. See ADR-0014.
_Avoid_: Home view, default zoom (both name a camera, and what is stored is an area); bounding box, viewport (the mechanism, not the setting)

**Category**:
A label an Owner assigns to a Pin, drawn from that Map's own accumulating set of categories rather than a fixed predefined list — typing a new name creates it, typing an existing one reuses it. A Pin has exactly one Category (never zero-to-many), which is what makes sorting and filtering a Map by Category well-defined. The set of categories isn't a separately managed entity — it's just the distinct Category values currently in use across the Map's Pins. It carries a Category Colour, which nobody chooses and nothing stores.

**Category Colour**:
The colour a Category's Pins are marked in, worn by their markers on the Map and by a dot beside every place the Sidebar names that Category — which is what makes the Sidebar the Map's legend, since the Map has no other. It is derived rather than chosen: a Category's name asks for a colour, and where an *older* Category already holds that one it takes the next free colour instead. Only an older Category can ever displace a younger one, so a Category that is already on a Map keeps its colour when another is added — the one thing that had to be true for a colour to be worth reading. A Pin with no Category is neutral grey, which is the absence of a Category rather than another one. There are seven colours because seven is how many a reader can actually tell apart on a map, and an eighth Category shares rather than being invented a hue; the names on the markers and in the Sidebar are what carry a Category, and the colour only makes it faster. See ADR-0018.
_Avoid_: Palette (that is the seven colours, not what a Category has); colour picker, custom colour (nothing is chosen — offering the choice would make the category set a thing to manage)

**Export**:
Every Pin on a Map written out as JSON text, produced by its Owner from the toolbar and read back by an Import. It carries Pins and only Pins: a Map's Summary is not one, and putting it in the file would make an Import overwrite something rather than only add — see Import. Owner-only on both kinds of Map Post — a Contributor's whole gesture is Pin Drop plus editing what they dropped. It describes Pins rather than naming them: a Pin's id is left out, because an id belongs to the Map holding the Pin and not to the Pin's account of itself, and it never carries who added a Pin, either — an Owner exporting a Collaborative Map and importing it into a Solo one hands every Pin to themselves, which is accepted rather than guarded against. Each Location is a pair of numbers, and there is deliberately no field an Export could put a Map Link in — the format cannot express "resolve these", which is what keeps ADR-0015's rule true of a feature that takes a list. On a Solo Map it needs no round trip: the Map already holds every Pin it is showing. A Collaborative Map's Owner is not necessarily looking at every Pin another Contributor has added since the page loaded, so producing an Export there costs one refetch first — the one place the app's stale-until-reload posture would otherwise hand back a wrong document rather than a merely stale view. It is text in a field rather than a downloaded file: a web view is a sandboxed frame that may refuse a download outright, and there is nothing to refuse about a textarea. See ADR-0017.
_Avoid_: Backup (it is one use of an Export, not what an Export is); file, download (there is no file)

**Import**:
Adding Pins to a Map from an Export pasted into it, Owner-only on both kinds of Map Post — see Export. It only ever adds: what is already on the Map is untouched, which is why it asks for no confirmation and why Delete Map remains the one thing in the app that cannot be undone. It is all-or-nothing — one unreadable entry adds none of them, so a corrected Export can be pasted again without duplicating whatever a partial run had already applied. An imported Pin is indistinguishable from a dropped one afterwards: fresh id, draggable, no record of where it came from — on a Collaborative Map every imported Pin is stamped to the importing Owner, the same as any other Pin they add. The one thing an Import cannot carry is a picture this app did not upload, which is dropped while its Pin is kept. See ADR-0017.
_Avoid_: Restore, sync, merge (all imply the Map is being made to match the text; it is only being added to); bulk add (names the volume, not the act)

**Sidebar**:
A collapsible panel alongside the Map, listing every Pin the Map currently shows, under the Map's Summary where there is one. It is the only place a Pin's details are read — there is no per-Pin detail popup — and the only place the Map's own details are read either; it is available to Owners and Viewers alike.
_Avoid_: Drawer, panel (positional descriptions that stop being true if it ever docks elsewhere)

**Summary**:
The Map's own account of itself: optional free text at the top of the Sidebar, above the Pin Cards it introduces, written in Markdown and read by everyone. It answers to the Post rather than to the Pins on it — the Owner writes it on either kind of Map, and on a Collaborative Map a Moderator may too, which is deliberately not the rule for a Pin: an Owner has no say over a Contributor's Pin, because that is someone else's work, while a Summary is the Map speaking for itself and takes nothing from anyone. A Map has none until someone writes one, and clearing it puts the Map back to having nothing to say; neither is a Pin, so neither is carried by an Export, and an Import can never overwrite one. It is absent from a Preview, which is the Map alone. See ADR-0020.
_Avoid_: description (that is a Pin's field, and the collision is why this one is called a Summary), about, intro, blurb

**Pin Card**:
One Pin's entry in the Sidebar, showing that Pin's full details. Pin Cards are grouped by Category, with uncategorized Pins last, and both the group's heading and the card's own Category chip carry that Category Colour. Whoever may edit that Pin gets editing offered on its card — the Owner on a Solo Map; a Pin's own Contributor or a Moderator on a Collaborative one — everyone else's card offers none. On a Collaborative Map a card also names its Contributor as `u/{contributor}`; markers on the Map do not, since a marker already carries a Category Colour and a label and the Sidebar is the only place a Pin's details, including who added it, are read.
_Avoid_: Row, list item, entry

**Selected Pin**:
The single Pin the Map and the Sidebar are both currently focused on, or none. Selection is shared state, so the two views can never disagree about it, but what selecting does — zooming the Map, scrolling the Sidebar, both, or neither — depends on how the Pin came to be selected. Selecting the Selected Pin again lets go of it, and with nothing selected the Map frames every Pin it is showing, which is also how it loads — or the subreddit's Default Area, when there is no Pin to frame. Only the Selected Pin's marker can be dragged, and only by the Owner.

**Owner**:
The Reddit user who created a Map Post, and only the Owner can Delete Map. On a Solo Map the Owner can also add, edit, or delete every Pin — the whole Map is theirs. On a Collaborative Map the Owner gets no special power over a Contributor's Pin: ownership is of the Post, not of other people's work, so an Owner who wants to edit or delete someone else's Pin needs to be a Moderator too. The Map Post is submitted under their name rather than the app account's, so the byline Reddit shows a scrolling reader names them too — but Reddit's authorship and this app's ownership are two facts that agree rather than one, and only the one stored in Redis decides who may move a Pin. An Index Post has no Owner and is nobody's post: it stays the app account's. See ADR-0016 and ADR-0019.
_Avoid_: Creator, author (informal synonyms; Owner is canonical because it denotes edit rights, not just authorship)

**Contributor**:
A Reddit user who has added a Pin to a Collaborative Map. A third role beside Owner and Viewer rather than a rank between them: a Contributor's rights are exactly their own Pins — they may edit and delete what they dropped, and nothing else — and a Viewer becomes one the moment they drop a Pin. There is no Contributor on a Solo Map, where every Pin is the Owner's. See ADR-0019.
_Avoid_: Collaborator, editor, member (all suggest rights over the Map rather than over one's own Pins)

**Viewer**:
Any Reddit user viewing a Map Post who is not its Owner and, on a Collaborative Map, has not added a Pin. Viewers can see all Pins but cannot modify them; on a Collaborative Map a Viewer may still add one, becoming a Contributor. Every reader of an Index Post is a Viewer of it; nothing on one is owned.

**Moderator**:
A moderator of the subreddit the app is installed in, which is a different axis from Owner, Contributor and Viewer rather than a rank above them: moderating grants nothing over a Solo Map, and on a Collaborative Map it grants edit and delete over every Pin, not over the Post itself — Delete Map stays the Owner's alone. It decides four things — who may create an Index Post and Delete Index Post, who may set the Default Area, and, on a Collaborative Map, who may edit or delete a Pin they did not add and who may write the Summary. The Default Area control is the only one in a Map Post's toolbar that answers to moderating rather than to owning or contributing, and a moderator uses it on whichever Map Post they happen to be reading, including a Viewer's view of someone else's. Reddit is asked whether one particular reader moderates rather than for the mod list, and a Reddit that cannot be reached answers no — on a Collaborative Map that means an outage leaves a Moderator temporarily unable to remove a Pin, the same fail-closed posture as everywhere else this is asked. See ADR-0019.
_Avoid_: Admin (Reddit's own word for its staff, not a subreddit's moderators)
