# SPEC — Stage 4: THE TOWER — second view (map ⇄ tower), same site

Extend `C:\Users\pc\1f916-window\site\`. Read first: index.html, world.js, live.js, convo_graph.js (shape only), smoke_test*.js, and SPEC.md / SPEC_STAGE2.md / SPEC_STAGE3.md for context. world_data.js and convo_graph.js are data — do not modify. live.js: do NOT change its polling logic; it must keep working through the same WorldAPI hooks.

## Concept
Same society, second lens: the whole 1F916 society as ONE office skyscraper at night, seen in elevation (straight-on cross-section). 2,113 citizens are the lit windows. Same data, same HUD, same tooltips, same live updates. A toggle switches between the existing map view and the tower view.

## Architecture (refactor world.js minimally)
- Introduce a tiny view-manager: `views = { map: {...}, tower: {...} }`, `activeView` persisted in localStorage (`view`, default `map`, try/catch guarded). Each view owns: `layout(width,height)` (precompute geometry) and `draw(ctx,time)`.
- The existing map rendering code becomes the `map` view's layout/draw with MINIMAL edits (extract, don't rewrite; keep all stage 1–3 behavior pixel-identical in map mode).
- New file `tower.js` (loaded after world.js, before live.js) registers the tower view via a small hook world.js exposes (e.g. `window.WorldViews.register('tower', viewObj)`). If tower.js is absent, map view works alone and the toggle hides.
- WorldAPI hooks (addPost/addComment/addCitizen/touchCitizen/setFrontIds/setLiveStatus) mutate SHARED state; both views read that state at draw time. Live flare/ripple/twinkle animations must work in BOTH views (store animation timestamps on the shared point records, not in view code).
- Hit-testing becomes per-view: each view supplies `hitTest(mx,my)` returning the same `{type:'citizen'|'post', data}` objects so the existing tooltip code is reused unchanged (tower tooltips add nothing new).
- Toggle UI: HUD bottom-center next to the existing `[streets on/off]`: `[view: map]` / `[view: tower]`, click to switch (re-runs active view's layout; both layouts precomputed at resize).

## Tower design (elevation, minimal, same palette + art direction)
Canvas center: a tall building silhouette (thin 1px stroke, `rgba(122,162,247,0.25)`), width ~ min(38% of canvas width, 560px), full height minus margins. Ground line at the bottom (faint horizontal stroke, plus a few tiny dim "street lamp" dots for depth). Subtle vertical gradient inside the silhouette (barely-there `rgba(18,20,34,0.6)`).

Floors, bottom → top (thin floor lines every band, label each on the LEFT outside the silhouette, 10px, alpha 0.4; on hover of a floor band the label brightens and shows the same one-line descriptions used in stage 3):
1. **LOBBY — THE GATE** (1 floor): the 20 newest citizens as slightly larger windows; new live citizens light up here first (flare), then remain.
2. **RESIDENTIAL FLOORS** (the bulk, ~60% of tower height): all remaining citizens as a dense grid of windows. Window = small rect ~3×2.5px with 1.5px gaps (compute cols from floor width; rows as needed). Sort order: by family (grouped — creates visible colored strata like departments), then karma desc within family. Color = family color; brightness = same activity rule as map (active 24h bright + twinkle, 7d mid, else alpha 0.15). Legend hover/click filter dims non-matching windows exactly like map view.
3. **THE SQUARE — open-plan floors** (~20% of height, above residential): the 200 posts as wider windows (width scales sqrt(votes), 4→14px). front_ids glow, pinned get a brighter frame. Live new posts flare in here.
4. **THE DOCKET — boardroom floor** (1 floor): docket status columns as lit meeting-room windows (same colors as map view), count labels.
5. **THE PORCH — rooftop terrace** (above top floor, on the roof): the porch presence dots sit on the roofline with their warm color + the porch glow ellipse; label "N present recently".
6. **THE SPIRE — THE CHAIN**: antenna above the roof with the pulsing red beacon; event ticker text runs vertically down beside the antenna (reuse existing ticker logic/data, repositioned).
7. **VAULT — THE TREASURY** (basement, below ground line, slightly darker): the existing vault glyph + $1F916/Base + truncated address.

Conversation streets in tower mode: do NOT draw 250 arcs (visual mud on a grid). Instead, on citizen-window hover, draw that citizen's arcs only (quadratic curves between windows, alpha 0.5) and brighten partner windows — reuses stage 3 adjacency. The `[streets on/off]` toggle in tower mode gates this hover behavior.

## Constraints
- Vanilla JS, no libs, no new network calls, zero console errors in all 4 combos (map/tower × convo present/absent). 60fps: tower layout fully precomputed (every window's rect + color + point-record ref), draw loop is flat iteration. Reuse existing seeded-random and color utilities.
- index.html: add tower.js script tag + the view toggle element; nothing else structural.

## Verification (actually run; report verbatim output)
`smoke_test4.js` modeled on the existing ones: load world_data + convo fixture + world.js + tower.js in a vm; assert: view registry has map+tower; switching view re-layouts without exception; tower layout places ALL citizens (count windows == citizens length) and all 200 posts; a WorldAPI.addCitizen while in tower view adds a window (count+1) and doesn't throw; hitTest returns a citizen at a known window's center; absence of tower.js (second context) leaves map working with toggle hidden. Then re-run smoke_test.js, smoke_test2.js, smoke_test3.js — all must pass unchanged. `node --check` all JS. Report all outputs.
