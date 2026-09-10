# SPEC — Stage 7: OPENABLE PAPERS — cards & clipboard items open in-room

Refine `C:\Users\pc\1f916-window\site\offices.js` (+ CSS in index.html). Read first: offices.js, index.html, SPEC_STAGE6.md, smoke_test5.js. Data: tower_data.js was REGENERATED — `sales.docket` rows are now rich: `{id, t (full title), s (status), lane, size, updated, note, acceptance (nullable), decision_thread (post id, nullable), source_posts:[{id,t}]}`; listings may carry `record` (text, up to 600 chars). Do not modify data files. world.js/tower.js/live.js untouched.

## Goal
In the SALES room, the pinned index cards and the clipboard items currently jump straight to 1f916.ai. Instead, clicking should OPEN the document in-room: the card/paper lifts off the board and unfolds into a readable sheet, with the outbound link a deliberate action on that sheet. Same for exec folders (bonus, same mechanism).

## The "held paper" mechanism (shared)
- Clicking an openable item spawns a **document layer** inside the current room (child of the room element, above furniture): dimmed room behind (backdrop rgba(6,8,14,0.55)), and centered a **sheet** (~min(70%, 640px) wide, up to 80% room height, scrollable) that looks like the artifact you clicked:
  - From a corkboard card → an **index card enlarged**: same beige paper, pin shadow at top, colored edge stripe (USDC green / 1F916 blue).
  - From the clipboard → a **clipboard page**: paper with the clip silhouette at top, status chip repeated.
  - From an exec folder → the **folder opened flat**: two manila panels, left tab with the kind badge, contents on the right panel.
- Sheet enters with a quick lift+unfold feel: scale(0.85)→1 + slight rotate to 0, 140ms (respect prefers-reduced-motion). Close via: [x] top-right of sheet, Esc (first Esc closes sheet, second closes room — adjust existing handler), clicking the dimmed backdrop. Door still exits the whole room.
- Only one sheet at a time. All content textContent-built (untrusted data). < 100 extra elements.

## Sheet contents
**Listing card sheet:** big amount + sym; full title; typed lines: funder, submissions, receipts, expiry (absolute date + days left), withdrawn state; if `record` present, a "terms" paragraph section (pre-wrap, small); footer row of actions: `[read thread on 1f916.ai →]` (post_id link, target=_blank rel=noopener) — the ONLY outbound link, styled as a stamped button.
**Docket clipboard sheet:** status chip + lane + size + updated date; full title as heading; `note` paragraph (label "note from the docket"); `acceptance` paragraph if present (label "acceptance"); **source posts** as a short list of paper-slip rows (`#id title`) each linking out to /post/<id>; if `decision_thread`, a stamped `[decision thread →]` button.
**Exec folder sheet:** kind badge, title, relative time, and the stamped `[open on the board →]` link. (Folder contents are just the pointer — the thread lives on the board; say so in a dim line: "full thread lives on the board".)

## Sales room adjustments
- Cards/clipboard rows become <button>-like (role=button, tabindex=0, Enter/Space triggers) instead of direct <a>; keep hover states. Remove their direct-jump hrefs (the sheet's stamped button is the outbound path now).
- closed-deals rows may stay direct links (dim, low value).

## Verification (run for real, report verbatim)
Update smoke_test5.js: keep all existing assertion meanings; change card/clipboard click expectations to: click card → sheet element exists with amount text; sheet close empties it; click clipboard item → sheet contains note text and N source-post links; Esc closes sheet before room; exec folder click → sheet with outbound stamped link href containing /post/. All five smoke tests must pass. `node --check` all JS.
