# SPEC — Stage 2: live polling ("the city breathes")

Modify the existing site in `C:\Users\pc\1f916-window\site\` (index.html, world.js — read both first; world_data.js is the static snapshot fallback, do not modify it). Add a new file `live.js`, loaded after world.js. Keep everything working offline: if fetch fails (offline / file:// CORS quirk), the site must behave exactly as stage 1 — static snapshot, plus a dim "· offline snapshot" suffix in the HUD timestamp line. Never throw.

## API facts (verified today — trust these)
- Base: `https://1f916.ai`. CORS is open (`Access-Control-Allow-Origin: *`), plain GETs, no auth, no keys. NEVER add any auth header or key field.
- `GET /api/changes?since=<ms>&posts_since=init&comments_since=init` → lossless ID mode.
  - Response fields used: `posts[]`, `comments[]`, `now`, `next_posts_since`, `next_comments_since`, `has_more`.
  - CONTRACT: `init` is one-time. After the first call, carry `posts_since=<next_posts_since>&comments_since=<next_comments_since>` verbatim (tokens look like `id:3618` or `snapi:...`), plus keep passing the same original `since`. Never re-send `init`. Never mix modes. On any 400, stop polling for the session (set offline badge), don't retry-loop.
  - Add `&nulls_since=done` to every /api/changes call to silence the nulls stream (we don't need it and it's 200 rows of noise per page).
  - If `has_more` is true, fetch the next page immediately (max 5 pages per cycle), else wait for the next interval.
- `GET /api/citizens?since=<ms>` → `{citizens:[{citizen_id,handle,model,karma,votes_cast,created_at}], has_more, next_since}` — poll for NEW citizens only, using WORLD.generated_at as the first `since`, then `next_since`.
- `GET /api/front?limit=40` → `{posts:[...]}` ranked; refresh `front_ids` from it.
- Post rows in /api/changes have the same shape as WORLD.posts source: `{id,title,author,author_model,votes,comments,created_at,pinned}` (body irrelevant). Comment rows: `{id,parent post via post_id or similar — INSPECT the actual response shape with curl before coding and adapt; if a comment's post isn't on the map, just count it for activity, don't crash}`.

## Polling cadence (be a polite citizen — shared public service)
- /api/changes: every 60s
- /api/citizens (new only): every 5 min
- /api/front: every 5 min
- Stagger them (don't fire all three at t=0 simultaneously; offset by a few seconds).
- Pause all polling when `document.hidden`; resume + immediate poll on visibility.

## Model-family classifier (must match stage 1's data)
Port to JS, first match wins, case-insensitive substring on model string:
claude→claude; gpt|openai|codex|o1|o3|o4→gpt; gemini|antigravity|bard|palm→gemini; deepseek→deepseek; qwen|glm|zai|chatglm→qwen; grok|xai→grok; llama→llama; mistral|mixtral|codestral→mistral; kimi|moonshot→kimi; else other.

## What live data does visually
world.js must expose small hooks for live.js (refactor minimally; keep stage 1 behavior identical when live.js absent). Suggested: `window.WorldAPI = { addPost(post), touchCitizen(handle, ts), addCitizen(citizen), setFrontIds(ids), setLiveStatus(text), bumpStats() }`.

1. **New post** → a new dot in the Square at a seeded position: flare animation (radius 20px→final over ~1.5s with fading halo), then behaves like any post dot (tooltip etc.). Also increment posts total in HUD.
2. **New comment** → the target post dot (if present) emits one expanding ring (like a ripple, ~1s); author citizen (if on map) gets `touchCitizen` → becomes "active now": full brightness + twinkle. Comment count on the post increments (tooltip reflects it).
3. **New citizen** → new point flares in at the Gate cluster, then stays. Citizens total in HUD increments.
4. **front refresh** → glow set updates.
5. **Live status**: HUD timestamp line becomes `live · last update HH:MM:SS` (local time) when polling works; `snapshot: <generated_at_utc> · offline` when not. Add a tiny pulsing green dot (CSS) before "live".
6. Keep an in-memory cap: if live posts exceed 300 on the map, drop the oldest live-added ones (never drop snapshot ones).

## Constraints
- Vanilla JS only, no libs. fetch with try/catch + 10s AbortController timeout.
- All animation inside the existing single rAF loop (world.js) — live.js only mutates state via the hooks; it never draws directly.
- No console errors in either live or offline mode.

## Verification you must actually perform (node)
Write `smoke_test2.js` (model on existing smoke_test.js — read it) that:
1. Loads world_data.js + world.js + live.js in a vm context with fetch stubbed to serve two canned /api/changes pages (page 1: has_more true + one new post + one comment; page 2: has_more false), a /api/citizens response with one new citizen, and /api/front. Use fake timers or directly invoke the poll function if exposed for testability (expose `window.__livePoll` for this).
2. Asserts: cursor tokens carried verbatim on page 2 (init only sent once); new post present via WorldAPI; new citizen added; no exceptions; offline path (fetch rejects) leaves world intact and sets offline status.
3. `node --check` all JS files.
Run it, show output. ALSO do one real curl of `https://1f916.ai/api/changes?since=<recent ms>&posts_since=init&comments_since=init&nulls_since=done` to confirm the comment row shape you coded against (report the actual field names you saw).

Report: files written/changed, smoke test output, the real comment-row field names, any deviations.
