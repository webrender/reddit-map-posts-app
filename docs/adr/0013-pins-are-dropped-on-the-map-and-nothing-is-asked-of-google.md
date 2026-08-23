# Pins are dropped on the Map, and nothing is asked of Google

> **Extended by ADR-0015.** An armed drop also accepts a Google or Apple Maps link pasted into it, which is read on the device for the coordinates and name already in it. Everything below still holds — no key, no host, no request, nothing asked of anyone — because the Owner is the one who opened the link and copied it. Short links are refused rather than followed, which is what keeps that true.

Place Search is removed. There is one way to add a Pin — click the Map — and this app makes no request to any Google API, holds no Google API key, and stores no coordinate that came from one.

**Why, and it is not a technical reason.** Google's Maps Platform terms do not permit its Places data to be used alongside a non-Google base map, and they do not permit its coordinates to be cached beyond a narrow window. This app renders OpenFreeMap tiles and stores every Pin in Redis for as long as the post exists. Both halves of the arrangement were outside the terms, so no amount of care with the request shape or the field mask fixes it: the integration had to go rather than shrink. ADR-0002, ADR-0009 and ADR-0012 all reasoned carefully about cost, quota and secrecy, and none of them asked whether the data was ours to use in the first place.

**One add-path is one control.** The toolbar used to spend a whole face on the choice between the two add-paths: a control that replaced the toolbar with a row holding the search field beside the button that armed the drop. With one path left, that face is a row containing one button and a close, which is worse than no face at all. The Add a Pin control now arms the drop directly and carries the pressed accent that the drop button used to. Adding a Pin went from three gestures to one, and the toolbar went from three faces to two — the second being the Default Area picker that ADR-0014 puts in the vacancy.

The Viewer story is unchanged and is why the control was a single button in the first place: hiding one control is still the whole of what makes a toolbar read-only.

**Every Pin is draggable now.** ADR-0005 made Place Search Pins immovable because their coordinates were Google's answer for a named place, and dragging one only made the Pin disagree with its own Title. Nothing is left that fits that description — every Location is one the Owner clicked — so `Pin.fromPlaceSearch` is gone from the types and the server's refusal to move such a Pin goes with it. Pins stored with the flag still carry it in Redis; nothing reads it, and they became draggable the moment this shipped.

**What is left behind, and what is not.** The `places.googleapis.com` entry in `devvit.json`'s `permissions.http.domains` is removed, which leaves that list and `proxy.ts`'s allowlist agreeing on one host for the first time — the exception ADR-0003 spent a paragraph on no longer exists. The `places-api-key` Redis key is no longer read or written; a subreddit that had one keeps it until the install is removed, and it is inert.

Pins added through Place Search are *not* deleted. Their coordinates did come from Google, but they are the substance of maps people made, they are indistinguishable from a dropped Pin once the flag is ignored, and erasing them would take a Map's content away from its Owner without asking. That is a decision for whoever installed the app, not for a migration. The Default Area is treated differently, and ADR-0014 says why.

A future reader should not restore Place Search on the grounds that it was the better UX — it was — without first checking whether the base map and the search come from the same provider's terms.
