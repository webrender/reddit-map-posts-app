# The Index Post is inline-only, tap-only, and paginated

A subreddit accumulates Map Posts and nothing gathers them: a Map made last month is as far down the feed as any other post from last month. The Index Post is that gathering place — a post a moderator creates and pins, listing the subreddit's Maps with search, a sort, and a way to make a new one. It is a second post type, which in Devvit 0.14 costs nothing structural: `post.entrypoints` takes any number of named keys and `submitCustomPost({entry})` picks which one a post renders. One app, one server, one Redis, two documents.

What makes it a different design rather than a differently-shaped Map Post is that it has one reading instead of two. A Map Post is a Preview inline and the whole interface full screen (ADR-0007); an Index Post never opens full screen at all. That is deliberate, and it is the constraint every other decision here falls out of, because Reddit's inline rules are strict: "only tap or click input is allowed, with no scroll traps, scroll hijacking, or interference with zoom or pan." A post pinned to the top of a community is the worst possible place to take a reader's scroll, so the Index Post does not ask for the gesture — it asks for taps only, and gives up scrolling entirely.

A list that cannot scroll must paginate, and a list that must fit inline has a hard ceiling to paginate into. Devvit caps an inline web view at 512 pixels: `tall` is 512, and the schema refuses a pixel height above it. Spent, that budget is roughly a 44px header holding the search field and the Sort toggle, ~300px of Listing, a ~40px pager, and the Create a Map control beneath it. Five Entries at ~56px is what fits — six would need 48px rows, which is under a comfortable tap target for a row that is itself the tap target. The Entries are elastic between that floor and a ~72px ceiling, so they share out whatever the frame turns out to be rather than leaving a band of dead space above the pager. So five, fixed, on every device: a page size that changes with the viewport makes `2 / 14` a lie the moment anyone rotates their phone.

The page takes its body out of flow entirely (`position: fixed; inset: 0`) rather than sizing itself
to `100dvh`. Out of flow, the root has no in-flow content, so there is no document height to disagree
with the frame's however the frame is measured — a stronger guarantee than "as tall as the viewport
says it is", for a page whose whole premise is that it never scrolls. The Entries are elastic for the
same reason: they share out whatever height the band actually has and compress rather than clipping,
measured holding five rows without a scrollbar in a frame 112px shorter than the one they were
designed for.

Worth recording so no one else chases it: **a stickied Devvit post gives a few pixels of scroll in
the Reddit mobile app, and it is not this app's to fix.** It appears only once a post is pinned,
never in Reddit's post view or in a browser, and it survives every lever an app has. Measured from
inside the page, `scrollY` never leaves zero and `scrollHeight` equals `clientHeight`, so the
document is not what moves; clamping the whole app to 200px changes nothing; and the same give
appears on a stickied Map Post and on stickied posts from unrelated production Devvit apps. Two
things were learned while ruling it out. `styles.height`, which the config schema offers as an exact
pixel height, is marked `[experimental]` and appears not to be honoured — four entrypoints asking for
496, 400, 320 and 256 all reported a 512px viewport — so the three named sizes on `height` are the
only heights an entrypoint can really ask for. And the give is unrelated to which of those is chosen.


The pager is `‹ Prev · 2 / 14 · Next ›`, not numbered pages, because numbered pages on a phone are tap targets too small to hit; it disables at the ends rather than wrapping. Changing the Search Query or the Sort returns to page one, since page four of the previous result set means nothing in the new one.

Search runs on the server. Devvit's Redis has no text index — `zRange`, `zScan`, `hScan`, `hGetAll` is the whole vocabulary — so a Search Query is a linear scan over the Map index wherever it happens; the only real choice is where, and therefore what crosses the wire. Client-side matching would mean shipping every Map's title, Owner, pin count and date to every reader of a pinned post in a feed: fine at a thousand Maps, 800KB at ten thousand. Server-side keeps the payload at five Entries no matter how large the subreddit gets, and the cost — a round trip per query — is one this app already pays for every other interaction, since paging and sorting are round trips too. It is debounced at ~250ms and the previous Entries stay on screen until the new ones land, so the Listing never flashes empty under a typing finger.

The one thing this leaves genuinely uncertain is the search field itself: "tap or click only" is written about gestures, and a text input is not a gesture, but on a phone it summons a software keyboard over a 512px frame embedded in a scrolling feed. That is worth testing on a real device in `map_posts_dev` before it ships. The design is arranged so the field can be removed without relaying out anything else, and the fallback if the keyboard proves unusable is tap-driven filtering — letter chips, or filtering by Category across Maps — not an escape into expanded mode.

The Listing shows a Map Post only once its Map has a Pin and only while its Reddit post still exists. An empty Map has nothing to browse to, and listing it turns the index into a graveyard of abandoned titles. A deleted or removed post has nowhere to go, and its Entry is pruned from the index once that has been noticed three reads running (ADR-0011) — which is free, because ADR-0011's live score read already fetches every visible Entry's post from Reddit and a missing one answers the question by not being there. Both rules have a consequence worth stating plainly: a reader who taps Create a Map, names it, and lands on their new Map will not find it in the index they just left. It appears when they drop their first Pin, and disappears again if they delete their last. There is no toast explaining this, because the moment after creating a Map is the moment to add a Pin, not to read indexing rules.

Maps created before this shipped are not in the index and are not backfilled. A backfill means walking `getNewPosts` across the whole subreddit checking each post for an `owner:` key, and it buys visibility for a handful of test posts at the cost of code that runs once and is then wrong forever after.

Any number of Index Posts may exist. There is no uniqueness key, no "you already have one" check, and no replace-the-old-one flow, because there is nothing for two of them to disagree about: every Index Post is the same document reading the same subreddit-scoped Redis, so two show the same Listing. The app also never pins one — `sticky()` on behalf of the app account may not have the permission, and a silent failure is worse than a toast telling the moderator to pin it themselves.

Creating one goes through a form, pre-filled with `r/{subreddit} Community Maps`, for the reason ADR-0008 gives for Map Posts: a Reddit title is permanent and cannot be edited afterwards, so the only moment to choose it is before the post exists. A moderator pinning this to the top of their community will want their own words on it.

Nothing happens at install any more. The `onAppInstall` trigger that created a Map Post is gone: menu items are declarative in `devvit.json` and exist without it, so a fresh install now offers three menu items — set the Places API key, new Map Post, new Index Post — and creates nothing until someone picks one. The Map Post it used to create had no one present to name it, which is why the New Post Form's default title had to work with no username; that default survives for the menu path.
