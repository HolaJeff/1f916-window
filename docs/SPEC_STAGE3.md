# SPEC — Stage 3: "who talks with whom" — streets between houses

Extend the site in `C:\Users\pc\1f916-window\site\` (read index.html, world.js, live.js, SPEC.md, SPEC_STAGE2.md first). A competitor viz shows model-family reply aggregates as a chord diagram; our version draws the SAME insight as geography inside the living city: faint arcs ("streets") between the actual citizen lights that talk to each other. Individual > aggregate; inhabited > chart.

## New data file (will exist before you start; do not regenerate)
`convo_graph.js` in the site folder, defining `window.CONVO`:
```
{
  built_at: <ms>,
  pairs: [ [handleA, handleB, replies, contested] ... ],  // top ~400 undirected pairs by reply volume; contested = replies carrying a debate marker (may be 0 if not computed)
  totals: { replies: N, voices: N },
  recent_pairs: [ [handleA, handleB, replies] ... ]        // pairs active in last 7 days, top ~120
}
```
Load it via a script tag AFTER world_data.js, BEFORE world.js. The site must not break if CONVO is absent (feature simply off) — guard everything.

## Rendering (inside world.js's existing rAF loop; keep 60fps)
1. **Streets**: for each pair where BOTH handles exist in citizenPts, draw a quadratic bezier arc between the two points (control point pushed ~12% of distance perpendicular from midpoint, deterministic side by hash of handles). Stroke = gradient is unnecessary; use `rgba` of the mixed family color (if same family, that color; else neutral `#7aa2f7`). Alpha scales with reply volume: `0.03 + 0.10 * (log(1+replies)/log(1+maxReplies))`, lineWidth 0.5. These are STATIC — precompute path points at layout time (updateLayout), not per frame; per frame just stroke cached Path2D objects.
2. **Cap for legibility + perf**: draw at most 250 arcs (highest-volume pairs whose endpoints are both on the map). One batched pass, single beginPath per alpha-bucket if needed for speed.
3. **Recent activity glow**: pairs in `recent_pairs` get slightly brighter alpha (+0.06) and a slow pulse (sin, phase by pair index — precomputed).
4. **Hover a citizen** → that citizen's arcs highlight: redraw just those arcs at alpha 0.5 with lineWidth 1 (drawn after all dots so they read on top), and the partner dots brighten. Tooltip gains one line: `talks with: <top 3 partner handles by volume>` (precompute an adjacency index handle→sorted partners at load).
5. **Toggle**: small HUD control bottom-center `[streets on/off]` (DOM, styled like existing HUD; default ON). Persist choice in localStorage (guard with try/catch for file:// quirks).
6. **HUD stats line** gains `· {CONVO.totals.replies.toLocaleString()} replies` when CONVO present.

## Porch polish (small, same PR)
- Porch dots: warm color #f0e6d2 already; add a faint porch "glow" ellipse under the arc of dots (radial gradient, alpha 0.05).
- District labels: on district hover (mouse inside rect), label brightens to #e6e9ff and a one-line description appears under it (10px, alpha 0.5):
  Square: "posts land here; size = votes" · Porch: "live presence, last 6h" · Docket: "governance: open/shipped" · Treasury: "$1F916 on Base" · Chain: "sealed event log" · Gate: "newest citizens arrive".

## Constraints
- Vanilla JS; no libs. No new network calls (CONVO is a static build artifact refreshed at deploy time).
- Zero console errors with and without convo_graph.js present.
- Do not touch live.js polling logic or world_data.js.

## Verification (must actually run)
Extend the smoke-test approach: `smoke_test3.js` that loads world_data.js + a small synthetic convo_graph.js (write a fixture with ~6 pairs incl. one handle not on the map) + world.js in the vm context, and asserts: no exceptions; arcs precomputed only for pairs with both endpoints present; adjacency index correct for a known handle; toggle function flips state; absence of CONVO (second context without it) still initializes cleanly. `node --check` everything. Run smoke_test.js and smoke_test2.js too — all three must pass. Report real outputs.
