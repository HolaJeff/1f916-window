// Stage 10 smoke test: city3d streets, raycast interactions, souls, hooks.
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
      if (k === 'roundRect' || k === 'ellipse') return () => {};
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
    this.width = 0;
    this.height = 0;
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
  insertBefore(child, ref) { child.parentNode = this; const idx = this.children.indexOf(ref); if (idx < 0) this.children.push(child); else this.children.splice(idx, 0, child); return child; }
  replaceChildren(...kids) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = ''; kids.forEach((k) => this.appendChild(k)); }
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); }
  dispatch(type, event = {}) { (this._listeners[type] || []).forEach((fn) => fn(Object.assign({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} }, event))); }
  click() { this.dispatch('click'); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = v; else this[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width || 1600, height: this.height || 900 }; }
  getContext() { return absorb(); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; }
  get innerHTML() { return this._text; }
  set innerHTML(v) {
    this._text = String(v == null ? '' : v);
    this.children = [];
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
  const walk = (node) => (node.children || []).forEach((child) => { if (matches(child, selector)) out.push(child); walk(child); });
  walk(root);
  return out;
}

function makeDom() {
  const elems = {};
  const document = {
    hidden: false,
    body: null,
    activeElement: null,
    createElement(tag) { return new TestElement(tag, document); },
    addEventListener() {},
    getElementById(id) {
      if (!elems[id]) {
        elems[id] = new TestElement(id === 'worldCanvas' ? 'canvas' : 'div', document);
        elems[id].id = id;
        if (id === 'worldCanvas') Object.assign(elems[id], { width: 1600, height: 900, style: {}, parentNode: document.body });
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

function makeThree(env) {
  function record(name, payload) { env.calls.push(Object.assign({ name }, payload || {})); }
  class Color {
    constructor(v) { this.value = v || '#000000'; this.r = 1; this.g = 1; this.b = 1; }
    set(v) { this.value = v; return this; }
    multiplyScalar(s) { this.scalar = (this.scalar || 1) * s; this.r *= s; this.g *= s; this.b *= s; return this; }
    lerp(_c, a) { this.lerpAlpha = a; return this; }
    clone() { const c = new Color(this.value); c.r = this.r; c.g = this.g; c.b = this.b; c.scalar = this.scalar; return c; }
  }
  class Object3D {
    constructor() { this.children = []; this.position = { set(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }, x: 0, y: 0, z: 0 }; this.rotation = { x: 0, y: 0, z: 0 }; this.scale = { set() {} }; this.visible = true; this.userData = {}; }
    add(...kids) { this.children.push(...kids); }
    lookAt() {}
  }
  class Scene extends Object3D { constructor() { super(); record('Scene'); } }
  class Group extends Object3D { constructor() { super(); record('Group'); } }
  class Mesh extends Object3D { constructor(geo, mat) { super(); this.geometry = geo; this.material = mat; record('Mesh'); } }
  class Sprite extends Object3D { constructor(mat) { super(); this.material = mat; record('Sprite'); } }
  class PerspectiveCamera extends Object3D { constructor() { super(); this.aspect = 1; record('PerspectiveCamera'); } updateProjectionMatrix() { record('updateProjectionMatrix'); } }
  class WebGLRenderer {
    constructor(opts) { record('WebGLRenderer', { opts }); this.domElement = new TestElement('canvas', null); this.domElement.style = {}; this.domElement.width = 1600; this.domElement.height = 900; env.renderer = this; }
    setPixelRatio(v) { record('setPixelRatio', { v }); }
    setSize(w, h) { this.domElement.width = w; this.domElement.height = h; record('setSize', { w, h }); }
    render(scene, camera) { record('render', { scene: !!scene, camera: !!camera }); }
  }
  class InstancedMesh extends Object3D {
    constructor(geo, mat, count) { super(); this.geometry = geo; this.material = mat; this.count = count; this.instanceMatrix = {}; this.instanceColor = {}; record('InstancedMesh', { count }); }
    setMatrixAt(i, m) { record('setMatrixAt', { i, m: !!m }); }
    setColorAt(i, c) { record('setColorAt', { i, c: c && c.value, scalar: c && c.scalar }); }
  }
  class BufferGeometry { constructor() { this.attributes = {}; this.userData = {}; record('BufferGeometry'); } setAttribute(k, v) { this.attributes[k] = v; return this; } computeBoundingSphere() {} }
  class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.needsUpdate = false; } }
  class LineSegments extends Object3D { constructor(geo, mat) { super(); this.geometry = geo; this.material = mat; record('LineSegments', { vertices: geo.attributes.position.array.length / 3, streetCount: geo.userData && geo.userData.streetCount }); } }
  class Points extends Object3D { constructor(geo, mat) { super(); this.geometry = geo; this.material = mat; record('Points', { points: geo.attributes.position.array.length / 3 }); } }
  class Raycaster {
    setFromCamera(v) { env.lastRay = { x: v.x, y: v.y }; }
    intersectObject(obj) {
      if (env.rayMode === 'tower' && obj.count === env.win.WORLD.posts.length) return [{ instanceId: env.towerHitIndex || 0, distance: 1 }];
      if (env.rayMode === 'citizen' && obj.count === env.win.WORLD.citizens.length) return [{ instanceId: env.citizenHitIndex || 0, distance: 1 }];
      return [];
    }
  }
  class Matrix4 { compose() { return this; } }
  class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } }
  class Vector3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
  class Quaternion { setFromEuler() { return this; } }
  class Euler { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } }
  class Box3 { setFromObject() { return this; } getCenter(v) { v.set(0, 0, 0); return v; } getSize(v) { v.set(280, 120, 260); return v; } }
  class OrbitControls { constructor(camera, domElement) { this.camera = camera; this.domElement = domElement; this.target = new Vector3(); record('OrbitControls'); } update() { record('controlsUpdate'); } addEventListener() {} }
  function geom(name) { return class { constructor(...args) { this.args = args; record(name, { args }); } rotateX() { return this; } translate() { return this; } }; }
  function mat(name) { return class { constructor(opts) { this.opts = opts || {}; this.opacity = opts && opts.opacity; this.emissiveIntensity = opts && opts.emissiveIntensity || 0; record(name, { opts }); } }; }
  return {
    Color, Object3D, Scene, Group, Mesh, Sprite, PerspectiveCamera, WebGLRenderer, InstancedMesh, BufferGeometry, BufferAttribute, Float32BufferAttribute: BufferAttribute, LineSegments, Points, Raycaster, Matrix4, Vector2, Vector3, Quaternion, Euler, Box3, OrbitControls,
    BoxGeometry: geom('BoxGeometry'), PlaneGeometry: geom('PlaneGeometry'), GridHelper: geom('GridHelper'),
    MeshBasicMaterial: mat('MeshBasicMaterial'), MeshPhongMaterial: mat('MeshPhongMaterial'), SpriteMaterial: mat('SpriteMaterial'), CanvasTexture: mat('CanvasTexture'), LineBasicMaterial: mat('LineBasicMaterial'), PointsMaterial: mat('PointsMaterial'),
    AmbientLight: class extends Object3D { constructor() { super(); record('AmbientLight'); } },
    FogExp2: class { constructor(color, density) { this.color = color; this.density = density; record('FogExp2', { color, density }); } },
    DoubleSide: 2,
    AdditiveBlending: 2,
    sRGBEncoding: 3001,
  };
}

function makeContext() {
  const { elems, document } = makeDom();
  const calls = [];
  const localStore = new Map([['view', 'map']]);
  const win = { innerWidth: 1600, innerHeight: 900, addEventListener() {}, document, localStorage: { getItem(k) { return localStore.has(k) ? localStore.get(k) : null; }, setItem(k, v) { localStore.set(k, String(v)); } } };
  win.window = win;
  const env = { calls, win, rayMode: null, towerHitIndex: 0, citizenHitIndex: 0, renderer: null };
  const ctxObj = {
    window: win,
    document,
    console,
    performance: { now: () => 8000 },
    requestAnimationFrame(fn) { calls.push({ name: 'requestAnimationFrame' }); env.lastFrame = fn; return calls.length; },
    cancelAnimationFrame(id) { calls.push({ name: 'cancelAnimationFrame', id }); },
    Path2D: TestPath2D,
    devicePixelRatio: 2,
  };
  ctxObj.THREE = makeThree(env);
  win.THREE = ctxObj.THREE;
  win.performance = ctxObj.performance;
  win.Reader = { calls: [], open(id, localData) { this.calls.push({ id, localData }); } };
  const ctx = vm.createContext(ctxObj);
  vm.runInContext(fs.readFileSync(path.join(dir, 'world_data.js'), 'utf8'), ctx, { filename: 'world_data.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'smoke_convo_fixture.js'), 'utf8'), ctx, { filename: 'smoke_convo_fixture.js' });
  env.win = ctx.window;
  vm.runInContext(fs.readFileSync(path.join(dir, 'world.js'), 'utf8'), ctx, { filename: 'world.js' });
  const original = ctx.window.WorldAPI.addComment;
  ctx.window.__callThrough = 0;
  ctx.window.WorldAPI.addComment = function countedAddComment(row) { ctx.window.__callThrough += 1; return original.apply(this, arguments); };
  vm.runInContext(fs.readFileSync(path.join(dir, 'city3d.js'), 'utf8'), ctx, { filename: 'city3d.js' });
  return { ctx, elems, calls, env };
}

function runStage10() {
  const { ctx, elems, calls, env } = makeContext();
  const view = ctx.window.WorldViews.views.city3d;
  assert(view, 'city3d registered');
  ctx.window.WorldViews.set('city3d');
  const city = view.__debug.city;
  assert(city.staticStreets, 'static merged streets object built');
  assert(city.recentStreets, 'recent merged streets object built');
  assert(city.highlightStreets, 'highlight merged streets object built');
  assert(city.streets.length > 0 && city.streets.length <= 250, 'street cap respected');
  assert(city.streets.every((s) => s.ma && s.mb && s.points && s.points.length === 72), 'street endpoints resolved and sampled');
  assert(city.recentStreetList.length > 0, 'recent streets separated');

  ctx.window.WorldAPI.setStreetsOn(false);
  view.draw(absorb(), 9000);
  assert.strictEqual(city.staticStreets.visible, false, 'static streets hidden by toggle');
  assert.strictEqual(city.recentStreets.visible, false, 'recent streets hidden by toggle');
  assert.strictEqual(city.souls.visible, false, 'souls hidden by toggle');
  ctx.window.WorldAPI.setStreetsOn(true);
  view.draw(absorb(), 9100);
  assert.strictEqual(city.staticStreets.visible, true, 'static streets shown by toggle');
  assert.strictEqual(city.recentStreets.visible, true, 'recent streets shown by toggle');
  assert.strictEqual(city.souls.visible, true, 'souls shown by toggle');
  assert(elems['streets-toggle'].textContent.includes('[streets on]'), 'city3d keeps streets toggle visible/wired during draw');

  env.rayMode = 'tower';
  env.towerHitIndex = 3;
  const canvas = env.renderer.domElement;
  canvas.dispatch('pointerdown', { clientX: 400, clientY: 300 });
  canvas.dispatch('pointerup', { clientX: 402, clientY: 301 });
  assert.strictEqual(ctx.window.Reader.calls.length, 1, 'tower click calls Reader.open');
  assert.strictEqual(String(ctx.window.Reader.calls[0].id), String(ctx.window.WORLD.posts[3].id), 'Reader.open receives tower post id');
  assert.strictEqual(ctx.window.Reader.calls[0].localData, ctx.window.WORLD.posts[3], 'Reader.open receives local post data');

  const street = city.streets[0];
  env.rayMode = 'citizen';
  env.citizenHitIndex = city.citizenIndexByHandle.get(street.a);
  canvas.dispatch('pointermove', { clientX: 500, clientY: 350 });
  assert(elems.tooltip.innerHTML.includes(street.a), 'citizen hover writes tooltip handle');
  assert(elems.tooltip.innerHTML.includes('talks with:'), 'citizen tooltip includes talks-with line');
  assert(city.highlightStreets.userData.streetCount > 0, 'citizen hover builds highlight streets');
  assert(city.highlightStreets.userData.streetCount <= 20, 'citizen hover highlight capped to 20 streets');
  canvas.dispatch('pointerdown', { clientX: 500, clientY: 350 });
  canvas.dispatch('pointerup', { clientX: 500, clientY: 350 });
  assert(view.__debug.city.stickyHit && view.__debug.city.stickyHit.type === 'citizen', 'citizen click pins sticky tooltip');

  assert.strictEqual(view.__debug.soulCount, 60, 'souls-in-transit pool has 60 motes');
  assert(calls.some((c) => c.name === 'Points' && c.points === 60), 'THREE.Points built with 60 vertices');
  assert.strictEqual(view.__debug.hooksWrapped, true, 'WorldAPI hooks wrapped');
  const beforeCalls = ctx.window.__callThrough;
  ctx.window.WorldAPI.addComment({ post_id: ctx.window.WORLD.posts[0].id, author: street.a, created_at: ctx.window.WORLD.generated_at + 1 });
  assert.strictEqual(ctx.window.__callThrough, beforeCalls + 1, 'wrapped addComment calls through original hook');
  ctx.window.WorldAPI.touchCitizen(street.a, ctx.window.WORLD.generated_at + 2);
  assert(city.soulMotes.some((m) => m.flareUntil > 8000), 'touchCitizen hook spawns a flare mote');

  return {
    streets: city.streets.length,
    recent: city.recentStreetList.length,
    highlight: city.highlightStreets.userData.streetCount,
    souls: view.__debug.soulCount,
    readerId: ctx.window.Reader.calls[0].id,
    callThrough: ctx.window.__callThrough,
  };
}

function syntaxCheck() {
  const files = ['world_data.js', 'convo_graph.js', 'tower_data.js', 'world.js', 'tower.js', 'city3d.js', 'offices.js', 'reader.js', 'live.js', 'smoke_test.js', 'smoke_test2.js', 'smoke_test3.js', 'smoke_test4.js', 'smoke_test5.js', 'smoke_test6.js', 'smoke_test7.js', 'smoke_test8.js', 'smoke_convo_fixture.js'];
  for (const file of files) execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'pipe' });
  return files;
}

try {
  const result = runStage10();
  const checked = syntaxCheck();
  console.log('stage10 city3d streets/souls OK');
  console.log('street counts:', JSON.stringify({ streets: result.streets, recent: result.recent, highlight: result.highlight }));
  console.log('souls:', result.souls);
  console.log('Reader.open id:', String(result.readerId));
  console.log('WorldAPI call-through:', result.callThrough);
  console.log('node --check OK:', checked.join(', '));
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
