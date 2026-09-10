# SPEC — Stage 10: STREETS OF LIGHT — 3D streets, click-to-read, souls in transit

Extend `C:\Users\pc\1f916-window\site\city3d.js` (+ minimal index.html CSS if needed). Read first: city3d.js (current 3D view — understand its layout tables: tower positions by post id, citizen positions by handle), world.js (view services, hitTest contract, WorldAPI), reader.js (window.Reader.open API), convo_graph.js shape (window.CONVO: pairs [a,b,replies,contested], recent_pairs), smoke_test7.js. Data files and live.js untouched. Map/tower views untouched.

## A. Conversation streets on the ground
For each CONVO pair where BOTH handles have 3D positions (citizen blocks): draw a ground-level light path — THREE.Line (or fat-ish via 2 parallel lines is unnecessary; single Line fine) following a gentle quadratic bezier ON the ground plane (y ≈ 0.15, control point offset perpendicular like the 2D map), sampled ~24 points.
- ONE THREE.LineSegments or merged BufferGeometry for ALL static streets (single draw call): per-vertex colors — mixed family color, alpha via vertex color brightness (log-scale by replies like 2D). Material: LineBasicMaterial vertexColors, transparent, opacity 0.35, depthWrite false.
- Cap 250 streets (same rule as 2D).
- recent_pairs streets: slightly brighter base color + include in pulse set — pulse by modulating material opacity of a SECOND merged geometry holding only recent streets (0.25↔0.5 sine, slow).
- `[streets on/off]` toggle now also works in city3d (show it again in this view): toggles both merged street objects' visibility. Persisted key unchanged.

## B. Click-to-read + hover
- Raycaster on pointer events over the 3D canvas (reuse OrbitControls' domElement listeners carefully — distinguish click from drag: pointerdown/up within 5px and <300ms = click).
- **Hover** (pointermove, throttled to ~30/s): raycast against towerMesh (InstancedMesh instanceId → post) and citizenMesh (instanceId → citizen). Reuse the EXISTING 2D tooltip element/format (world.js exposes or replicate: post = title/author/votes/comments/age; citizen = handle/family/karma/joined/active + talks-with line from CONVO adjacency). Also set cursor:pointer when over something.
- **Citizen hover highlight**: that citizen's streets brighten — implement via a THIRD small dynamic geometry rebuilt on hover (only their ≤20 streets), drawn opacity 0.8; partner blocks get temporary bright instanceColor (restore on leave — keep a small undo list, no full recolor pass).
- **Click tower** → window.Reader.open(post.id, localData) — the existing broadsheet reader overlays the 3D view (it's DOM; verify z-index above 3D canvas).
- **Click citizen block** → open the reader? No — citizens have no single thread; instead pin the tooltip open (sticky until next click elsewhere), same as hovering but persistent.
- Guard: Reader absent → tower click no-ops.

## C. Souls in transit
Ambient life: small glowing motes traveling along streets.
- Pool of 60 sprites (THREE.Points with a single PointsMaterial, size ~2.5, additive blending, soft circular alpha texture generated on a tiny canvas — radial gradient white→transparent, 32×32).
- Each mote: picks a random street from recent_pairs (fallback: any street), travels endpoint→endpoint over 6–14s (ease in-out), waits 1–3s, picks another street sharing the endpoint if any (feels like walking a route), else random. Color = family color of the citizen at its ORIGIN endpoint.
- Position update in the render loop from precomputed street point arrays (no allocation; write into the Points position attribute, needsUpdate).
- When live.js touchCitizen fires (WorldAPI hook — city3d can subscribe by wrapping the existing addComment/touchCitizen hooks non-destructively): spawn a brief bright flare mote at that citizen's block (rise + fade, 2s) — the 3D equivalent of the 2D ripple.
- Motes hidden when streets toggled off.

## D. Live hooks in 3D
Already-shared state handles data; visually: new post while in city3d → its tower grows in over 1s (scale y anim) at a deterministic position; new citizen → block flares in at the Gate borough edge. If implementing generically is heavy, minimum: new posts/citizens appear on next view activation AND a flare marks live comment activity (C above). State the choice honestly in the report.

## Perf budget
Still ≤6 draw calls added (3 street geoms + 1 points + towers/citizens existing). No per-frame allocations. 60fps.

## Verification (run for real, report verbatim)
`smoke_test8.js` (extend the stage-7 fake-THREE recording approach — add fakes for Line/LineSegments/BufferGeometry attributes/Points/Raycaster/CanvasTexture): assert street geometry built with ≤250 streets and both endpoints resolved; recent set separate; toggle flips visibility flags; click-path: simulated raycast hit on towerMesh instanceId N routes to Reader.open with the right post id (stub Reader records calls); citizen hover populates tooltip text and highlight geometry ≤20 streets; motes pool == 60; hooks wrapped not replaced (original addComment still runs — assert via call-through counter). Re-run smoke tests 1–7 unchanged. `node --check` everything. Report outputs + honest statement of the live-visual choice in D.
