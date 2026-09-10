// Stage 4 smoke test: map/tower view registry + tower layout/live hooks.
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
      if (k === 'ellipse') return () => {};
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return absorb();
    },
    set: () => true,
    apply: () => absorb(),
  });
}

class TestPath2D {
  constructor() { this.commands = []; }
  moveTo(x, y) { this.commands.push(['M', x, y]); }
  quadraticCurveTo(cx, cy, x, y) { this.commands.push(['Q', cx, cy, x, y]); }
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
          ? { width: 0, height: 0, getContext: () => absorb(), style: {} }
          : mkEl();
        return elems[id];
      },
      querySelectorAll: () => [],
    },
  };
}

function makeContext({ loadConvo = true, loadTower = true, storedView = null } = {}) {
  const { elems, document } = makeDom();
  const localStore = new Map();
  if (storedView) localStore.set('view', storedView);
  const win = {
    innerWidth: 1600,
    innerHeight: 900,
    addEventListener() {},
    document,
    localStorage: {
      getItem(k) { return localStore.has(k) ? localStore.get(k) : null; },
      setItem(k, v) { localStore.set(k, String(v)); },
    },
  };
  win.window = win;
  let frames = 0;
  const ctxObj = {
    window: win,
    document,
    console,
    performance: { now: () => 1000 + frames * 16 },
    requestAnimationFrame(fn) { if (frames < 3) { frames++; fn(16 * frames); } return frames; },
    cancelAnimationFrame() {},
    Path2D: TestPath2D,
  };
  win.performance = ctxObj.performance;
  const ctx = vm.createContext(ctxObj);
  vm.runInContext(fs.readFileSync(path.join(dir, 'world_data.js'), 'utf8'), ctx, { filename: 'world_data.js' });
  if (loadConvo) vm.runInContext(fs.readFileSync(path.join(dir, 'smoke_convo_fixture.js'), 'utf8'), ctx, { filename: 'smoke_convo_fixture.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'world.js'), 'utf8'), ctx, { filename: 'world.js' });
  if (loadTower) vm.runInContext(fs.readFileSync(path.join(dir, 'tower.js'), 'utf8'), ctx, { filename: 'tower.js' });
  return { ctx, elems, frames };
}

function runTowerPath() {
  const { ctx, elems } = makeContext({ loadConvo: true, loadTower: true });
  const W = ctx.window.WORLD;
  assert(ctx.window.WorldViews, 'WorldViews exposed');
  assert(ctx.window.WorldViews.views.map, 'map view registered');
  assert(ctx.window.WorldViews.views.tower, 'tower view registered');
  assert.strictEqual(ctx.window.WorldViews.set('tower'), 'tower', 'switches to tower');
  assert.strictEqual(elems['view-toggle'].textContent, '[back to the map \u2193]', 'view toggle updates to tower');
  const tower = ctx.window.WorldViews.views.tower;
  tower.layout(1600, 900);
  assert.strictEqual(tower.__layout.citizens.length, W.citizens.length, 'tower places every citizen');
  assert.strictEqual(tower.__layout.posts.length, W.posts.length, 'tower places every post');
  assert.strictEqual(W.posts.length, 200, 'snapshot has 200 posts');
  tower.draw(absorb(), 1200);

  const first = tower.__layout.citizens[0];
  const hit = tower.hitTest(first.x + first.w / 2, first.y + first.h / 2);
  assert(hit && hit.type === 'citizen' && hit.data === first.pt.c, 'hitTest finds known citizen window');

  const before = tower.__layout.citizens.length;
  ctx.window.WorldAPI.addCitizen({ handle: 'tower-new-citizen', model: 'gpt-4o', karma: 12, created_at: W.generated_at + 1000, last_active_at: W.generated_at + 1000 });
  assert.strictEqual(tower.__layout.citizens.length, before + 1, 'WorldAPI.addCitizen adds a tower window');
  assert.strictEqual(ctx.window.WorldViews.active(), 'tower', 'tower remains active after live hook');
  return {
    views: Object.keys(ctx.window.WorldViews.views).sort(),
    citizenWindows: tower.__layout.citizens.length,
    postWindows: tower.__layout.posts.length,
    hitHandle: hit.data.h,
    toggle: elems['view-toggle'].textContent,
  };
}

function runTowerWithoutConvo() {
  const { ctx } = makeContext({ loadConvo: false, loadTower: true });
  assert.strictEqual(ctx.window.WorldViews.set('tower'), 'tower', 'switches to tower without CONVO');
  const tower = ctx.window.WorldViews.views.tower;
  tower.layout(1600, 900);
  assert.strictEqual(tower.__layout.citizens.length, ctx.window.WORLD.citizens.length, 'tower places citizens without CONVO');
  assert.strictEqual(tower.__layout.posts.length, ctx.window.WORLD.posts.length, 'tower places posts without CONVO');
  tower.draw(absorb(), 1400);
  return { citizens: tower.__layout.citizens.length, posts: tower.__layout.posts.length };
}

function runWithoutTower() {
  const { ctx, elems, frames } = makeContext({ loadConvo: false, loadTower: false, storedView: 'tower' });
  assert(ctx.window.WorldViews.views.map, 'map view registered without tower.js');
  assert(!ctx.window.WorldViews.views.tower, 'tower view absent when tower.js not loaded');
  assert.strictEqual(ctx.window.WorldViews.active(), 'map', 'active view falls back to map');
  assert.strictEqual(elems['view-toggle'].style.display, 'none', 'view toggle hidden without tower.js');
  assert(ctx.window.WorldAPI, 'WorldAPI still exposed without tower.js');
  assert(frames >= 3, 'map frames render without tower.js');
  return { active: ctx.window.WorldViews.active(), toggleDisplay: elems['view-toggle'].style.display, frames };
}

function syntaxCheck() {
  const files = ['world_data.js', 'convo_graph.js', 'world.js', 'tower.js', 'live.js', 'smoke_test.js', 'smoke_test2.js', 'smoke_test3.js', 'smoke_test4.js', 'smoke_convo_fixture.js'];
  for (const file of files) execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'pipe' });
  return files;
}

try {
  const tower = runTowerPath();
  const towerNoConvo = runTowerWithoutConvo();
  const noTower = runWithoutTower();
  const checked = syntaxCheck();
  console.log('stage4 tower view OK');
  console.log('registered views:', JSON.stringify(tower.views));
  console.log('tower windows after live citizen:', JSON.stringify({ citizens: tower.citizenWindows, posts: tower.postWindows }));
  console.log('tower without CONVO:', JSON.stringify(towerNoConvo));
  console.log('hitTest citizen:', tower.hitHandle);
  console.log('toggle label:', tower.toggle);
  console.log('without tower:', JSON.stringify(noTower));
  console.log('node --check OK:', checked.join(', '));
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
