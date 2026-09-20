# A Region is drawn, and the Sidebar's scroll drives the camera

A Map Post had two axes of meaning and needed a third. A Pin has a Location —
where it is — and a Category — what it is. Neither says *which part of the Map*
it belongs to. On a forty-Pin city Map "North Side" and "East End" are things an
Owner could only express by typing them into Categories, which collides with the
axis Categories already carry and which the Map itself cannot draw. A Map now
has **Regions**: named polygons its Owner traces over parts of it.

**Membership is geometric, and it is stored nowhere.** A Pin is in a Region if
its Location falls inside the polygon, computed on the client at render time.
The obvious alternative — a `regionId` on the Pin — was rejected for the reason
ADR-0018 gives for deriving a Category's colour instead of storing it: a stored
membership is a second fact that can disagree with the first. It would need a
migration for every Pin already on every Map, a question in the Import format,
reconciliation every time a Pin is dragged, and a decision about what happens to
the Pins of a deleted Region. Derived, none of those exist. Dragging a Pin from
one side of a boundary to the other just works, because there was never anything
to update; deleting a Region orphans nothing, because nothing pointed at it; and
a Pin that is inside no Region is simply in none, which needs no sentinel value.
The cost is that the answer is recomputed on every render rather than read, and
on a Map of hundreds of Pins and tens of Regions that is still a few thousand
ray casts — far below anything a reader can perceive.

It also means the server never asks which Region a Pin is in. It stores polygons
and hands them back. That is why `src/client/region.ts` is client-only and not
in `src/shared/`: putting it there would claim a constraint the server does not
actually have, the same reasoning ADR-0020 applied to `markdown.ts`.

**One palette across two axes, and a colour identifies within an axis, never
across one.** A Region's colour is derived exactly as a Category's is — its name,
broken by age, from the same seven colours — because ADR-0018's argument is
about what a reader can tell apart on a map, and nothing about it changes when
the thing being coloured is a polygon instead of a marker. The consequence is
that a Category and a Region can wear the same hue at the same time, and that is
deliberate. What tells them apart is where the colour appears and what shape it
is: a Category is a round `.category-swatch` on a marker and on a Sidebar chip; a
Region is a **squared-off** `.region-swatch` on a section heading and a
translucent fill on the Map. Nobody has to compare a polygon's fill with a
marker's dot, because the two never answer the same question.

A future reader will notice the collision and reach for an eighth colour to fix
it. ADR-0018 explains at length why an eighth does not exist: searching the whole
sRGB gamut under the gates that palette clears, there is no colour a reader could
tell from the other seven. The answer to "a Region and a Category are both pink"
is that they are different shapes in different places, not that the palette is
one short.

**The Sidebar's scroll drives the camera, and that does not touch ADR-0006 or
ADR-0007.** Full screen, on a wide viewport, scrolling the Sidebar takes the
reader on a tour: as a Region's section comes into view the camera flies to that
Region and the Map narrows to its Pins. This looks at first like a new gesture,
which ADR-0006 spent its whole length removing from this Map. It is not one. The
camera still only pans and zooms — `fitBounds` is exactly the move `fitToPins`
already makes — and nothing new is bound to a touch. It is the *app* moving the
camera in response to a scroll the Sidebar already owned, not a new degree of
freedom handed to the reader's fingers. A Preview is unaffected for the same
reason it was unaffected by the Summary: it draws polygons, fills and labels, and
wires up no handler at all, because `init()` returns before any handler is
attached. The Map inline still answers nothing (ADR-0007).

The landing state is every polygon and every Pin, framed on all of it. The tour
begins at the reader's **first scroll** and not before. It is driven by reading
where each Region's section sits on a scroll the reader made, rather than by an
`IntersectionObserver`, because an observer reports on `observe()` — its first
callback arrives before anyone has scrolled, and honouring it would destroy the
landing state on first paint by flying the camera somewhere nobody asked to go.
Reading the geometry on a scroll event has no first callback to ignore. Any
scroll the *app* made — `scrollPinIntoView` after a save, an edit or a marker
click, `scrollRegionIntoView` for a click on a polygon, or a rebuild of the list
— is ignored for 700ms, since each would otherwise steer the camera away from
what the reader had just done.

**The tour is wide-viewport only.** On a narrow viewport the Sidebar overlays
85% of the Map, so a camera move is a move nobody can see — and the reader would
dismiss the panel to find the Map silently somewhere else than where they left
it. Tapping a heading or a polygon still zooms there, because that is a gesture
with an obvious cause. Giving a phone the real tour would mean the Sidebar
becoming a bottom sheet over a visible Map, which is a larger design change and
belongs to its own piece of work. `prefers-reduced-motion` drops the flight's
duration to zero rather than removing the move, since the destination is the
information and the animation is not.

**A fourth toolbar face, which ADR-0017 refused.** That refusal was about a
*form*: Export and Import needed somewhere to put two textareas, and a `<dialog>`
was already the answer for more controls than a row holds. Tracing a Region is
not a form. It happens *on the Map*, it needs controls while it is running —
`Undo point`, `Done` — and the reader has to be able to see what they are tracing
the whole time. That is exactly what the Default Area face already is, and it is
the shape ADR-0013 left a vacancy for. The dialog still exists for the list of
Regions and for naming one; the face exists for the part that is a gesture.

**`canEditSummary` became `canEditMap`, and it is one predicate.** A Region is
the Map speaking about itself in precisely the sense ADR-0020 gave the Summary:
it is the Post, not a Contributor's work, so rewriting it takes nothing from
anyone. The rule is therefore identical — the Owner on either kind of Map, plus
a Moderator on a Collaborative one, and moderating grants nothing on a Solo Map.
A second predicate with an identical body, `canEditRegions` beside
`canEditSummary`, would be two spellings of one rule and would drift the first
time either was amended. Widening the existing one's name and doc comment to
"the Map's own account of itself — its Summary and its Regions" is what keeps
there being one place this is decided, the way `canEditPin` is the one place its
question is decided.
