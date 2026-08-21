# A Place Search Pin's location cannot be moved

ADR-0004 made the Selected Pin's marker draggable for the Owner. That is right for a Manual Pin Drop, where the Owner picked the coordinates by clicking and the drag is just a second, more accurate click. It is wrong for a Place Search Pin: those coordinates came from Google for a named place, so dragging one only ever makes the Pin disagree with its own Title. Now a Pin records which add-path created it (`Pin.fromPlaceSearch`), and only Manual Pin Drop Pins are draggable.

This costs the glossary its "a Pin is identical however it was added" line, which is the reason the flag is on the Pin rather than inferred. There is nothing to infer from — a Place Search Pin keeps no place id, name, or other trace of Google (see ADR-0002 on how little is fetched), and its Title is free for the Owner to rewrite immediately after adding. Something has to be stored, and one boolean is the smallest thing that answers the one question being asked.

Pins written before this flag existed have no value for it, and absent reads as a Manual Pin Drop: they stay draggable, which is what they already were. Mislabelling an old Place Search Pin as manual keeps a capability the Owner had rather than silently taking one away, and there is no migration that could tell the two apart anyway.

The rule is enforced on the server, not only by withholding the drag handle: `update pin` rejects a location change to a Place Search Pin with a 400. The client is the only caller and it already refuses to send one, so the check is redundant in practice — it is there because the alternative is an invariant that exists only as long as the UI is the sole way in.

Moving a Place Search Pin is still possible the long way: delete it and drop one by hand. That is deliberate. Wanting a place's Pin somewhere other than the place is a signal it was never really a Place Search Pin.
