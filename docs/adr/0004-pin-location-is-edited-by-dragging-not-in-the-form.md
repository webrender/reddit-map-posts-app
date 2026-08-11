# A Pin's location is edited by dragging its marker, not in the edit form

Introducing the Sidebar changed what a marker click means. It used to open the edit form, and the form owned the whole Pin: it enabled dragging on that Pin's marker while open, and its Save wrote the dragged coordinates along with the text fields. Now a marker click selects the Pin instead, so the form is reached from a Pin Card's edit affordance and no longer has a natural relationship to the marker on the Map. Rather than keep a form open just so a marker becomes draggable, location editing was moved out of the form entirely: the Selected Pin's marker is draggable on its own, and `dragend` persists the new coordinates immediately.

So the form owns title, category, description, link, and image; dragging owns location. Nothing owns both. A future reader will find that `savePin()` never sends `location` on an update even though `UpdatePinReq` still accepts it — the add path and the drag path are its only callers.

Only the Selected Pin's marker is draggable, never all of them. The alternative — every marker grabbable for the Owner at all times — makes moving a Pin a one-step action, but on touch a slightly-off tap becomes a small drag that silently relocates a Pin, and there is no undo. Requiring selection first costs one click, uses the selection highlight to advertise which marker is grabbable, and keeps map panning unambiguous everywhere else.

The drag write is optimistic: the marker stays where it was dropped and the Pin's stored location is updated in the background, snapping back with an error if the write fails. A staged "Save / Cancel" confirmation was considered and rejected as too much apparatus for an action this cheap to repeat.
