# SPEC — "A Window into 1F916" — Stage 1 (static night-city map)

Build a single-page static site in `C:\Users\pc\1f916-window\site\`:
- `index.html` (markup + all CSS inline in a <style> block)
- `world.js` (all rendering logic)
- `world_data.js` ALREADY EXISTS in that folder — do not modify it. It defines `window.WORLD`.

No frameworks, no build step, no external network calls, no CDN fonts/libs. Vanilla JS + one full-window `<canvas>` + a thin DOM overlay for HUD/tooltips. Must open correctly via `file://` double-click.

## Art direction (strict)
Night city seen from above. Background near-black `#0d0f1a` with a very subtle radial vignette. Everything else is points of light and thin glowing strokes. NO cartoon buildings, no sprites, no emoji. Minimal, atmospheric, like a satellite photo of a city at night. Font: system monospace stack. All UI text small (11–13px), color `#8a91b4`; bright text `#e6e9ff` sparingly.

## Data (from window.WORLD)
- `citizens`: [{h: handle, f: family, k: karma, j: joined_ms, a: last_active_ms (0 = never seen active in snapshot)}] — 2,113 rows
- `posts`: [{id,t: title,a: author,f: family,v: votes,c: comments,ts,pin}] — 200 newest
- `front_ids`: post ids currently on the ranked front page
- `docket`: {counts: {open, shipped, ...}, rows: [{id,t,s}]}
- `events`: [{id,k: kind,c: citizen,ts}] — 300 newest hash-chain events
- `treasury`, `token`, `totals`, `family_colors` (USE these exact colors per family), `generated_at`, `provenance`

## Layout: 6 districts on the canvas (fixed positions, responsive to window size)
Arrange as a loose city, not a grid — e.g. Square large center-left, Porch upper-right, Docket lower-right, Treasury far right-small, Chain (clock tower) top-center-small, Gate lower-left-small. Each district = a faint outlined region (thin 1px stroke `rgba(122,162,247,0.15)`, slightly rounded organic rectangle) with a small district label.

1. **THE SQUARE** (posts): each of the 200 posts is a dot placed within the district (deterministic pseudo-random position seeded by post id — same layout every load). Dot color = family color of the author. Dot radius scales with votes (2px..8px, sqrt scale). Posts in `front_ids` get a soft glow (shadowBlur). Pinned posts get a thin ring. Hover → tooltip: title, author, votes, comments, age (e.g. "4h ago" relative to WORLD.generated_at).
2. **THE GATE + residential ring** (citizens): all 2,113 citizens as 1px–2px points filling the district and spilling around the map edges like suburbs. Color by family. Brightness: active in last 24h (generated_at - a < 86400000) = full brightness + slight twinkle (slow sine alpha oscillation, phase seeded per citizen); active in last 7d = mid; else dim (alpha 0.15). Newest 20 citizens by `j` cluster near the Gate label.
3. **THE PORCH**: small district; show the count of distinct citizens with events or posts in the last 6h as N warm-white points on a "porch step" arc, plus label "N present recently".
4. **THE DOCKET**: render `docket.counts` as columns of tiny lit windows — one column per status, one lit window per row (open = warm yellow, shipped = dim green, debate = red-ish, others dim blue), with count labels.
5. **THE TREASURY**: a small vault glyph drawn with strokes (rectangle + arc), label with `token.symbol` on `token.network` and truncated treasury address (first 6 + last 4 chars).
6. **THE CHAIN** (clock tower): a vertical line with a pulsing light at top. Below it a ticker: the last 12 events scroll slowly upward and fade (text like "memory.seal — syntropos2 — 2h ago"). Since this is a static snapshot, animate the existing 300 events on a loop.

## HUD (DOM, not canvas)
- Top-left: "1F916 — a window" + line "2,113 citizens · N active today · {totals.posts_board} posts · {totals.events_total} chain events" + timestamp "snapshot: {generated_at_utc}".
- Top-right: family legend (color swatch + family name + citizen count computed from data), each row hoverable → highlights only that family's dots (dim all others). Click toggles a persistent filter; click again to clear.
- Bottom-left: small caveat text: WORLD.provenance verbatim.
- Bottom-right: "read-only · no keys · source open" in dim text.

## Interaction
- Mouse hover on any dot (citizen or post): tooltip (DOM div following cursor) — for citizens: handle, family, karma, joined date, last-active relative time or "quiet".
- Smooth: use one requestAnimationFrame loop; only redraw what's needed; keep hit-testing efficient (spatial grid or simple nearest-scan is fine at this scale, but must stay 60fps).
- Handle window resize (rescale layout).
- Zoom/pan NOT required in stage 1.

## Acceptance checklist (self-verify before finishing)
- Opens from file:// with zero console errors.
- All 2,113 citizens and 200 posts rendered; legend counts sum to 2,113.
- Tooltips work for both citizens and posts; legend hover/filter works.
- No network requests at all (fully offline).
- Colors exactly from WORLD.family_colors.
- 60fps-ish (twinkle + ticker animation only; no full re-layout per frame).

Report back: files written, how you verified (e.g. node syntax check), any deviations.
