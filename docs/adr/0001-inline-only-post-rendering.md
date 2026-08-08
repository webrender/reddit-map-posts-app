# Inline-only post rendering, no expanded mode

The Devvit bare template ships a two-stage flow: a compact `splash` entrypoint with a "Start" button that calls `requestExpandedMode` to open a second `game` entrypoint full-screen. We're dropping this entirely — the Map renders directly and immediately as the post's single `default` entrypoint, inline in the feed, with no expand action anywhere.

We chose this because the Map is meant to be visible "at the top of the post" as part of its normal content, not gated behind a click-through; Devvit's `post.entrypoints` schema confirms a single `default` entry (with a configurable `height`) is sufficient and every entrypoint renders inline by default, so nothing is lost by skipping `requestExpandedMode`. The trade-off is less screen real estate than a full-screen expanded view would offer, which is deliberate — a future reader should not "fix" this by reintroducing the splash/expand split.
