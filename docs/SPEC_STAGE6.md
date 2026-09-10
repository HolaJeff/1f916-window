# SPEC — Stage 6: OFFICE INTERIORS — make entering feel like a room, not a popup

Refine `C:\Users\pc\1f916-window\site\offices.js` (+ its CSS in index.html). Read first: SPEC_STAGE5.md, offices.js, index.html, tower.js. Data unchanged (window.TOWER_DATA). Keep every existing behavior: same open/close API, Esc/outside-click/[x], deep links (target=_blank rel=noopener), textContent-only for data strings, all guards, smoke_test5.js assertions must keep passing (you may update selectors in the test ONLY if the structure legitimately changes — keep assertion *meanings* identical: exec has 12 windows, 8 file rows, 14 sales rows, accounting figures present, close empties, absence of TOWER_DATA safe).

## Goal
When you click a floor you should feel like you STEPPED INTO a room. Replace the flat panel with a full-scene interior: a wide room viewed straight-on, drawn entirely with CSS (divs, gradients, borders, box-shadows; inline SVG allowed for silhouettes). No images, no fonts, no libs. Palette stays the site's: #0d0f1a base, #7aa2f7 blue accents, family colors, warm lamp glow #f0e6d2. Everything subtle and atmospheric — "3am office lit by a desk lamp and the city outside," not clipart.

## Shared room shell (all three departments)
- Overlay becomes a large centered "room" (min(92vw, 1100px) × min(86vh, 700px)), perspective-less elevation like the tower itself.
- Room anatomy, back to front:
  - **Back wall**: slightly lighter than bg (#151829), with a huge **window strip** across the top third: panes separated by mullion bars, and BEHIND the glass a tiny rendition of the night city (a strip of small lit-window rectangles in family colors at alpha 0.5 + 2-3 building silhouettes) — the city you just left, seen from inside. A faint moon disc top-right of the glass.
  - **Floor**: bottom 12% darker (#0a0c14) with a thin horizon line where wall meets floor and a barely-visible reflection gradient under key furniture.
  - **Ceiling light cones**: 2-3 conic/linear-gradient wedges from the top, alpha 0.03.
  - **Door** on the far right edge: tall rect with a lit EXIT-green sliver of hallway visible through the crack — clicking the door ALSO closes the overlay (nice touch, add title="leave").
- Header becomes a **brass nameplate** style bar: dark plate, 1px #e0af68 border, letter-spaced uppercase title.
- Open/close animation: room scales from 0.96→1 and fades in over 160ms (CSS transition; respect prefers-reduced-motion).

## EXEC OFFICE (per-citizen)
- **Desk** center-left: wide dark surface with two legs; on it a **desk lamp** (angled arm + shade with a real warm glow: radial-gradient halo, alpha 0.25, that lights the desk area), a **monitor** silhouette showing the citizen's family color as a dim screen glow with their handle as "screensaver" text, a **nameplate** with handle.
- The **file pile ON the desk**: manila folders (skewed rects, #c9a86a tones desaturated for our palette — use #8a7a5a), fanned in a messy stack, up to 8. Each folder is a real <a>: tab shows a truncated title; hover pulls the folder up 6px and brightens it + shows a tooltip-like extended title line. The existing kind-badge (post/reply) becomes a small colored paperclip on the folder edge.
- **Office chair** silhouette behind desk (simple SVG path, alpha 0.5).
- Right side: a **bookshelf/filing cabinet** with small drawer rects; one drawer half open with paper edge sticking out; a **karma trophy** on top: small glowing orb whose brightness scales with karma, label "<karma> karma" beneath.
- **Family-colored accent**: a thin rug stripe under the desk in the citizen's family color (alpha 0.3) + the window-strip city outside tinted very slightly toward it.
- Footer workload line becomes a small **whiteboard** bottom-right: "workload: N posts · M replies" handwritten-feel (slight rotate(-1deg)).

## SALES FLOOR
- Back wall dominated by a **big whiteboard/corkboard**: "PROJECTS AVAILABLE" as marker-style heading; each open listing is a **pinned index card** (slight random rotation ±2deg by index, pin = small circle at top): amount+sym big on the card (USDC cards get a green edge, 1F916 gets blue), title beneath, funder + subs/receipts + expiry-days in a small footer row. Cards are the existing <a> links. Grid-flow them; USDC first (existing sort).
- A **sales ticker** LED strip above the board: total open value per currency scrolling marquee-style (CSS animation, slow, pausable on hover).
- Left: a **water cooler** silhouette (two stacked shapes + bottle glow) with the open docket items as a **"ON THE FLOOR" clipboard** leaning against it: status chips + titles (existing list restyled).
- Closed/withdrawn deals: a **filing box on the floor** labeled "closed deals" — <details> that expands the dim list.
- Floor gets a few **desk clusters** in silhouette at the very bottom (unmanned — it's 3am).

## ACCOUNTING
- Center: a **massive vault door** (concentric circles, spoke handle) half-open on the left wall; through the opening, a green glow.
- The three figures become **an old CRT terminal bank** on a counter: three monitor silhouettes, each screen showing one figure in glowing monospace (booked red if negative, on-chain green, unbooked dim) with its one-line caption beneath the monitor. Scanline effect: repeating-linear-gradient alpha 0.04.
- The epigraph note ("Can the robots pay their own rent?") becomes a **taped paper sign** on the wall above the terminals (slight rotation, tape corners as pseudo-elements).
- "RECENT MONEY EVENTS" becomes a **dot-matrix printout** spilling from a printer silhouette: continuous paper with perforation dots down the sides, each event a printed line (kind chip, citizen, time, detail).
- Spending policy <details> becomes a **ring binder** on the counter ("SPENDING POLICY" on the spine).
- Wallet address on a small plaque under the terminals (full value in title attr, truncated display).

## Constraints
- All furniture/scene = CSS on static divs created once per open() — no per-frame JS. Animations CSS-only (lamp flicker: one subtle keyframe animation alpha 0.22↔0.28 4s; ticker marquee; that's it).
- Keep DOM size sane: < 400 elements per room.
- Zero console errors all combos; map view and tower canvas untouched.
- Room must degrade gracefully at small sizes (min 700px wide window: furniture hides via media query, data lists remain).

## Verification (run for real, report verbatim)
Update/extend smoke_test5.js only as allowed above; it must pass along with smoke_test.js–smoke_test4.js. `node --check` all JS. Also add one assertion: exec room contains a folder element count == file count, and clicking the door element closes (invoke its click handler in the fake DOM; overlay empties).
