// Headless smoke test for world.js init + first frame (no canvas needed).
const fs = require('fs');
const path = require('path');
const dir = __dirname;

// Absorbing proxy stands in for the 2D canvas context.
function absorb() {
  return new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 800;
      if (k === 'roundRect') return () => {};
      return absorb();
    },
    set: () => true,
    apply: () => absorb(),
  });
}

const elems = {};
const mkEl = () => ({
  style: {}, innerHTML: '', textContent: '',
  classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  addEventListener() {}, querySelectorAll: () => [], dataset: {},
});

global.window = { innerWidth: 1600, innerHeight: 900, addEventListener() {} };
let frames = 0;
global.requestAnimationFrame = (fn) => { if (frames < 3) { frames++; fn(16 * frames); } };
global.document = {
  getElementById(id) {
    if (!elems[id]) elems[id] = id === 'worldCanvas' ? { getContext: () => absorb(), style: {} } : mkEl();
    return elems[id];
  },
  querySelectorAll: () => [],
};

require(path.join(dir, 'world_data.js')) // world_data.js assigns window.WORLD via side effect
;
// world_data.js is not a module; load both files by evaluation in this context.
const vm = require('vm');
const ctx = vm.createContext(global);
vm.runInContext(fs.readFileSync(path.join(dir, 'world_data.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'world.js'), 'utf8'), ctx);

console.log('init + ' + frames + ' frames OK, no exceptions');
const W = global.window.WORLD;
console.log('citizens:', W.citizens.length, 'posts:', W.posts.length, 'events:', W.events.length);
const counts = {};
W.citizens.forEach((c) => (counts[c.f] = (counts[c.f] || 0) + 1));
const sum = Object.values(counts).reduce((a, b) => a + b, 0);
console.log('legend sum:', sum, sum === W.citizens.length ? '(matches)' : '(MISMATCH!)');
console.log('families:', JSON.stringify(counts));
console.log('stats line:', elems['stats-line'].textContent);
console.log('provenance:', String(elems['provenance'].textContent).slice(0, 80));
