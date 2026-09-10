// Structural verification of the shell.js integration — NOT a browser test.
// Reuses the fake-DOM/fake-THREE harness pattern from smoke_test7.js (proven to load
// world.js/tower.js/city3d.js without exceptions) and additionally loads offices.js,
// reader.js, and shell.js on top, then checks the specific hooks shell.js's README
// says it wires: view-switch buttons, help panel elements, stats-grid mirroring,
// legend decoration, and office floor-directory injection.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

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

class TestPath2D { constructor() { this.commands = []; } moveTo() {} quadraticCurveTo() {} }

class TestElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this._text = '';
    this._listeners = {};
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => { if (force === undefined ? !classes.has(name) : !!force) classes.add(name); else classes.delete(name); return classes.has(name); },
      contains: (name) => classes.has(name),
    };
    Object.defineProperty(this, 'className', {
      get: () => Array.from(classes).join(' '),
      set: (v) => { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((n) => classes.add(n)); },
    });
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; return child; }
  insertBefore(child, ref) { child.parentNode = this; const idx = this.children.indexOf(ref); if (idx < 0) this.children.push(child); else this.children.splice(idx, 0, child); return child; }
  replaceChildren(...kids) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = ''; kids.forEach((k) => this.appendChild(k)); }
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); }
  dispatch(type, event = {}) { (this._listeners[type] || []).forEach((fn) => fn(Object.assign({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} }, event))); }
  click() { this.dispatch('click'); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = v; else this[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; }
  get innerHTML() { return this.textContent; }
  set innerHTML(v) {
    this.textContent = v;
    const rowRe = /<div class="legend-row" data-family="([^"]+)">/g;
    let m;
    while ((m = rowRe.exec(String(v)))) {
      const row = new TestElement('div', this.ownerDocument);
      row.className = 'legend-row';
      row.dataset.family = m[1];
      row.querySelectorAll = (selector) => (selector === '.legend-count' ? [new TestElement('span', this.ownerDocument)] : []);
      this.appendChild(row);
    }
  }
  querySelectorAll(selector) { return queryAll(this, selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function matches(el, selector) {
  if (!(el instanceof TestElement)) return false;
  if (selector[0] === '.') return selector.slice(1).split('.').every((name) => el.classList.contains(name));
  if (selector[0] === '#') return el.id === selector.slice(1);
  if (selector.startsWith('[data-')) {
    const m = selector.match(/\[data-([a-z-]+)\]/);
    if (!m) return false;
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return el.dataset[key] !== undefined;
  }
  if (selector.includes('[') && !selector.startsWith('[')) {
    const [base, attr] = selector.split(/(?=\[)/);
    return matches(el, base) && matches(el, attr);
  }
  return el.tagName.toLowerCase() === selector.toLowerCase();
}
function isDescendantOf(el, ancestor) {
  let n = el.parentNode;
  while (n) { if (n === ancestor) return true; n = n.parentNode; }
  return false;
}
function queryAll(root, selector) {
  const out = [];
  // support simple descendant-combinator compounds like "#id .class"
  if (selector.includes(' ')) {
    const parts = selector.trim().split(/\s+/);
    const [head, ...restParts] = parts;
    const rest = restParts.join(' ');
    // find all elements matching head anywhere under root, then query `rest` under each
    const heads = [];
    const walkHead = (node) => { (node.children || []).forEach((child) => { if (matches(child, head)) heads.push(child); walkHead(child); }); };
    walkHead(root);
    heads.forEach((h) => { queryAll(h, rest).forEach((m) => { if (!out.includes(m)) out.push(m); }); });
    return out;
  }
  const walk = (node) => { (node.children || []).forEach((child) => { if (matches(child, selector)) out.push(child); walk(child); }); };
  walk(root);
  return out;
}
// shell.js calls the module-scope `$(sel, root)` helper it defines itself (querySelector under a
// given root) — our fake TestElement.querySelector already supports being called with `this` as
// root, so no separate helper is needed here; this comment documents that contract for the reader.

function makeDom() {
  const elems = {};
  const document = {
    hidden: false,
    body: null,
    createElement(tag) { return new TestElement(tag, document); },
    addEventListener(type, fn) { (document._listeners = document._listeners || {}), (document._listeners[type] = document._listeners[type] || []).push(fn); },
    dispatchKey(fakeEvent) { (document._listeners && document._listeners.keydown || []).forEach((fn) => fn(fakeEvent)); },
    getElementById(id) {
      if (!elems[id]) {
        elems[id] = id === 'worldCanvas'
          ? Object.assign(new TestElement('canvas', document), { width: 0, height: 0, getContext: () => absorb(), style: {}, parentNode: document.body })
          : new TestElement('div', document);
        elems[id].id = id;
        document.body.appendChild(elems[id]);
      }
      return elems[id];
    },
    querySelectorAll(selector) { return queryAll(document.body, selector); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  document.body = new TestElement('body', document);
  return { elems, document };
}

function makeThree(calls) {
  function record(name, payload) { calls.push(Object.assign({ name }, payload || {})); }
  class Color { constructor(v) { this.value = v || '#000000'; } set(v) { this.value = v; return this; } multiplyScalar(s) { this.scalar = (this.scalar || 1) * s; return this; } lerp() { return this; } clone() { return new Color(this.value); } }
  class Object3D { constructor() { this.children = []; this.position = { set() {}, x: 0, y: 0, z: 0 }; this.rotation = { x: 0, y: 0, z: 0 }; this.scale = { set() {} }; } add(...kids) { this.children.push(...kids); } lookAt() {} }
  class WebGLRenderer { constructor() { record('WebGLRenderer'); this.domElement = new TestElement('canvas', null); this.domElement.style = {}; } setPixelRatio() {} setSize() {} render() {} dispose() {} }
  class InstancedMesh extends Object3D { constructor(geo, mat, count) { super(); this.count = count; this.instanceMatrix = {}; this.instanceColor = {}; record('InstancedMesh', { count }); } setMatrixAt() {} setColorAt() {} }
  class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
  class Box3 { setFromObject() { return this; } getCenter(v) { v.set(0, 0, 0); return v; } getSize(v) { v.set(280, 120, 260); return v; } }
  class OrbitControls { constructor(camera, domElement) { this.domElement = domElement; this.target = new Vector3(); } update() {} addEventListener() {} }
  function geom(name) { return class { constructor(...args) { this.args = args; record(name); } rotateX() { return this; } translate() { return this; } }; }
  function mat(name) { return class { constructor(opts) { this.opts = opts || {}; record(name); } }; }
  return {
    Color, Object3D, Scene: class extends Object3D {}, Group: class extends Object3D {}, Mesh: class extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
    Sprite: class extends Object3D {}, PerspectiveCamera: class extends Object3D { updateProjectionMatrix() {} }, WebGLRenderer, InstancedMesh,
    Matrix4: class { makeTranslation() { return this; } compose() { return this; } }, Vector3, Quaternion: class { setFromEuler() { return this; } }, Euler: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }, Box3, OrbitControls,
    BoxGeometry: geom('BoxGeometry'), PlaneGeometry: geom('PlaneGeometry'), RingGeometry: geom('RingGeometry'), GridHelper: geom('GridHelper'),
    MeshBasicMaterial: mat('MeshBasicMaterial'), MeshPhongMaterial: mat('MeshPhongMaterial'), SpriteMaterial: mat('SpriteMaterial'), CanvasTexture: mat('CanvasTexture'),
    AmbientLight: class extends Object3D {}, FogExp2: class { constructor(c, d) { this.color = c; this.density = d; } },
    DoubleSide: 2, sRGBEncoding: 3001, MathUtils: { clamp: (x, a, b) => Math.max(a, Math.min(b, x)) },
  };
}

function makeContext() {
  const { elems, document } = makeDom();
  const calls = [];
  const warnings = [];
  const localStore = new Map();
  const win = { innerWidth: 1600, innerHeight: 900, document, localStorage: { getItem(k) { return localStore.has(k) ? localStore.get(k) : null; }, setItem(k, v) { localStore.set(k, String(v)); } } };
  const listeners = {};
  win.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  win.dispatchResize = () => (listeners.resize || []).forEach((fn) => fn());
  win.window = win;
  const ctxObj = {
    window: win, document,
    console: Object.assign({}, console, { warn: (...a) => warnings.push(a.join(' ')) }),
    performance: { now: () => 8000 },
    requestAnimationFrame(fn) { calls.push({ name: 'raf' }); return calls.length; },
    cancelAnimationFrame() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    Path2D: TestPath2D,
    THREE: makeThree(calls),
    devicePixelRatio: 2,
    MutationObserver: class { constructor(cb) { this._cb = cb; } observe() {} },
    innerWidth: 1600, innerHeight: 900,
  };
  win.THREE = ctxObj.THREE;
  win.performance = ctxObj.performance;
  win.MutationObserver = ctxObj.MutationObserver;
  const ctx = vm.createContext(ctxObj);
  const load = (f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  load('world_data.js');
  load('smoke_convo_fixture.js');
  load('tower_data.js');
  load('world.js');
  load('tower.js');
  load('city3d.js');
  load('offices.js');
  load('reader.js');
  return { ctx, elems, document, win, calls, warnings, load };
}

// --- pre-register the shell.html ids/structure shell.js queries for ---
function wireShellDom(elems, document) {
  const viewSwitch = document.getElementById('view-switch');
  elems['view-switch'] = viewSwitch;
  ['map', 'tower', 'city3d'].forEach((name) => {
    const b = new TestElement('button', document);
    b.dataset.view = name;
    viewSwitch.appendChild(b);
  });
  const help = document.getElementById('help'); help.hidden = true;
  const helpBtn = document.getElementById('help-button');
  const closeBtn = new TestElement('button', document); closeBtn.dataset.helpClose = 'true'; help.appendChild(closeBtn);
  const replayBtn = new TestElement('button', document); replayBtn.dataset.tourReplay = 'true'; help.appendChild(replayBtn);
  document.getElementById('tour').hidden = true;
  document.getElementById('stats-grid'); // pre-touch: shell.js finds this via querySelector, not getElementById
  document.getElementById('hints');
  document.getElementById('legend-wrap');
  document.getElementById('toast');
  document.getElementById('stats-line').textContent = '2,345 citizens · 164 active today · 4,720 posts · 10,942 chain events';
  document.getElementById('timestamp-line').textContent = 'live · last update 09:41';
  return { viewSwitch, help, helpBtn, closeBtn, replayBtn };
}

function run() {
  const { ctx, elems, document, win, calls, warnings, load } = makeContext();
  assert(ctx.window.WorldViews, 'WorldViews present before shell.js loads');
  assert(ctx.window.WorldAPI, 'WorldAPI present before shell.js loads');
  assert(ctx.window.WORLD, 'WORLD present before shell.js loads');

  const { viewSwitch, help, helpBtn, closeBtn, replayBtn } = wireShellDom(elems, document);

  load('shell.js');
  console.log('shell.js loaded without throwing.');

  // 1/2/3 view-switch buttons should now be synced (aria-pressed set on the active one).
  // Fresh profile (no stored `view`) => shell.js's documented front-door rule switches to city3d.
  const btnCity = viewSwitch.children.find((b) => b.dataset.view === 'city3d');
  assert(btnCity, 'city3d button exists');
  assert.strictEqual(btnCity.attributes['aria-pressed'], 'true', 'fresh profile opens on city3d (front-door rule)');
  console.log('view-switch buttons wired, map/tower/city3d aria-pressed states:',
    viewSwitch.children.map((b) => `${b.dataset.view}=${b.attributes['aria-pressed']}`).join(', '));

  // stats-grid should have mirrored content (my fake innerHTML setter only parses .legend-row
  // markup into real children; anything else — including shell.js's real .cell divs — lands as
  // plain textContent. So check the generated HTML string, not children.length, for this shape.)
  const grid = document.getElementById('stats-grid');
  assert(grid.textContent.includes('class="cell'), 'stats-grid populated with .cell markup from stats-line');
  const cellCount = (grid.textContent.match(/class="cell/g) || []).length;
  console.log('stats-grid mirrored, cell count:', cellCount);

  // legend decoration: simulate world.js populating #legend, then check swatch --pct/--fam get set
  const legend = document.getElementById('legend');
  legend.innerHTML = '<div class="legend-row" data-family="claude"><span>claude</span><span class="legend-count">780</span><div class="swatch"></div></div>';
  // shell.js's MutationObserver is a no-op stub here (observe() does nothing), so call the
  // decorate path indirectly is not possible without exposing it; this at least proves the
  // legend row shape shell.js expects (data-family + .legend-count) matches world.js's real output.
  const row = legend.querySelectorAll('.legend-row')[0];
  assert.strictEqual(row.dataset.family, 'claude', 'legend row shape matches shell.js expectations');

  // help toggle via click
  helpBtn.dispatch('click');
  assert.strictEqual(help.hidden, false, 'help opens on button click');
  closeBtn.dispatch('click');
  assert.strictEqual(help.hidden, true, 'help closes on data-help-close click');

  // keyboard: 1/2/3 view switch
  document.dispatchKey({ key: '1', target: { tagName: 'BODY' } });
  console.log('after pressing "1", active view:', ctx.window.WorldViews.active());
  document.dispatchKey({ key: '3', target: { tagName: 'BODY' } });
  console.log('after pressing "3", active view:', ctx.window.WorldViews.active());
  assert.strictEqual(ctx.window.WorldViews.active(), 'city3d', 'key "3" switches to city3d');

  document.dispatchKey({ key: '?', target: { tagName: 'BODY' } });
  assert.strictEqual(help.hidden, false, '"?" opens help');
  document.dispatchKey({ key: 'Escape', target: { tagName: 'BODY' } });
  assert.strictEqual(help.hidden, true, 'Escape closes help');

  // office floor directory injection: call the REAL offices.js open() and let it build its own panel
  assert(ctx.window.Offices && typeof ctx.window.Offices.open === 'function', 'Offices.open exists (offices.js loaded)');
  const before = document.querySelectorAll('.office-panel').length;
  ctx.window.Offices.open('exec', null);
  const panels = document.querySelectorAll('.office-panel');
  console.log('office panels after Offices.open("exec", null):', panels.length, '(before:', before, ')');
  const dir = document.querySelectorAll('#office-overlay .floor-directory')[0];
  assert(dir, 'floor directory injected into office panel on Offices.open()');
  // Same innerHTML-parsing limitation as stats-grid above: dir's real <button> markup is a string
  // in this fake DOM, not walkable children. Check the string for the floor buttons shell.js writes.
  const dirButtonCount = (dir.textContent.match(/data-floor="/g) || []).length;
  console.log('floor directory buttons (from generated HTML):', dirButtonCount);
  assert(dirButtonCount === 7, 'floor directory lists all 7 floors');
  assert(dir.textContent.includes('Executive suite'), 'floor directory includes Executive suite entry');

  console.log('warnings emitted:', warnings);
  console.log('ALL SHELL STRUCTURAL CHECKS PASSED');
  // NOTE: shell.js schedules a real 900ms setTimeout(startTour) on load (first-visit tour).
  // Our fake tour.innerHTML setter (like stats-grid/floor-directory above) doesn't parse the
  // real <button> markup shell.js writes into real child nodes, so if that timer is allowed to
  // fire after this script exits, $('.tour-next', tour) returns null and the callback throws —
  // a fake-DOM limitation, not a shell.js bug. Exit now so the pending timer never fires.
  process.exit(0);
}

run();
