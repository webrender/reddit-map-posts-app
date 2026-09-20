# An Export is the whole Map, and an Import replaces what it carries

**This reverses a decision ADR-0020 made and amends one ADR-0017 made, and it
has to be read as that rather than as an extension.** ADR-0020 says an Export
must not carry the Summary and that `toPinExport`'s allowlist is what guards it.
ADR-0017 says *"Import only ever adds… so it asks for no confirmation"*, and that
Delete Map is the only thing in the app that cannot be undone. Both of those are
now narrower than they were, deliberately, and this records what was given up.

**What changed and why.** An Export was a list of Pins, which is not a backup of
a Map. A Map now has a Summary and Regions, and an Export that carries neither
cannot restore the Map it came from — the Owner gets their Pins back and loses
what the Map said about itself and how it was divided up. ADR-0017 named this
exact trade and chose the other side: *"The alternative was a Replace mode that
would make an Export a true backup, restorable in one gesture. It was rejected
because it is a second irreversible action, reached from a dialog the Owner
opened to do something safe, one radio button away from the safe thing."* The
thing that reopened it is that a Map is now bigger than its Pins. An export
format that describes a third of a Map is a worse answer than a confirmation
dialog.

**The rule is narrow, and the narrowness is the whole design.** Pins are added,
exactly as they always were — re-importing an Export still duplicates every Pin,
and that is still the honest cost ADR-0017 accepted. The Summary and the Regions
in the file **replace** what the Map has. Those two are the Map's own account of
itself (ADR-0021), there is exactly one of each, and merging them means nothing:
two Summaries cannot both be shown, and importing a Region set on top of an
existing one would produce overlapping polygons no reader asked for.

There was no radio button added, which is what keeps this from being the feature
ADR-0017 refused. There is no Replace mode to pick by accident, because replacing
is not a mode — it is what the file says. A file that carries a Summary replaces
the Summary; a file that does not, does not.

**The confirmation appears exactly when something would actually be replaced**:
the file carries a Summary or Regions *and* the Map already has one or some. A
file carrying neither — which is every v1 export, and most of what is in the
wild — is add-only and asks nothing, exactly as before. So ADR-0017's
no-confirmation property is not gone; it is now conditional on there being
nothing to lose, which is the condition it was always really asserting. It is
Reddit's own modal, the same shape Delete Map uses, whose accept button is the
whole of the confirmation.

**What was given up, plainly.** Delete Map is no longer the only irreversible act
in the app; it is one of two. An Import run against a Map that has a Summary and
Regions can destroy both, and there is no undo. `CONTEXT.md` said all three of
these things in as many words and has been corrected in the same commit that
made them false — an out-of-date glossary is worse than none, because it is
believed.

**A v1 file and a bare array must still read**, as Pins, with no Summary and no
Regions. `parseMapFile` is forgiving about the envelope and strict about the
contents, exactly as `parsePinsFile` was. This is not backward compatibility as
a courtesy: it is what makes the no-confirmation path the common one rather than
a corner case, and every Export anyone has ever taken out of this app is a v1
file.

**Absent and empty mean different things, and this is the part most likely to be
"simplified" into a bug.** A file with no `regions` key leaves the Map's Regions
alone. A file with `"regions": []` clears them. That is the same distinction
`summary: ''` already draws against an absent `summary`, and it falls out of the
rule rather than being bolted onto it: the file replaces what it *carries*, and
a file that carries an empty list is carrying the statement "no Regions". Read
carelessly — `regions ?? []` fed to a replace — every v1 import silently erases
the Regions of the Map it lands on, with no error, no confirmation, and nothing
in the response to notice.

`toRegionExport` is an allowlist for `toPinExport`'s reason: `name` and `polygon`
only. No `id`, which belongs to the Map holding the Region rather than to the
Region's account of itself, and no `createdAt`, so an imported Region is stamped
fresh where it lands and its colour is re-derived there — the same consequence
ADR-0018 already accepted for an imported Pin's Category, and for the same
reason. Colours are a reading aid, not data.

The endpoint is `api/map/import`, renamed from `api/pin/import`, and the types
with it. Nothing persists a path, so renaming costs nothing; leaving it would
leave a name that is a lie the moment the route takes a whole Map. The response
answers with what landed — the Pins with their minted ids, the Regions, the
Summary, and a `replaced` count — so the client paints what the Map now holds
rather than what it sent, the way `AddPinRsp` already does.

A future reader should not widen this to Pins. "Replace the whole Map" is one
short step from here and it is the irreversible act ADR-0017 was actually afraid
of: a Map with forty Contributors' Pins on it, emptied by a paste. Pins add.
