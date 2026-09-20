# A Map has a Summary, and its text is rendered to nodes

A Map Post could say what a Pin was, and never what the Map was. `CONTEXT.md`
called the Sidebar "the only place a Pin's details are read", and there was no
place at all where the Map's own details were read — a subreddit building a
forty-Pin Collaborative Map had nowhere to say what belonged on it. A Map now
has a **Summary**: optional free text at the top of the Sidebar, above the Pin
Cards it introduces. It is stored under `summary:{t3}`, absent where none has
been written, on its own key for the reason `kind:{t3}` has one — `owner:{t3}`'s
mere existence is what `dbIsMap` reads to tell a Map Post from an Index Post,
and nothing may ever be overloaded onto it.

**The Owner may write it, and so may a Moderator on a Collaborative Map. This
deliberately contradicts `canEditPin`, and the contradiction is the design.**
On a Collaborative Map `canEditPin` gives the Owner no power at all over a
Contributor's Pin (ADR-0019); `canEditSummary` gives them full power over the
Summary. Side by side the two predicates read as a bug someone should reconcile.
They must not. ADR-0019 already drew the line this falls on: *"ownership here is
of the Post, not of what other people put on it."* A Pin is what somebody else
put on the Map, so it is not the Owner's to touch. A Summary is the Map's own
account of itself — it is the Post, the way the title and the byline are — so
rewriting it takes nothing from anyone. A Moderator may write it for the reason
they may take down a Pin: a subreddit needs someone able to remove abusive text
without deleting the Map underneath it, and a Summary is the most visible text
on a Map. On a Solo Map moderating grants nothing, exactly as everywhere else,
and the route does not even ask Reddit there — the answer could not change the
outcome, so the round trip is not bought.

**The Markdown renderer builds DOM nodes and never an HTML string, and that is
what replaces a sanitizer.** `src/client/markdown.ts` parses a small subset —
paragraphs, bold, italic, code, lists, links, line breaks — into plain objects,
then builds them with `createElement`, setting `textContent` on the leaves. The
set of elements that can exist is the set `appendInline` names. There is no
parse step for a payload to survive, so there is nothing to filter, which is why
this app took on rendered markup without taking on a sanitizer or a dependency.
A future change that builds a string and assigns `innerHTML` would reintroduce
XSS *and* silently delete the reason the code has no defence against it. Raw
HTML in a Summary is not stripped; it is simply never markup, because nothing
ever parses it. Links are held to `isHttpUrl` — the same rule `normalizeLink`
applies to a typed link, reused rather than rewritten so the two cannot drift —
and a refused URL keeps its words and loses its link rather than taking the
reader's text with it.

**A rendered link goes through `navigateTo`, not its own `href`.** A web view is
a sandboxed frame where an ordinary link either does nothing or tries to break
out of it, which is why the Pin Card's existing link already calls
`preventDefault()` and hands the URL to the client. Every link the renderer
produces takes that same path, through an `onOpenLink` handler passed in — which
also keeps `markdown.ts` free of app knowledge, the way `sidebar.ts` is kept
pure display. This is the part most likely to be "simplified" into a plain
anchor by someone testing in a browser, where it appears to work.

**An Export does not carry the Summary, and must not learn to.** Adding a field
to `PinsFile` is the obvious completeness move and it breaks the promise Import
rests on: `CONTEXT.md` says an Import *"only ever adds: what is already on the
Map is untouched, which is why it asks for no confirmation."* A Summary in the
file would make Import overwrite something, which costs that no-confirmation
reasoning and makes Import the second irreversible act in an app that has
exactly one. `toPinExport` is already an allowlist guarding this class of
mistake; the Summary stays outside it.

**Not in the Preview.** `init()` returns before the Sidebar is built for a
Preview, so the Summary never renders inline and needed no check of its own. A
Preview stays the Map alone (ADR-0007), and giving it text would reopen that.

Staleness is unchanged and stays deliberate. A Moderator's edit does not appear
on a page that is already open, and an Owner and a Moderator saving at once is
last-write-wins — the same posture `dbUpdatePin` takes, for the same reason
ADR-0019 gives. There is one value, one writer at a time, and no id to collide
on, so there is nothing here that WATCH would protect. A future reader tempted
to add locking should read ADR-0019's closing paragraph first.
