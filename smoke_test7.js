// Stage 9 smoke test: Three.js city3d structural wiring + graceful degrade.
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
      toggle: (name, force) => {
        if (force === undefined ? !classes.has(name) : !!force) classes.add(name);
        else classes.delete(name);
        return classes.has(name);
      },
      contains: (name) => classes.has(name),
    };
    Object.defineProperty(this, 'className', {
      get: () => Array.from(classes).join(' '),
      set: (v) => { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((n) => classes.add(n)); },
    });
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); child.parentNode = null; return child; }
  insertBefore(child, ref) {
    child.parentNode = this;
    const idx = this.children.indexOf(ref);
    if (idx < 0) this.children.push(child); else this.children.splice(idx, 0, child);
    return child;
  }
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
      row.querySelectorAll = (selector) => selector === '.legend-count' ? [new TestElement('span', this.ownerDocument)] : [];
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
  return el.tagName.toLowerCase() === selector.toLowerCase();
}
function queryAll(root, selector) {
  const out = [];
  const walk = (node) => {
    (node.children || []).forEach((child) => {
      if (matches(child, selector)) out.push(child);
      walk(child);
    });
  };
  walk(root);
  return out;
}

function makeDom() {
  const elems = {};
  const document = {
    hidden: false,
    body: null,
    createElement(tag) { return new TestElement(tag, document); },
    addEventListener() {},
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

function makeThree({ rendererThrows = false, calls }) {
  function record(name, payload) { calls.push(Object.assign({ name }, payload || {})); }
  class Color {
    constructor(v) { this.value = v || '#000000'; this.r = 1; this.g = 1; this.b = 1; }
    set(v) { this.value = v; return this; }
    multiplyScalar(s) { this.scalar = (this.scalar || 1) * s; return this; }
    lerp(_c, a) { this.lerpAlpha = a; return this; }
    clone() { const c = new Color(this.value); c.scalar = this.scalar; return c; }
  }
  class Object3D {
    constructor() { this.children = []; this.position = { set() {}, x: 0, y: 0, z: 0 }; this.rotation = { x: 0, y: 0, z: 0 }; this.scale = { set() {} }; }
    add(...kids) { this.children.push(...kids); }
    lookAt() {}
  }
  class Scene extends Object3D { constructor() { super(); record('Scene'); } }
  class Group extends Object3D { constructor() { super(); record('Group'); } }
  class Mesh extends Object3D { constructor(geo, mat) { super(); this.geometry = geo; this.material = mat; record('Mesh'); } }
  class Sprite extends Object3D { constructor(mat) { super(); this.material = mat; record('Sprite'); } }
  class PerspectiveCamera extends Object3D { constructor() { super(); this.aspect = 1; record('PerspectiveCamera'); } updateProjectionMatrix() { record('updateProjectionMatrix'); } }
  class WebGLRenderer {
    constructor(opts) { record('WebGLRenderer', { opts }); if (rendererThrows) throw new Error('no-webgl'); this.domElement = new TestElement('canvas', null); this.domElement.style = {}; }
    setPixelRatio(v) { record('setPixelRatio', { v }); }
    setSize(w, h) { record('setSize', { w, h }); }
    render(scene, camera) { record('render', { scene: !!scene, camera: !!camera }); }
    dispose() { record('dispose'); }
  }
  class InstancedMesh extends Object3D {
    constructor(geo, mat, count) { super(); this.geometry = geo; this.material = mat; this.count = count; this.instanceMatrix = {}; this.instanceColor = {}; record('InstancedMesh', { count }); }
    setMatrixAt(i, m) { record('setMatrixAt', { i, m: !!m }); }
    setColorAt(i, c) { record('setColorAt', { i, c: c && c.value }); }
  }
  class Matrix4 { makeTranslation() { return this; } compose() { return this; } }
  class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
  class Quaternion { setFromEuler() { return this; } }
  class Euler { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
  class Box3 { setFromObject() { return this; } getCenter(v) { v.set(0, 0, 0); return v; } getSize(v) { v.set(280, 120, 260); return v; } }
  class OrbitControls { constructor(camera, domElement) { this.camera = camera; this.domElement = domElement; this.target = new Vector3(); record('OrbitControls'); } update() { record('controlsUpdate'); } addEventListener() {} }
  function geom(name) { return class { constructor(...args) { this.args = args; record(name, { args }); } rotateX() { return this; } translate() { return this; } }; }
  function mat(name) { return class { constructor(opts) { this.opts = opts || {}; this.emissiveIntensity = opts && opts.emissiveIntensity || 0; record(name, { opts }); } }; }
  return {
    Color, Object3D, Scene, Group, Mesh, Sprite, PerspectiveCamera, WebGLRenderer, InstancedMesh, Matrix4, Vector3, Quaternion, Euler, Box3, OrbitControls,
    BoxGeometry: geom('BoxGeometry'), PlaneGeometry: geom('PlaneGeometry'), RingGeometry: geom('RingGeometry'), GridHelper: geom('GridHelper'),
    MeshBasicMaterial: mat('MeshBasicMaterial'), MeshPhongMaterial: mat('MeshPhongMaterial'), SpriteMaterial: mat('SpriteMaterial'), CanvasTexture: mat('CanvasTexture'),
    AmbientLight: class extends Object3D { constructor() { super(); record('AmbientLight'); } },
    FogExp2: class { constructor(color, density) { this.color = color; this.density = density; record('FogExp2', { color, density }); } },
    DoubleSide: 2,
    sRGBEncoding: 3001,
    MathUtils: { clamp: (x, a, b) => Math.max(a, Math.min(b, x)) },
  };
}

function makeContext({ city = true, rendererThrows = false, storedView = null } = {}) {
  const { elems, document } = makeDom();
  const calls = [];
  const warnings = [];
  const localStore = new Map();
  if (storedView) localStore.set('view', storedView);
  const win = { innerWidth: 1600, innerHeight: 900, addEventListener() {}, document, localStorage: { getItem(k) { return localStore.has(k) ? localStore.get(k) : null; }, setItem(k, v) { localStore.set(k, String(v)); } } };
  win.window = win;
  const ctxObj = {
    window: win,
    document,
    console: Object.assign({}, console, { warn: (...args) => warnings.push(args.join(' ')) }),
    performance: { now: () => 8000 },
    requestAnimationFrame(fn) { calls.push({ name: 'requestAnimationFrame' }); return calls.length; },
    cancelAnimationFrame(id) { calls.push({ name: 'cancelAnimationFrame', id }); },
    Path2D: TestPath2D,
    THREE: makeThree({ rendererThrows, calls }),
    devicePixelRatio: 2,
  };
  win.THREE = ctxObj.THREE;
  win.performance = ctxObj.performance;
  const ctx = vm.createContext(ctxObj);
  vm.runInContext(fs.readFileSync(path.join(dir, 'world_data.js'), 'utf8'), ctx, { filename: 'world_data.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'smoke_convo_fixture.js'), 'utf8'), ctx, { filename: 'smoke_convo_fixture.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'world.js'), 'utf8'), ctx, { filename: 'world.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'tower.js'), 'utf8'), ctx, { filename: 'tower.js' });
  if (city) vm.runInContext(fs.readFileSync(path.join(dir, 'city3d.js'), 'utf8'), ctx, { filename: 'city3d.js' });
  return { ctx, elems, calls, warnings };
}

function runCityPath() {
  const { ctx, elems, calls } = makeContext({ city: true });
  assert(ctx.window.WorldViews.views.city3d, 'city3d view registered');
  assert.strictEqual(ctx.window.WorldViews.active(), 'map', 'starts on map');
  assert.strictEqual(elems['view-toggle'].textContent, '[enter the tower \u2191]', 'map toggle label');
  assert.strictEqual(ctx.window.WorldViews.toggle(), 'tower', 'map toggles to tower');
  assert.strictEqual(elems['view-toggle'].textContent, '[fly through \u2197]', 'tower toggle label');
  assert.strictEqual(ctx.window.WorldViews.toggle(), 'city3d', 'tower toggles to city3d');
  assert.strictEqual(elems['view-toggle'].textContent, '[back to the map \u2193]', 'city toggle label');
  assert.strictEqual(elems['streets-toggle'].style.display, 'none', 'streets toggle hidden in city3d');
  const city = ctx.window.WorldViews.views.city3d;
  assert.strictEqual(city.__debug.rendererCreated, 1, 'renderer created once on first activation');
  city.draw(absorb(), 9000);
  city.layout(1200, 800);
  assert.strictEqual(city.__debug.rendererCreated, 1, 'renderer not recreated by draw/layout');
  assert.strictEqual(city.__debug.citizenCount, 2113, 'citizen instanced mesh has 2113 instances');
  assert.strictEqual(city.__debug.postTowerCount, 200, 'city has 200 post towers');
  assert(calls.some((c) => c.name === 'InstancedMesh' && c.count === 2113), 'recorded citizen InstancedMesh count');
  assert(calls.some((c) => c.name === 'FogExp2' && c.density === 0.0035), 'FogExp2 configured');
  assert(calls.some((c) => c.name === 'OrbitControls'), 'OrbitControls constructed');
  const beforeColors = calls.filter((c) => c.name === 'setColorAt').length;
  const firstRow = elems.legend.querySelectorAll('.legend-row')[0];
  firstRow.dispatch('mouseenter');
  city.draw(absorb(), 9100);
  assert(calls.filter((c) => c.name === 'setColorAt').length > beforeColors, 'legend hover refreshes instance colors');
  assert.strictEqual(ctx.window.WorldViews.toggle(), 'map', 'city toggles back to map');
  assert.strictEqual(city.__debug.canvasDisplay, 'none', 'deactivation hides 3D canvas');
  return { views: Object.keys(ctx.window.WorldViews.views).sort(), citizens: city.__debug.citizenCount, posts: city.__debug.postTowerCount, rendererCreated: city.__debug.rendererCreated };
}

function runGracefulDegrade() {
  const { ctx, warnings } = makeContext({ city: true, rendererThrows: true, storedView: 'city3d' });
  assert(ctx.window.WorldViews.views.map, 'map survives failed WebGL');
  assert(ctx.window.WorldViews.views.tower, 'tower survives failed WebGL');
  assert(!ctx.window.WorldViews.views.city3d, 'city3d unregisters after WebGL failure');
  assert.strictEqual(ctx.window.WorldViews.active(), 'map', 'active falls back to map after failed city');
  assert.strictEqual(ctx.window.WorldViews.toggle(), 'tower', 'two-view toggle still reaches tower');
  assert.strictEqual(ctx.window.WorldViews.toggle(), 'map', 'two-view toggle returns to map');
  assert(warnings.some((w) => w.includes('city3d disabled')), 'warned once about disabled city3d');
  return { active: ctx.window.WorldViews.active(), views: Object.keys(ctx.window.WorldViews.views).sort(), warnings: warnings.length };
}

function syntaxCheck() {
  const files = ['world_data.js', 'convo_graph.js', 'tower_data.js', 'world.js', 'tower.js', 'city3d.js', 'offices.js', 'reader.js', 'live.js', 'smoke_test.js', 'smoke_test2.js', 'smoke_test3.js', 'smoke_test4.js', 'smoke_test5.js', 'smoke_test6.js', 'smoke_test7.js', 'smoke_convo_fixture.js'];
  for (const file of files) execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'pipe' });
  return files;
}

try {
  const city = runCityPath();
  const degrade = runGracefulDegrade();
  const checked = syntaxCheck();
  console.log('stage9 city3d OK');
  console.log('registered views:', JSON.stringify(city.views));
  console.log('city3d counts:', JSON.stringify({ citizens: city.citizens, postTowers: city.posts }));
  console.log('renderer creations:', city.rendererCreated);
  console.log('WebGL degrade:', JSON.stringify(degrade));
  console.log('node --check OK:', checked.join(', '));
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
