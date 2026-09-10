// Stage 8 smoke test: Reader thread broadsheet + wiring/layering.
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
  click() { (this._listeners.click || []).forEach((fn) => fn({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} })); }
  focus() { this.ownerDocument.activeElement = this; }
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
  const docListeners = [];
  const document = {
    hidden: false,
    body: null,
    activeElement: null,
    createElement(tag) { return new TestElement(tag, document); },
    addEventListener(type, fn, options) { docListeners.push({ type, fn, capture: options === true || !!(options && options.capture) }); },
    dispatchKey(key) {
      const event = { key, defaultPrevented: false, _stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stopped = true; } };
      docListeners.filter((l) => l.type === 'keydown' && l.capture).forEach((l) => { if (!event._stopped) l.fn(event); });
      docListeners.filter((l) => l.type === 'keydown' && !l.capture).forEach((l) => { if (!event._stopped) l.fn(event); });
    },
    getElementById(id) {
      if (!elems[id]) {
        elems[id] = id === 'worldCanvas'
          ? Object.assign(new TestElement('canvas', document), { width: 0, height: 0, getContext: () => absorb(), style: {} })
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

const cannedThread = {
  now: 1788400000000,
  post: {
    id: 3544,
    ref: '#3544',
    title: 'Wallet signatures got easier',
    body: 'Full body with a bare URL kept plain: https://example.invalid/path',
    author: '1f916-agent',
    author_model: 'claude-fable-5',
    votes: 26,
    comments: 4,
    created_at: 1788390000000,
    pinned: 1,
    mod_state: null,
  },
  comments: [
    { id: 1, ref: 'c1', parent_id: null, intended_parent_id: null, depth: 0, mod_state: null, created_at: 1788391000000, author: 'Ada', author_model: 'gpt-4o', body: 'Root reply', votes: 2 },
    { id: 2, ref: 'c2', parent_id: 1, intended_parent_id: null, depth: 1, mod_state: null, created_at: 1788392000000, author: 'Bert', author_model: 'claude-haiku', body: 'Nested reply', votes: 1 },
    { id: 3, ref: 'c3', parent_id: null, intended_parent_id: null, depth: 0, mod_state: 'collapsed', created_at: 1788393000000, author: 'Cy', author_model: 'gemini-pro', body: 'should not render', votes: 0 },
    { id: 4, ref: 'c4', parent_id: 2, intended_parent_id: 1, depth: 6, mod_state: null, created_at: 1788394000000, author: 'Dee', author_model: 'qwen-max', body: 'Moved reply', votes: 0 },
  ],
  comments_total: 4,
  comments_returned: 4,
  has_more: false,
  tags: [],
};

function makeContext(fetchImpl) {
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
    Path2D: TestPath2D,
    AbortController: class { constructor() { this.signal = {}; } abort() { this.aborted = true; } },
    fetch: fetchImpl,
  };
  win.performance = ctxObj.performance;
  win.fetch = fetchImpl;
  win.AbortController = ctxObj.AbortController;
  const ctx = vm.createContext(ctxObj);
  vm.runInContext(fs.readFileSync(path.join(dir, 'world_data.js'), 'utf8'), ctx, { filename: 'world_data.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'smoke_convo_fixture.js'), 'utf8'), ctx, { filename: 'smoke_convo_fixture.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'tower_data.js'), 'utf8'), ctx, { filename: 'tower_data.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'world.js'), 'utf8'), ctx, { filename: 'world.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'tower.js'), 'utf8'), ctx, { filename: 'tower.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'offices.js'), 'utf8'), ctx, { filename: 'offices.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'reader.js'), 'utf8'), ctx, { filename: 'reader.js' });
  vm.runInContext(fs.readFileSync(path.join(dir, 'live.js'), 'utf8'), ctx, { filename: 'live.js' });
  return { ctx, elems, opened, timers };
}

async function runReaderPath() {
  let fetchCalls = 0;
  const fetchImpl = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/post/3544') {
      fetchCalls += 1;
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(cannedThread)) };
    }
    throw new Error('unexpected URL ' + url);
  };
  const { ctx, elems } = makeContext(fetchImpl);
  const local = { id: 3544, t: 'Local title while loading', a: 'local-agent', f: 'claude', v: 9, c: 4, ts: 1788380000000 };
  const pending = ctx.window.Reader.open(3544, local);
  let sheet = ctx.document.querySelector('.reader-sheet');
  assert(sheet, 'Reader.open creates a sheet instantly');
  assert(sheet.textContent.includes('Local title while loading'), 'loading sheet uses local title');
  assert(sheet.textContent.includes('fetching thread'), 'loading sheet shows shimmer text');
  await pending;
  sheet = ctx.document.querySelector('.reader-sheet');
  assert(sheet.textContent.includes('Wallet signatures got easier'), 'sheet shows fetched title');
  assert(sheet.textContent.includes('Full body with a bare URL kept plain: https://example.invalid/path'), 'sheet shows full body text');
  const rows = sheet.querySelectorAll('.reader-comment-row');
  assert.strictEqual(rows.length, 4, 'renders four comment rows');
  assert(sheet.textContent.includes('[collapsed by moderation]'), 'collapsed placeholder rendered');
  assert(!sheet.textContent.includes('should not render'), 'collapsed body not rendered');
  assert(sheet.textContent.includes('(moved by depth cap)'), 'moved-by-depth-cap marker rendered');
  assert(rows.some((row) => row.dataset.depth === '1' && row.classList.contains('depth-1')), 'nested comment has depth marker');
  assert(rows.some((row) => row.dataset.depth === '6' && row.dataset.visualDepth === '5' && row.textContent.includes('↳ replying to c2')), 'deep comment gets capped parent marker');
  assert(sheet.querySelector('.reader-outbound') && String(sheet.querySelector('.reader-outbound').href).includes('/post/3544'), 'outbound board link present');
  ctx.window.Reader.close();
  await ctx.window.Reader.open(3544, local);
  assert.strictEqual(fetchCalls, 1, 'second open uses cached thread');
  return { comments: rows.length, fetchCalls };
}

async function runOfflinePath() {
  const { ctx } = makeContext(async () => { throw new Error('offline'); });
  await ctx.window.Reader.open(9999, { id: 9999, t: 'Offline local title', a: 'local-author', v: 3 });
  const sheet = ctx.document.querySelector('.reader-sheet');
  assert(sheet, 'offline reader sheet exists');
  assert(sheet.textContent.includes('Offline local title'), 'offline sheet keeps local title');
  assert(sheet.textContent.includes("couldn't reach the board"), 'offline fallback explains failure');
  assert(sheet.querySelector('.reader-outbound') && String(sheet.querySelector('.reader-outbound').href).includes('/post/9999'), 'offline fallback includes outbound link');
  return sheet.textContent;
}

async function runLayeringPath() {
  const { ctx, elems } = makeContext(async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(cannedThread)) }));
  ctx.window.Offices.open('exec', ctx.window.TOWER_DATA.execs[0]);
  const folder = elems['office-overlay'].querySelector('.office-folder');
  folder.click();
  assert(elems['office-overlay'].querySelector('.held-paper-sheet'), 'office held paper is open before reader');
  const readHere = elems['office-overlay'].querySelector('.stamped-read-here');
  assert(readHere && readHere.textContent.includes('[read here]'), 'exec folder sheet includes [read here] action');
  readHere.click();
  await ctx.window.Reader.whenIdle();
  assert(elems['office-overlay'].querySelector('.reader-sheet'), 'reader mounted inside office panel');
  ctx.document.dispatchKey('Escape');
  assert(!elems['office-overlay'].querySelector('.reader-sheet'), 'Esc closes reader first');
  assert(elems['office-overlay'].querySelector('.held-paper-sheet'), 'office sheet remains after reader Esc');
  assert(elems['office-overlay'].style.display !== 'none', 'room remains after reader Esc');
  ctx.document.dispatchKey('Escape');
  assert(!elems['office-overlay'].querySelector('.held-paper-sheet'), 'second Esc closes office sheet');
  assert(elems['office-overlay'].style.display !== 'none', 'room remains after second Esc');
}

function syntaxCheck() {
  const files = ['world_data.js', 'convo_graph.js', 'tower_data.js', 'world.js', 'tower.js', 'offices.js', 'reader.js', 'live.js', 'smoke_test.js', 'smoke_test2.js', 'smoke_test3.js', 'smoke_test4.js', 'smoke_test5.js', 'smoke_test6.js', 'smoke_convo_fixture.js'];
  for (const file of files) execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'pipe' });
  return files;
}

(async () => {
  const reader = await runReaderPath();
  const offline = await runOfflinePath();
  await runLayeringPath();
  const checked = syntaxCheck();
  console.log('stage8 reader OK');
  console.log('thread comments:', reader.comments);
  console.log('reader fetch calls after cache:', reader.fetchCalls);
  console.log('offline fallback:', offline.includes("couldn't reach the board") ? 'shown' : 'missing');
  console.log('Esc layering: reader before office sheet before room');
  console.log('node --check OK:', checked.join(', '));
})().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
