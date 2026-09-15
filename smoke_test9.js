// Stage 11 smoke test: build verification HUD + live Base accounting cross-check.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const dir = __dirname;

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
    this.hidden = false;
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
  set innerHTML(v) { this.textContent = v; }
  querySelectorAll(selector) { return queryAll(this, selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function matches(el, selector) {
  if (!(el instanceof TestElement)) return false;
  if (selector[0] === '.') return selector.slice(1).split('.').every((name) => el.classList.contains(name));
  if (selector[0] === '#') return el.id === selector.slice(1);
  if (selector.startsWith('[')) {
    const m = selector.match(/\[([^=\]]+)(="([^"]*)")?\]/);
    if (!m) return false;
    const attr = m[1];
    const actual = attr.startsWith('data-') ? el.dataset[attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : el.attributes[attr];
    return m[3] == null ? actual !== undefined : String(actual) === m[3];
  }
  return el.tagName.toLowerCase() === selector.toLowerCase();
}
function queryAll(root, selector) {
  const parts = selector.trim().split(/\s+/);
  let current = [root];
  for (const part of parts) {
    const next = [];
    current.forEach((node) => {
      const walk = (n) => (n.children || []).forEach((child) => { if (matches(child, part)) next.push(child); walk(child); });
      walk(node);
    });
    current = next;
  }
  return current;
}
function makeDom() {
  const elems = {};
  const document = {
    body: null,
    createElement(tag) { return new TestElement(tag, document); },
    addEventListener() {},
    getElementById(id) {
      if (!elems[id]) { elems[id] = new TestElement('div', document); elems[id].id = id; document.body.appendChild(elems[id]); }
      return elems[id];
    },
    querySelectorAll(selector) { return queryAll(document.body, selector); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  document.body = new TestElement('body', document);
  return { document, elems };
}

function b64u(buf) { return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
async function dataHash() {
  const h = crypto.createHash('sha256');
  ['world_data.js', 'convo_graph.js', 'tower_data.js'].forEach((f) => h.update(fs.readFileSync(path.join(dir, f))));
  return h.digest('hex');
}
async function makeSignedStatement({ tamper = false } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = spki.subarray(spki.length - 32);
  const hash = await dataHash();
  const statement = `1f916.window.build.v1:hola-watcher:${hash}:testcommit:2026-09-15T00:00:00.000Z`;
  const signature = crypto.sign(null, Buffer.from(statement), privateKey);
  return {
    statement: tamper ? statement.replace('hola-watcher', 'hola-watchfs') : statement,
    signature: b64u(signature),
    public_key: b64u(rawPub),
    thumbprint: 'test-thumbprint',
    commit: 'testcommit',
    built_at: '2026-09-15T00:00:00.000Z',
    data_sha256: hash,
  };
}

function makeResponse(body, asJson = true) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    arrayBuffer: async () => Buffer.from(String(body)).buffer.slice(Buffer.from(String(body)).byteOffset, Buffer.from(String(body)).byteOffset + Buffer.from(String(body)).byteLength),
  };
}

async function runVerifyCase(tamper) {
  const statement = await makeSignedStatement({ tamper });
  const { document } = makeDom();
  const fetches = [];
  const win = { document, crypto: crypto.webcrypto, addEventListener() {}, TextEncoder, TextDecoder, atob: (s) => Buffer.from(s, 'base64').toString('binary'), __BUILD_VERIFY_PUBLIC_KEY: statement.public_key };
  win.window = win;
  const ctx = vm.createContext({ window: win, document, console, fetch: async (url) => {
    fetches.push(String(url));
    if (String(url) === 'build_statement.json') return makeResponse(statement);
    const file = path.basename(String(url));
    if (['world_data.js', 'convo_graph.js', 'tower_data.js'].includes(file)) return makeResponse(fs.readFileSync(path.join(dir, file), 'utf8'), false);
    throw new Error('unexpected fetch ' + url);
  }, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Promise, setTimeout, clearTimeout, atob: win.atob });
  ctx.crypto = crypto.webcrypto;
  vm.runInContext(fs.readFileSync(path.join(dir, 'verify.js'), 'utf8'), ctx, { filename: 'verify.js' });
  await ctx.window.BuildVerify.ready;
  const panel = document.querySelector('#verify-panel');
  const panelText = panel ? panel.textContent : '';
  return { panelText, fetches };
}

async function runAccountingCase(liveCents) {
  const { document } = makeDom();
  const overlay = document.getElementById('office-overlay');
  const requests = [];
  const onchain = 12345;
  const hex = '0x' + BigInt(liveCents * 10000).toString(16);
  const win = {
    document,
    WORLD: { family_colors: {}, generated_at: 1789058153986 },
    TOWER_DATA: { accounting: { booked_cents: 100, onchain_cents: onchain, unbooked_cents: 25, note: 'test books', wallet: { address: '0xa7F7985eB19b8c44F12A0654Df1eF89d1dd527C9', asset: 'USDC', network: 'Base' }, events: [], spending_policy: 'test policy' } },
    addEventListener() {},
    requestAnimationFrame(fn) { fn(); },
    fetch: async (url, opts) => { requests.push({ url: String(url), body: JSON.parse(opts.body) }); return makeResponse({ jsonrpc: '2.0', id: 1, result: hex }); },
    AbortController: class { constructor() { this.signal = {}; } abort() { this.aborted = true; } },
  };
  win.window = win;
  const ctx = vm.createContext({ window: win, document, console, fetch: win.fetch, AbortController: win.AbortController, setTimeout: (fn) => 1, clearTimeout() {}, requestAnimationFrame: win.requestAnimationFrame });
  vm.runInContext(fs.readFileSync(path.join(dir, 'offices.js'), 'utf8'), ctx, { filename: 'offices.js' });
  ctx.window.Offices.open('accounting');
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const live = document.querySelector('.live-base-readout');
  assert(live, 'live Base readout exists');
  return { text: live.textContent, requests };
}

async function run() {
  const valid = await runVerifyCase(false);
  assert(valid.panelText.toUpperCase().includes('SIGNATUREPASS'), 'valid signed statement reports signature PASS');
  assert(valid.panelText.toUpperCase().includes('DATA HASHPASS'), 'valid signed statement reports data hash PASS');
  const tampered = await runVerifyCase(true);
  assert(tampered.panelText.toUpperCase().includes('SIGNATUREFAIL'), 'tampered statement reports signature FAIL');

  const match = await runAccountingCase(12345);
  assert(match.text.includes('$123.45'), 'live Base readout parses USDC hex into dollars');
  assert(match.text.includes('MATCH'), 'matching live balance gets MATCH badge');
  assert.strictEqual(match.requests.length, 1, 'accounting room makes one Base RPC fetch');
  assert.deepStrictEqual(match.requests[0].body, {
    jsonrpc: '2.0', id: 1, method: 'eth_call',
    params: [{ to: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', data: '0x70a08231000000000000000000000000a7f7985eb19b8c44f12a0654df1ef89d1dd527c9' }, 'latest'],
  }, 'Base RPC request shape is exact');
  const mismatch = await runAccountingCase(20000);
  assert(mismatch.text.includes('$200.00'), 'mismatch path still shows live figure');
  assert(mismatch.text.includes('MISMATCH'), 'different live balance gets MISMATCH badge');

  const checked = ['verify.js', 'offices.js', 'smoke_test9.js'];
  checked.forEach((file) => execFileSync(process.execPath, ['--check', path.join(dir, file)], { stdio: 'pipe' }));
  console.log('stage11 verify/live Base OK');
  console.log('verify valid:', valid.panelText.replace(/\s+/g, ' ').trim());
  console.log('verify tampered:', tampered.panelText.replace(/\s+/g, ' ').trim());
  console.log('Base match:', match.text.replace(/\s+/g, ' ').trim());
  console.log('Base mismatch:', mismatch.text.replace(/\s+/g, ' ').trim());
  console.log('node --check OK:', checked.join(', '));
}

run().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
