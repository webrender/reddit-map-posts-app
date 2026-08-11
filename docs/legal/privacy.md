# Privacy Policy — Map Posts

**Effective date:** 10 August 2026
**Applies to:** the Map Posts app (`map-posts`) for the Reddit Developer Platform

Map Posts is a Reddit app that lets a subreddit member create a post containing an interactive map and add pins to it. This policy describes exactly what the app stores, what it sends to third parties, and what it does not do. It covers the app only — Reddit's own collection of your data is governed by the [Reddit Privacy Policy](https://www.reddit.com/policies/privacy-policy).

## The short version

Everything the app stores is attached to a single Reddit post and is visible to anyone who can view that post. The app sets no cookies, stores nothing on your device, runs no analytics, and never asks for or reads your device's location. The only personal identifier it stores is the Reddit user ID of the person who created the post, and it stores that solely to know who is allowed to edit the map.

## What the app stores

The app stores data in Reddit's Devvit Redis, keyed by post ID. Per map, that is:

**The owner's Reddit user ID.** When a post is created, the app records the creator's Reddit user ID (the `t2_…` identifier, not your email or real name). Its only use is to check, on every edit, that the person making the change is the map's owner. It is returned to the client so the app knows whether to show editing controls.

**The pins on the map.** For each pin: a generated ID, latitude and longitude, a title, and — where the owner supplied them — a category, a description, a link, and an image.

**Uploaded images.** If an owner attaches an image to a pin, the image is uploaded to Reddit's media hosting through the Devvit platform, and the app stores the resulting URL. The image is hosted by Reddit, not by the app.

That is the complete set. There is no separate user profile, no account, and no record of who viewed a map.

## What the app does not do

- **No cookies or device storage.** The app sets no cookies and writes nothing to `localStorage`, `sessionStorage`, or any other browser storage.
- **No device location.** The app never calls the browser's geolocation API. Pins are placed by searching for a place by name or by clicking a spot on the map — never by reading where you are.
- **No analytics or tracking.** There is no analytics SDK, no telemetry, no pixels, and no advertising.
- **No selling or sharing for marketing.** Your data is not sold, rented, or shared with anyone for advertising purposes.
- **No contact details.** The app does not collect email addresses, phone numbers, or real names.

## Everything on a map is public

A map's pins are visible to every Reddit user who can see the post — the same audience as any other content in that subreddit. Pin titles, categories, descriptions, links, and images are all public in that sense.

**Do not put private or sensitive information in a pin.** In particular, do not pin someone's home address or other location they have not chosen to make public, and do not upload images of people who have not agreed to appear on a public map.

Note also that a new map post is titled `{username}'s Map` using the creator's Reddit username at the moment of creation. That title is an ordinary Reddit post title and is public like any other.

## Third-party services

The app contacts two external services. Both are contacted **from the app's server**, not from your browser — so neither one receives your IP address, your user agent, or any other information about your device.

**OpenFreeMap** (`tiles.openfreemap.org`) supplies the map's base imagery: the style, sprites, fonts, and vector tiles. Because the app's webview cannot reach non-Reddit hosts directly, every one of these requests is fetched by the app's server and forwarded on. OpenFreeMap therefore sees requests coming from the app's server infrastructure and cannot identify or profile individual viewers. The only information in such a request is which map tile is needed, which follows from where the map is scrolled.

**Google Places API** (`places.googleapis.com`) powers place search, and is contacted only when a map owner actively types into the place-search box. The typed search text is sent to Google along with the subreddit's own API key, and the app requests only two fields back — the place's display name and its coordinates. Nothing about the Reddit user, the post, or the subreddit is sent. Google's handling of that query is governed by the [Google Privacy Policy](https://policies.google.com/privacy) and the Google Maps Platform terms. If a subreddit has not configured an API key, place search is simply unavailable and no request is ever made to Google.

**Reddit** hosts the app, its storage, and its uploaded images. All app data lives on Reddit's Developer Platform infrastructure.

## A note for subreddit moderators

The Google Places API key is entered as a per-subreddit app setting. Because the Devvit settings schema supports masking only on app-wide settings, a subreddit-scoped key is stored and displayed as plain text in that subreddit's app settings screen, where other moderators of that subreddit can read it. This is a deliberate trade-off — it keeps API cost and quota with the subreddit generating the traffic rather than pooling every install onto one key — but treat the key accordingly: scope and restrict it in the Google Cloud Console, and rotate it if your moderator team changes. See `docs/adr/0002-subreddit-scoped-unmasked-places-api-key.md`.

## Retention and deletion

Map data persists for as long as the post exists and the app remains installed.

- **Deleting a pin** removes its record — including its text, coordinates, and the stored image URL — from the app's storage immediately.
- **Deleting the Reddit post** removes the map from view. Residual app data is cleared according to Reddit's data handling for deleted posts and uninstalled apps.
- **Uploaded images** are stored on Reddit's media hosting. Deleting a pin removes the app's reference to the image; the underlying media asset is retained or removed according to Reddit's own media retention practices, which the app does not control.

If you want data associated with a map removed and you cannot do it yourself, contact the subreddit's moderators or the app developer at the address below.

## Your choices

- As a **map owner**, you control every pin on your map: you can edit or delete any of them at any time, and you can delete the post entirely.
- As a **viewer**, the app stores nothing about you at all — viewing a map creates no record.
- As a **moderator**, you can uninstall the app from your subreddit at any time.

## Children

Map Posts is available only through Reddit and is subject to Reddit's own age requirements. The app is not directed at children under 13 and does not knowingly collect information from them.

## Changes to this policy

If this policy changes materially, the effective date above will be updated and the change will be visible in this repository's commit history.

## Contact

Questions about this policy, or requests concerning data associated with a map: webrender+devvit@gmail.com.

Issues may also be raised at https://github.com/webrender/reddit-map-posts-app/issues — but please do not include private information in a public issue.
