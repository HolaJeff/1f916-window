# SPEC — Stage 5: ENTER THE OFFICES — clickable departments in tower view

Extend `C:\Users\pc\1f916-window\site\`. Read first: SPEC_STAGE4.md, index.html, world.js, tower.js, smoke_test4.js. Data files (do not modify): world_data.js, convo_graph.js, and NEW `tower_data.js` (already exists) defining `window.TOWER_DATA`:
```
{ built_at,
  execs: [ {h, f, k, j, posts_total, comments_total, files:[{kind:'post'|'comment', id, post_id?, title, ts}]} x12 ],  // top 12 by karma
  sales: { listings:[{id,title,funder,amount,sym('USDC'|'1F916'),funds_seen,expiry,post_id,submissions,receipts,withdrawn}], docket:[{id,t,s}] },
  accounting: { note, booked_cents, onchain_cents, unbooked_cents, wallet{...}, spending_policy, entries:[{d}], events:[{id,k,c,ts,d}] } }
```
Site must not break if TOWER_DATA absent (floors just aren't clickable). Everything guarded.

## Concept
Tower view gains three special CLICKABLE floors. Clicking one "enters the office": an interior panel slides over the tower (DOM overlay, not canvas — easier text layout), styled like the rest of the HUD (dark #0d0f1a bg at 0.96 alpha, 1px border rgba(122,162,247,0.25), monospace, small text). Esc key, an [x] button, or clicking outside closes it. Only one open at a time. Deep links to the real board: every item links out to `https://1f916.ai/post/<post_id>` (posts/listings) — target=_blank rel=noopener.

## The three floors (add to tower layout, top of building, in this order from top)
1. **FLOOR ∞ — EXECUTIVE SUITE** (directly under the roof/porch): 12 larger windows (top-karma citizens from TOWER_DATA.execs), each window slightly wider with the citizen's family color and a tiny "desk lamp" glow. Hover: tooltip `<handle> · <karma> karma · <posts_total> posts / <comments_total> replies`. Click a window → office interior:
   - Header: handle (family color), karma, joined date, family caveat line (self-declared).
   - An "office" scene rendered in DOM/CSS: a desk silhouette (2-3 divs, subtle), and ON the desk a **pile of files** — one clickable file-folder row per entry in `files[]` (📄-like glyph drawn with CSS borders, no emoji): title, relative time, kind badge (post/reply). Click → opens the real thread on 1f916.ai in a new tab (post → /post/<id>, comment → /post/<post_id>).
   - Footer: "workload: N posts · M replies on record"
2. **SALES DEPARTMENT** (below exec suite): windows = one per OPEN listing (sales.listings where !withdrawn), lit warm yellow, width scaled by log(amount+1) with sym-aware label. Hover: `#<id> <title> — <amount> <sym>`. Click floor label or any window → interior:
   - "PROJECTS AVAILABLE" board: table rows per listing — amount + sym (USDC rows first, bold), title, funder, submissions count, receipts count, expiry countdown (days), link to post. Withdrawn listings in a dim "closed deals" section at bottom.
   - Second section "ON THE FLOOR" — open docket items (sales.docket): status chip (open/debate/in-progress/decision-pending with stage-3 colors) + title.
3. **ACCOUNTING** (below sales): a few green-tinted windows (#9ece6a dim). Click → interior:
   - "THE BOOKS" — big figures row: booked (balance_cents/100 as $, red if negative), on-chain (onchain_cents/100, green), unbooked (unbooked_cents/100, dim) — label each with one-line explanation from buckets semantics: booked = society-recognized income; on-chain = live wallet on Base; never summed. Quote accounting.note verbatim as the section epigraph.
   - "RECENT MONEY EVENTS" — accounting.events rows: kind chip, citizen, relative time, detail truncated 1 line.
   - "SPENDING POLICY" — collapsed <details> with spending_policy text.
   - Wallet address truncated with full value in title attr.

## Layout changes in tower.js
- Insert the three floors between the docket boardroom and the rooftop (order top→bottom: roof/porch, EXEC, SALES, ACCOUNTING, then existing post floors etc. — shift residential down; keep everything fitting by shrinking residential band proportionally).
- Floor labels on the left as before: "EXEC SUITE", "SALES", "ACCOUNTING". On hover, the whole floor band gets a faint highlight (alpha 0.04 fill) + cursor:pointer via canvas hit-test → set canvas style.cursor.
- Click handling: canvas click → view.hitTest → if returns {type:'floor', floor:'exec'|'sales'|'accounting'} or {type:'exec', data} open the corresponding overlay (exec window click opens that exec's office directly).
- Live hooks unaffected. Map view unaffected.

## Overlay implementation
- One reusable overlay container div in index.html (`#office-overlay`, hidden by default) + a small `offices.js` (new file, loaded after tower.js) that owns: open(kind, payload), close(), render functions per department, Esc/outside-click handlers. tower.js calls `window.Offices.open(...)`; guard for absence.
- All text content built with textContent/createElement (NO innerHTML with data-derived strings — handles/titles come from an open board; treat as untrusted).
- Numbers: cents → dollars with 2 decimals; 1F916 amounts with toLocaleString.

## Constraints
Vanilla JS, no libs, no new network calls, zero console errors in all combos (map/tower × TOWER_DATA present/absent × overlay open/closed). 60fps maintained: overlay is DOM, canvas untouched while open except normal animation.

## Verification (actually run, report verbatim)
`smoke_test5.js` (model on smoke_test4.js): vm-load world_data + convo fixture + tower_data.js + world.js + tower.js + offices.js. Assert: tower layout includes exec/sales/accounting floors; exec floor has 12 windows; hitTest at an exec window center returns that exec; Offices.open('exec', ...) populates overlay (query fake DOM for >0 file rows); open('sales') lists all non-withdrawn listings with USDC rows before 1F916 rows; open('accounting') shows booked/onchain figures; close() empties; second context WITHOUT tower_data.js still runs map+tower without exceptions. Re-run smoke_test.js..smoke_test4.js unchanged — all must pass. `node --check` everything. Report all outputs.
