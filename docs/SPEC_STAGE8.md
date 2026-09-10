# SPEC — Stage 8: THE READING ROOM — click a post anywhere, read the whole thread

Extend `C:\Users\pc\1f916-window\site\`. Read first: SPEC_STAGE7.md, offices.js, world.js, tower.js, live.js, index.html, smoke_test5.js. Data files untouched. This stage adds a new file `reader.js` (loaded after offices.js) plus small wiring changes in world.js/tower.js click handling and CSS in index.html.

## Goal
Clicking a post ANYWHERE — a dot in the map's Square, a post window on the tower's Square floors — opens THE WHOLE THREAD as a readable document: the full post body and all comments, fetched live from the public API. Reading the society without leaving the world.

## Data source (live fetch, read-only, CORS-open — verified)
`GET https://1f916.ai/api/post/<id>` → `{ post: {id,ref,title,body(full),author,author_model,votes,weighted_votes,comments,created_at,pinned,mod_state?}, comments: [{id,ref,parent_id,intended_parent_id,depth,mod_state,created_at,author,author_model,body,votes,flags}], comments_total, comments_returned, has_more, tags: [...] }`
- 10s AbortController timeout; single in-flight request; small LRU cache (last 10 threads, Map).
- If `has_more` on comments: show "showing X of Y replies — full thread on the board" line (do NOT paginate in v1).
- Offline / fetch failure: sheet shows the post title + author + votes from the local point data (we have it in WORLD.posts) + a dim "couldn't reach the board — read there:" with the outbound link. Never throw.

## Presentation: "the reading room" sheet
Reuse the stage-7 document-layer mechanism (backdrop over canvas works outside rooms too — mount the layer on document.body when opened from map/tower directly; inside an office room, mount inside the room as stage 7 does):
- Sheet styled as a **broadsheet page**: paper #10131f (keep it dark — we're not printing), max-width 720px, 84vh, scrollable.
- **Masthead**: post title (16px bright), byline `by <author> · <family chip> · <relative time> · #<ref>`, vote count as a small stamp top-right (`▲ N`), pinned = small ribbon. mod_state collapsed/removed → show the state plainly instead of body.
- **Body**: full text, pre-wrap, 13px, line-height 1.6. Bare URLs in body text stay plain text (do NOT auto-linkify — untrusted).
- **Comments**: threaded by parent_id with depth indent (cap visual indent at 5 levels; deeper = flat with "↳ replying to c<parent>"). Each: author + family chip + relative time + votes; body pre-wrap. mod_state rows: render placeholder "[collapsed by moderation]" / "[removed]" instead of body. If intended_parent_id ≠ parent_id, add dim marker "(moved by depth cap)". Family chip = small colored square using the stage-1 classifier (WorldAPI.classifyModel is exposed).
- Loading state: sheet opens instantly with title from local data + a subtle "fetching thread…" shimmer line, body fills in when the response lands.
- Footer: stamped `[open on the board →]` outbound link + `esc to close`.
- All data via textContent. < 1 element per comment overhead; virtualize nothing (threads are small — comments_total rarely > 100).

## Wiring
- world.js map view: post dot click (hitTest already returns {type:'post'}) → `window.Reader.open(id, localData)`. Citizens stay hover-only.
- tower.js Square-floor post windows: same.
- Exec folder sheets (stage 7): the stamped outbound link stays, but ADD a second action `[read here]` → Reader.open(post_id) — folders for comments open the parent post's thread.
- Sales listing sheets: if post_id, add `[read here]` too.
- Esc layering extends: reader sheet → (office sheet) → room → nothing.
- Guard everywhere: absent Reader → old behavior (direct link).

## Verification (run for real, report verbatim)
`smoke_test6.js`: vm-load everything + reader.js with a stubbed fetch serving a canned /api/post/3544-shaped response (post + 4 comments incl. one nested, one mod_state collapsed, one moved by depth cap). Assert: Reader.open builds sheet with title, body, 4 comment rows, collapsed placeholder text, moved marker present; comment threading indents (check a depth attr/class); offline path (fetch rejects) still shows title + outbound link without throwing; Esc closes reader before room; cache hit on second open (fetch called once — count stub calls). Re-run smoke tests 1–5 unchanged. `node --check` all. Report outputs.
