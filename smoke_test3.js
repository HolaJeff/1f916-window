// Stage 3 smoke test: conversation streets + optional CONVO guards.
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
      if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
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
          ? { getContext: () => absorb(), style: {} }
          : mkEl();
        return elems[id];
      },
      querySelectorAll: () => [],
    },
  };
}

function makeContext(loadConvo) {
  const { elems, document } = makeDom();
  const localStore = new Map();
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
  return { ctx, elems, frames };
}

function runWithConvo() {
  const { ctx, elems, frames } = makeContext(true);
  assert(ctx.window.WorldAPI, 'WorldAPI exposed');
  const state = ctx.window.WorldAPI.__state();
  assert.strictEqual(frames, 3, 'first frames rendered');
  assert.strictEqual(state.convoArcs.length, 5, 'only pairs with both endpoints on map become arcs');
  assert(state.convoArcs.every((arc) => arc.path instanceof TestPath2D), 'arc Path2D objects precomputed');
  assert(!state.convoArcs.some((arc) => arc.a === 'missing-handle' || arc.b === 'missing-handle'), 'missing endpoint excluded from arcs');
  assert.strictEqual(state.convoArcsByHandle.get('Lumina').length, 3, 'Lumina has three drawable streets');
  const partners = state.convoAdjacency.get('Lumina').map((p) => `${p.h}:${p.replies}`);
  assert.strictEqual(JSON.stringify(partners), JSON.stringify(['silt:30', 'swarf:20', 'errata:10', 'missing-handle:2']), 'adjacency sorted by volume');
  assert.strictEqual(state.streetsOn, true, 'streets default on with CONVO');
  assert.strictEqual(elems['streets-toggle'].textContent, '[streets on]', 'toggle label starts on');
  assert(/68 replies/.test(elems['stats-line'].textContent), 'HUD stats include replies');
  const flipped = ctx.window.WorldAPI.toggleStreets();
  assert.strictEqual(flipped, false, 'toggle function flips off');
  assert.strictEqual(ctx.window.WorldAPI.__state().streetsOn, false, 'state reflects toggle off');
  assert.strictEqual(elems['streets-toggle'].textContent, '[streets off]', 'toggle label updates off');
  return {
    arcs: state.convoArcs.length,
    luminaPartners: partners,
    statsLine: elems['stats-line'].textContent,
    toggleAfter: elems['streets-toggle'].textContent,
  };
}

function runWithoutConvo() {
  const { ctx, elems } = makeContext(false);
  assert(ctx.window.WorldAPI, 'WorldAPI exposed without CONVO');
  const state = ctx.window.WorldAPI.__state();
  assert.strictEqual(state.convoArcs.length, 0, 'no arcs without CONVO');
  assert.strictEqual(state.streetsOn, false, 'streets off without CONVO');
  assert(!/replies/.test(elems['stats-line'].textContent), 'HUD replies omitted without CONVO');
  assert.strictEqual(elems['streets-toggle'].style.display, 'none', 'toggle hidden without CONVO');
  return elems['stats-line'].textContent;
}

function syntaxCheck() {
  const files = ['world_data.js', 'convo_graph.js', 'world.js', 'live.js', 'smoke_test.js', 'smoke_test2.js', 'smoke_test3.js', 'smoke_convo_fixture.js'];
  for (const file of files) execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'pipe' });
  return files;
}

try {
  const withConvo = runWithConvo();
  const withoutConvo = runWithoutConvo();
  const checked = syntaxCheck();
  console.log('stage3 conversation streets OK');
  console.log('precomputed arcs:', withConvo.arcs);
  console.log('Lumina partners:', JSON.stringify(withConvo.luminaPartners));
  console.log('stats line:', withConvo.statsLine);
  console.log('toggle after flip:', withConvo.toggleAfter);
  console.log('without CONVO stats line:', withoutConvo);
  console.log('node --check OK:', checked.join(', '));
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
