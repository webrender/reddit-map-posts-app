# The index's ordering is cached, the scores it shows are live

The Listing sorts by Newest or by Top, and those two want different things from Reddit. Newest wants a creation time, which never changes and which the app already knows at the moment it creates a Map Post. Top wants an upvote count, which changes constantly, belongs to Reddit rather than to us, and — this is the part that decides the design — is needed for *every* Map on the subreddit, not just the five on screen. You cannot order a set by a number you only have for a page of it.

So there is an index, and it is the spine of the whole feature. `dbCreateMap` writes the Map Post into a per-subreddit sorted set scored by creation time, alongside a metadata hash holding what an Entry renders: title, Owner username, pin count, created-at. Redis is installation-scoped, so "per-subreddit" needs no qualification in the key — the same property ADR-0009 leans on for the Places API key. The pin count is denormalized there and maintained by `dbAddPin` and `dbDeletePin`, which is also what makes "hide Maps with no Pins" a read of a number already in hand rather than a second Redis call per Entry.

Reddit's title is immutable, so the copy in the index cannot go stale. The score can, and does.

Upvotes are cached into a second sorted set, refreshed by a cron task, and the Top sort is a `zRange` over it. The alternatives were both worse. Fetching every Map's score at render time is unbounded work in the hot path of a post sitting in a feed. Delegating to `reddit.getTopPosts({timeframe: 'all'})` and filtering to known Map Posts is exact and needs no cache, but it scans the entire subreddit to find our posts — on a general-purpose community where Maps are a small fraction of submissions, that is hundreds of posts read to fill five rows, and combining it with a Search Query and a page offset is worse still.

The cron runs every 30 minutes and refreshes at most 300 Maps per run, walking a cursor stored in Redis. Under 300 Maps that is indistinguishable from refreshing everything every half hour; above it, the refresh interval stretches rather than the job growing without bound and timing out. Ordering by Top is therefore up to 30 minutes stale, and on a large subreddit staler than that.

The number printed on an Entry is not. Rendering a page reads its five posts from Reddit for their current score, because five reads is a bounded cost and because that read is doing a second job anyway — a post that has been deleted or removed answers by not being there, which is how ADR-0010's pruning happens without a job of its own. So the split is: **the cache decides the order, Reddit decides the number.** A Map that shot up in the last ten minutes shows its real score immediately and takes its place in the Top sort at the next refresh.

That split is the thing a future reader is most likely to "fix" — noticing that ordering can lag the numbers beside it and making the ordering live, which quietly turns one render into a fetch of every Map on the subreddit. The lag is the design, not an oversight.

When Reddit cannot be reached, an Entry renders its title, Owner, pin count and age, and simply omits the score. Not zero — zero is a claim about a post, and a wrong one. Nothing tells the reader that the Top sort is running on cached numbers at that moment: a caveat banner costs a row out of five, and the failure is transient. Entries are not pruned on a failed read either, since "Reddit is down" and "this post is gone" arrive looking identical and only one of them is a reason to forget a Map.

Top means all-time, and ties break by newest — the same tiebreak the default sort uses, so a subreddit whose Maps all sit at one upvote reads identically under either sort instead of shuffling arbitrarily.
