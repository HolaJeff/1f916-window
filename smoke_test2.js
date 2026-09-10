// Stage 2 smoke test: live polling + WorldAPI hooks.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execFileSync } = require('child_process');

const dir = __dirname;

function absorb() {
  return new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === Symbol.toPrimitive) return () => 800;
      if (k === 'roundRect') return () => {};
      return absorb();
    },
    set: () => true,
    apply: () => absorb(),
  });
}

function makeDom() {
  const elems = {};
  const mkEl = () => ({
    style: {}, innerHTML: '', textContent: '', dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    querySelectorAll: () => [],
  });
  return {
    elems,
    document: {
      hidden: false,
      addEventListener() {},
      getElementById(id) {
        if (!elems[id]) elems[id] = id === 'worldCanvas'
          ? { getContext: () => absorb(), style: {} }
          : mkEl();
        return elems[id];
      },
      querySelectorAll: () => [],
    },
  };
}

function makeContext(fetchImpl) {
  const { elems, document } = makeDom();
  const win = { innerWidth: 1600, innerHeight: 900, addEventListener() {}, document };
  win.window = win;
  let frames = 0;
  const timers = [];
  const ctxObj = {
    window: win,
    document,
    console,
    URL,
    URLSearchParams,
    performance: { now: () => 1000 + frames * 16 },
    requestAnimationFrame(fn) { if (frames < 3) { frames++; fn(16 * frames); } return frames; },
    cancelAnimationFrame() {},
    setTimeout(fn, ms) { timers.push({ type: 'timeout', fn, ms }); return timers.length; },
    clearTimeout() {},
    setInterval(fn, ms) { timers.push({ type: 'interval', fn, ms }); return timers.length; },
    clearInterval() {},
    AbortController: class { constructor() { this.signal = {}; } abort() { this.aborted = true; } },
    fetch: fetchImpl,
  };
  win.fetch = fetchImpl;
  win.AbortController = ctxObj.AbortController;
  win.performance = ctxObj.performance;
  const ctx = vm.createContext(ctxObj);
  vm.runInContext(fs.readFileSync(path.join(dir, 'world_data.js'), 'utf8'), ctx, { filename: 'world_data.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'world.js'), 'utf8'), ctx, { filename: 'world.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'live.js'), 'utf8'), ctx, { filename: 'live.js' });
  return { ctx, elems, timers };
}

async function runLivePath() {
  const changesCalls = [];
  let changePage = 0;
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/changes') {
      changesCalls.push(Object.fromEntries(u.searchParams.entries()));
      changePage += 1;
      if (changePage === 1) {
        return { ok: true, status: 200, json: async () => ({
          now: 1788367443372,
          posts: [{ id: 'live-post-1', title: 'Live post appears', author: 'new-citizen', author_model: 'gpt-4o', votes: 9, comments: 0, created_at: 1788367440372, pinned: false }],
          comments: [{ id: 'comment-1', post_id: 'live-post-1', author: 'new-citizen', author_model: 'gpt-4o', created_at: 1788367441372 }],
          next_posts_since: 'id:3618',
          next_comments_since: 'snapi:comment:cursor',
          has_more: true,
        }) };
      }
      return { ok: true, status: 200, json: async () => ({
        now: 1788367444372,
        posts: [],
        comments: [{ id: 'comment-2', post_id: 'missing-post', author: 'missing-citizen', created_at: 1788367442372 }],
        next_posts_since: 'id:3618',
        next_comments_since: 'snapi:comment:cursor2',
        has_more: false,
      }) };
    }
    if (u.pathname === '/api/citizens') {
      return { ok: true, status: 200, json: async () => ({
        citizens: [{ citizen_id: 'new-citizen', handle: 'new-citizen', model: 'claude-3-5-sonnet', karma: 5, votes_cast: 2, created_at: 1788367442372 }],
        has_more: false,
        next_since: 1788367442372,
      }) };
    }
    if (u.pathname === '/api/front') {
      return { ok: true, status: 200, json: async () => ({ posts: [{ id: 'live-post-1' }, { id: 12345 }] }) };
    }
    throw new Error('unexpected URL ' + url);
  };

  const { ctx, elems } = makeContext(fetchImpl);
  assert(ctx.window.WorldAPI, 'WorldAPI exposed');
  assert(ctx.window.__livePoll, '__livePoll exposed');

  const beforePosts = ctx.window.WORLD.posts.length;
  await ctx.window.__livePoll.changes();
  await ctx.window.__livePoll.citizens();
  await ctx.window.__livePoll.front();

  assert.strictEqual(changesCalls.length, 2, 'has_more fetched a second changes page');
  assert.strictEqual(changesCalls[0].posts_since, 'init', 'first posts cursor is init');
  assert.strictEqual(changesCalls[0].comments_since, 'init', 'first comments cursor is init');
  assert.strictEqual(changesCalls[0].nulls_since, 'done', 'nulls stream disabled');
  assert.strictEqual(changesCalls[1].posts_since, 'id:3618', 'second posts cursor carried verbatim');
  assert.strictEqual(changesCalls[1].comments_since, 'snapi:comment:cursor', 'second comments cursor carried verbatim');
  assert.strictEqual(changesCalls[1].since, changesCalls[0].since, 'same original since carried across pages');
  assert(ctx.window.WORLD.posts.length === beforePosts + 1, 'new post appended');
  assert(ctx.window.WORLD.posts.some((p) => p.id === 'live-post-1' && p.c === 1), 'new post present and comment count incremented');
  assert(ctx.window.WORLD.citizens.some((c) => c.h === 'new-citizen'), 'new citizen added');
  assert(ctx.window.WorldAPI.__state().frontIdSet.has('live-post-1'), 'front ids refreshed');
  assert(/live/.test(elems['timestamp-line'].innerHTML || elems['timestamp-line'].textContent), 'live status shown');
  return { changesCalls, posts: ctx.window.WORLD.posts.length, citizens: ctx.window.WORLD.citizens.length };
}

async function runOfflinePath() {
  const { ctx, elems } = makeContext(async () => { throw new Error('offline'); });
  const before = { posts: ctx.window.WORLD.posts.length, citizens: ctx.window.WORLD.citizens.length };
  await ctx.window.__livePoll.changes();
  assert.strictEqual(ctx.window.WORLD.posts.length, before.posts, 'offline leaves posts intact');
  assert.strictEqual(ctx.window.WORLD.citizens.length, before.citizens, 'offline leaves citizens intact');
  const status = elems['timestamp-line'].textContent || elems['timestamp-line'].innerHTML;
  assert(/offline/.test(status), 'offline status shown');
  return status;
}

function syntaxCheck() {
  const files = ['world_data.js', 'world.js', 'live.js', 'smoke_test.js', 'smoke_test2.js'];
  for (const file of files) execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'pipe' });
  return files;
}

(async () => {
  const live = await runLivePath();
  const offline = await runOfflinePath();
  const checked = syntaxCheck();
  console.log('stage2 live path OK');
  console.log('changes cursors:', JSON.stringify(live.changesCalls));
  console.log('world sizes after live:', JSON.stringify({ posts: live.posts, citizens: live.citizens }));
  console.log('offline status:', offline);
  console.log('node --check OK:', checked.join(', '));
})().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
