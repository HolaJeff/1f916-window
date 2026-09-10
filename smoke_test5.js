// Stage 5 smoke test: clickable office floors + DOM overlay.
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
  replaceChildren(...kids) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = ''; kids.forEach((k) => this.appendChild(k)); }
  addEventListener(type, fn) { (this._listeners[type] || (this._listeners[type] = [])).push(fn); }
  click() { (this._listeners.click || []).forEach((fn) => fn({ target: this, currentTarget: this })); }
  setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = v; else this[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; }
  get innerHTML() { return this.textContent; }
  set innerHTML(v) { this.textContent = v; }
  querySelectorAll(selector) { return queryAll(this, selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
}

function matches(el, selector) {
  if (!(el instanceof TestElement)) return false;
  if (selector[0] === '.') return el.classList.contains(selector.slice(1));
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

function amountLabel(amount, sym) {
  const n = Number(amount) || 0;
  if (sym === 'USDC') return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDC';
  return n.toLocaleString() + ' ' + (sym || '1F916');
}
function listingSort(a, b) {
  const as = a.sym === 'USDC' ? 0 : 1;
  const bs = b.sym === 'USDC' ? 0 : 1;
  return as - bs || String(a.id).localeCompare(String(b.id));
}

function makeDom() {
  const elems = {};
  const docListeners = {};
  const document = {
    hidden: false,
    body: null,
    createElement(tag) { return new TestElement(tag, document); },
    addEventListener(type, fn) { (docListeners[type] || (docListeners[type] = [])).push(fn); },
    dispatchKey(key) { (docListeners.keydown || []).forEach((fn) => fn({ key })); },
    getElementById(id) {
      if (!elems[id]) {
        elems[id] = id === 'worldCanvas'
          ? Object.assign(new TestElement('canvas', document), { width: 0, height: 0, getContext: () => absorb(), style: {} })
          : new TestElement('div', document);
        elems[id].id = id;
      }
      return elems[id];
    },
    querySelectorAll(selector) { return queryAll(document.body, selector); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  document.body = new TestElement('body', document);
  return { elems, document };
}

function makeContext({ loadTowerData = true, loadConvo = true } = {}) {
  const { elems, document } = makeDom();
  const localStore = new Map();
  const opened = [];
  const win = {
    innerWidth: 1600,
    innerHeight: 900,
    addEventListener() {},
    open(url, target) { opened.push({ url, target }); },
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
  if (loadTowerData) vm.runInContext(fs.readFileSync(path.join(dir, 'tower_data.js'), 'utf8'), ctx, { filename: 'tower_data.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'world.js'), 'utf8'), ctx, { filename: 'world.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'tower.js'), 'utf8'), ctx, { filename: 'tower.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'offices.js'), 'utf8'), ctx, { filename: 'offices.js' });
  return { ctx, elems, opened };
}

function runOfficePath() {
  const { ctx, elems } = makeContext({ loadTowerData: true });
  const TD = ctx.window.TOWER_DATA;
  ctx.window.WorldViews.set('tower');
  const tower = ctx.window.WorldViews.views.tower;
  tower.layout(1600, 900);
  const floorKeys = tower.__layout.bands.map((b) => b.key);
  assert(floorKeys.includes('exec'), 'tower layout includes exec floor');
  assert(floorKeys.includes('sales'), 'tower layout includes sales floor');
  assert(floorKeys.includes('accounting'), 'tower layout includes accounting floor');
  assert.strictEqual(tower.__layout.execWindows.length, 12, 'exec floor has 12 windows');
  const firstExec = tower.__layout.execWindows[0];
  const hit = tower.hitTest(firstExec.x + firstExec.w / 2, firstExec.y + firstExec.h / 2);
  assert(hit && hit.type === 'exec' && hit.data === firstExec.data, 'hitTest at exec window center returns that exec');

  ctx.window.Offices.open('exec', firstExec.data);
  assert(elems['office-overlay'].style.display !== 'none', 'overlay shown for exec');
  const fileRows = elems['office-overlay'].querySelectorAll('.office-folder');
  assert.strictEqual(fileRows.length, firstExec.data.files.length, 'exec room contains one folder per file');
  assert.strictEqual(fileRows.length, 8, 'exec overlay has 8 file rows');
  fileRows[0].click();
  let sheet = elems['office-overlay'].querySelector('.held-paper-sheet');
  assert(sheet, 'exec folder click opens held paper sheet');
  const stamped = sheet.querySelector('.stamped-outbound');
  assert(stamped && String(stamped.href).includes('/post/'), 'exec folder sheet has outbound stamped post link');
  assert(sheet.textContent.includes('full thread lives on the board'), 'exec folder sheet points to board thread');
  ctx.document.dispatchKey('Escape');
  assert(!elems['office-overlay'].querySelector('.held-paper-sheet'), 'Esc closes exec sheet before room');
  assert(elems['office-overlay'].style.display !== 'none', 'room remains open after first Esc');
  const leaveDoor = elems['office-overlay'].querySelector('.office-door');
  assert(leaveDoor, 'exec room has a clickable leave door');
  leaveDoor.click();
  assert.strictEqual(elems['office-overlay'].children.length, 0, 'clicking the door empties overlay');
  assert.strictEqual(elems['office-overlay'].style.display, 'none', 'clicking the door hides overlay');

  ctx.window.Offices.open('sales');
  const listingRows = elems['office-overlay'].querySelectorAll('.sales-listing-row');
  const openListings = TD.sales.listings.filter((l) => !l.withdrawn).sort(listingSort);
  assert.strictEqual(listingRows.length, openListings.length, 'sales lists all non-withdrawn listings');
  const listedSyms = listingRows.map((r) => r.dataset.sym);
  const firstNonUsdc = listedSyms.findIndex((sym) => sym !== 'USDC');
  assert(firstNonUsdc < 0 || listedSyms.slice(firstNonUsdc).every((sym) => sym !== 'USDC'), 'USDC rows are before 1F916 rows');
  listingRows[0].click();
  sheet = elems['office-overlay'].querySelector('.held-paper-sheet');
  assert(sheet, 'clicking a sales card opens a held paper sheet');
  assert(sheet.textContent.includes(amountLabel(openListings[0].amount, openListings[0].sym)), 'listing sheet includes amount text');
  const listingStamped = sheet.querySelector('.stamped-outbound');
  assert(listingStamped && String(listingStamped.href).includes('/post/'), 'listing sheet has stamped post link');
  elems['office-overlay'].querySelector('.held-paper-close').click();
  assert(!elems['office-overlay'].querySelector('.held-paper-sheet'), 'sheet close empties listing sheet');
  listingRows[1].click();
  assert(elems['office-overlay'].querySelector('.held-paper-sheet'), 'second sales card opens another sheet');
  elems['office-overlay'].querySelector('.held-paper-backdrop').click();
  assert(!elems['office-overlay'].querySelector('.held-paper-sheet'), 'sheet backdrop click empties listing sheet');
  const docketRows = elems['office-overlay'].querySelectorAll('.docket-row');
  assert.strictEqual(docketRows.length, TD.sales.docket.length, 'clipboard lists all docket rows');
  docketRows[0].click();
  sheet = elems['office-overlay'].querySelector('.held-paper-sheet');
  assert(sheet && sheet.textContent.includes(TD.sales.docket[0].note), 'clipboard item sheet contains note text');
  assert.strictEqual(sheet.querySelectorAll('.source-post-link').length, TD.sales.docket[0].source_posts.length, 'clipboard sheet has one source-post link per source post');
  ctx.document.dispatchKey('Escape');
  assert(!elems['office-overlay'].querySelector('.held-paper-sheet'), 'Esc closes clipboard sheet before room');
  assert(elems['office-overlay'].style.display !== 'none', 'sales room remains open after sheet Esc');
  assert(elems['office-overlay'].querySelectorAll('.closed-listing-row').length === TD.sales.listings.filter((l) => l.withdrawn).length, 'withdrawn listings are in closed deals');

  ctx.window.Offices.open('accounting');
  const accountingText = elems['office-overlay'].textContent;
  assert(accountingText.includes('THE BOOKS'), 'accounting overlay title present');
  assert(accountingText.includes('$' + (TD.accounting.booked_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })), 'booked figure shown');
  assert(accountingText.includes('$' + (TD.accounting.onchain_cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })), 'onchain figure shown');
  ctx.window.Offices.close();
  assert.strictEqual(elems['office-overlay'].children.length, 0, 'close empties overlay');
  assert.strictEqual(elems['office-overlay'].style.display, 'none', 'close hides overlay');
  return { floors: floorKeys, execWindows: tower.__layout.execWindows.length, fileRows: fileRows.length, salesRows: listingRows.length };
}

function runWithoutTowerData() {
  const { ctx } = makeContext({ loadTowerData: false });
  assert(!ctx.window.TOWER_DATA, 'TOWER_DATA absent in second context');
  assert.strictEqual(ctx.window.WorldViews.set('tower'), 'tower', 'tower still switches without TOWER_DATA');
  const tower = ctx.window.WorldViews.views.tower;
  tower.layout(1600, 900);
  assert.strictEqual((tower.__layout.execWindows || []).length, 0, 'no exec windows without TOWER_DATA');
  tower.draw(absorb(), 1200);
  assert(ctx.window.WorldAPI.__state().views.map, 'map still registered without TOWER_DATA');
  return { citizens: tower.__layout.citizens.length, posts: tower.__layout.posts.length, officeFloors: tower.__layout.bands.filter((b) => b.office).length };
}

function syntaxCheck() {
  const files = ['world_data.js', 'convo_graph.js', 'tower_data.js', 'world.js', 'tower.js', 'offices.js', 'live.js', 'smoke_test.js', 'smoke_test2.js', 'smoke_test3.js', 'smoke_test4.js', 'smoke_test5.js', 'smoke_convo_fixture.js'];
  for (const file of files) execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'pipe' });
  return files;
}

try {
  const office = runOfficePath();
  const noData = runWithoutTowerData();
  const checked = syntaxCheck();
  console.log('stage7 held papers OK');
  console.log('office floor keys:', JSON.stringify(office.floors));
  console.log('exec windows:', office.execWindows);
  console.log('exec file rows:', office.fileRows);
  console.log('open sales listing rows:', office.salesRows);
  console.log('without TOWER_DATA:', JSON.stringify(noData));
  console.log('node --check OK:', checked.join(', '));
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
