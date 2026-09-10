# SPEC — Stage 9: THE FLYTHROUGH — 3D city shell (view #3)

Extend `C:\Users\pc\1f916-window\site\`. Read first: world.js (view manager, WorldAPI, view registration pattern — see how tower.js registers), tower.js (registration example), index.html, SPEC_STAGE4.md (view architecture). Data files untouched. live.js untouched. Map/tower views must remain pixel-identical.

## Vendored libs (already present — do not download anything)
- `vendor/three.min.js` (Three.js r128, UMD — exposes global `THREE`)
- `vendor/OrbitControls.js` (r128 examples build — attaches `THREE.OrbitControls`)
Load both via script tags before world.js. r128 API notes: `new THREE.OrbitControls(camera, domElement)`, geometry via `THREE.BoxGeometry`, instancing via `THREE.InstancedMesh` with `setMatrixAt` + `instanceMatrix.needsUpdate`, per-instance color via `setColorAt` + `instanceColor.needsUpdate` (supported in r128).

## Concept
Third view `city3d`: the same society as a 3D night city you fly through. Aesthetic = our satellite-night made volumetric: near-black world (#0d0f1a fog + background), buildings as dark boxes with EMISSIVE window light, no textures, no daylight, Blade-Runner-flyover restraint. NOT pixel/voxel toytown.

## New file `city3d.js` (loaded after tower.js, before live.js)
Registers view 'city3d' with the existing manager (init/layout/draw/hitTest contract — study world.js's expectations). The view toggle must cycle map → tower → city3d → map (update toggle labels: current shows `[enter the tower ↑]` in map; make tower show `[fly through ↗]`; city3d shows `[back to the map ↓]`).

### Renderer management
- Create ONE THREE.WebGLRenderer lazily on first activation, its canvas positioned absolutely OVER the 2D canvas (same size, z-index above canvas but below HUD). When city3d inactive: hide the 3D canvas (display:none), stop its render loop (the 2D rAF keeps running for map/tower as now).
- Pixel ratio capped at 1.5. Handle resize. antialias:true. `renderer.outputEncoding = THREE.sRGBEncoding`.
- If WebGL context creation fails: view unregisters itself gracefully (toggle skips it, console.warn once, no throw).

### Scene (stage A = geometry + light + camera; interactions later)
1. **Ground**: large dark plane (#0a0c14), subtle grid helper (color #1a1f35, very dim, 40 divisions) for parallax when flying.
2. **Districts as boroughs** (positions roughly echo the 2D map): Square center-left, Porch NE, Docket E, Treasury SE small, Chain N, Gate SW. Mark each with a flat, very dim colored district plate on the ground (+ a floating district label: canvas-texture sprite, small, #8a91b4).
3. **Post towers** (the Square borough): one box per WORLD.posts (200). Footprint 6×6 units, height = 4 + comments*1.2 (cap 80). Material: near-black body (#11142a). Windows = emissive: use a second InstancedMesh of small emissive planes on tower faces — one lit window per vote (cap 40/tower), color = author family color, emissiveIntensity ~1.2. Pinned posts: thin emissive ring at roofline. front_ids: slightly brighter windows + a faint point light is too costly — instead give roof beacon plane (small emissive quad).
   Deterministic tower placement inside the borough via the existing seededRandom(post.id) pattern (world.js exposes utilities via getViewServices — check what init() receives; else replicate the seeded fn locally, same seeds as map for spatial familiarity).
4. **Residential blocks** (ring around center, matching map's suburb feel): all 2,113 citizens as ONE InstancedMesh of small boxes (2×2, height 2-6 by karma log). Per-instance color = family color; active-24h citizens get brighter color (premultiply 1.6), quiet ones dimmed toward #22263e. (True emissive per-instance isn't available on one material — use MeshBasicMaterial with vertexColors/instanceColor so windows just glow flat; acceptable at night.)
5. **The Chain**: one tall thin spire (height 120) at its district, emissive red beacon box at top — pulse via material.emissiveIntensity in the render loop (reuse time).
6. **Treasury**: low wide vault box with a single amber emissive slit.
7. **Fog**: THREE.FogExp2(#0d0f1a, 0.0035) so distant blocks fade like haze.
8. **Light**: one dim ambient (#1a2040, 0.6). No shadows. Emissive does the work.

### Camera + controls
- PerspectiveCamera fov 55. Start position: high oblique "satellite" vantage showing the whole city (compute from bounding box), looking at city center.
- OrbitControls: enableDamping, minDistance 15 (street level), maxDistance 600, maxPolarAngle 0.49*PI (never below ground). Scroll = dolly, drag = orbit, right-drag = pan — matches the competitor's expected controls.
- Auto-slow-drift when idle >5s (gentle azimuth rotation 0.02 rad/s) — stops on any input. This makes an untouched screen cinematic.

### HUD integration
- Existing HUD (legend, stats, toggles) stays overlaid and functional. Legend hover/click filter: in city3d, non-matching family instances dim to 15% (update instanceColor). Streets toggle hidden in city3d (streets come in stage B).
- Bottom-left keys hint line when city3d active: `scroll zoom · drag orbit · right-drag pan` (reuse the district-description style).

## Perf budget
60fps target on integrated GPU: ≤3 InstancedMeshes + ≤210 regular meshes total. NO per-frame allocations in the loop. Reuse Matrix4/Color temporaries.

## Verification (run for real, report verbatim)
`smoke_test7.js`: vm-load with a THREE stub is NOT meaningful for GL — instead do a structural test: stub `THREE` with recording fakes (classes that record constructor calls: WebGLRenderer→throws in ctor to test the graceful-degrade path in one context; in a second context, fake renderer object with setSize/render/setPixelRatio/dispose) and assert: view registers; activation creates renderer once; toggle cycles 3 views; deactivation hides; WebGL-fail context leaves map+tower working with toggle cycling 2 views; citizen instance count == 2113 recorded; post tower count == 200. Re-run smoke tests 1–6 (must pass unchanged). `node --check` all new/changed JS. ALSO: since fakes can't validate real r128 API usage, grep your own code for each THREE API you call and confirm against r128 (OrbitControls path, InstancedMesh methods) — list the APIs used in your report.
