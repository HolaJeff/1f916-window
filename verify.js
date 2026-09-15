/* Stage 11: client-side build statement verification (verify-only, no signing). */
(function () {
    const KEY_URL = 'https://1f916.ai/api/keys/hola-watcher';
    const PUBLISHED_PUBLIC_KEY = window.__BUILD_VERIFY_PUBLIC_KEY || '-g-c_4RdPPeL3YAcPWopiMfIQxxRSOHeIRKXDRDMXXU';
    const DATA_FILES = ['world_data.js', 'convo_graph.js', 'tower_data.js'];
    const encoder = new TextEncoder();

    const $ = (sel, root) => (root || document).querySelector(sel);
    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    };
    const append = (parent, child) => parent.appendChild(child);
    const b64urlBytes = (value) => {
        const s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
        const bin = atob(s + '==='.slice((s.length + 3) % 4));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    };
    const hex = (bytes) => Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const setStatus = (node, state) => {
        node.classList.remove('pass', 'fail', 'warn');
        node.classList.add(state);
    };
    const statusRow = (label, state, detail) => {
        const row = el('div', 'verify-row');
        append(row, el('span', 'verify-label', label));
        const badge = el('span', 'verify-status ' + state, state === 'pass' ? 'PASS' : state === 'fail' ? 'FAIL' : "COULDN'T VERIFY");
        append(row, badge);
        append(row, el('span', 'verify-detail', detail || ''));
        return row;
    };

    async function verifySignature(statement) {
        if (String(statement.public_key || '') !== PUBLISHED_PUBLIC_KEY) return { ok: false, state: 'fail', detail: 'statement public key differs from published hola-watcher key' };
        const subtle = window.crypto && window.crypto.subtle;
        if (!subtle) return { ok: false, state: 'warn', detail: 'WebCrypto unavailable; statement shown only' };
        try {
            const key = await subtle.importKey('raw', b64urlBytes(PUBLISHED_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify']);
            const ok = await subtle.verify({ name: 'Ed25519' }, key, b64urlBytes(statement.signature), encoder.encode(String(statement.statement || '')));
            return { ok, state: ok ? 'pass' : 'fail', detail: ok ? 'Ed25519 verified' : 'signature does not match statement' };
        } catch (err) {
            return { ok: false, state: 'warn', detail: 'Ed25519 unavailable here; statement shown only' };
        }
    }

    async function dataHash() {
        const subtle = window.crypto && window.crypto.subtle;
        if (!subtle) throw new Error('WebCrypto digest unavailable');
        const chunks = await Promise.all(DATA_FILES.map(async (file) => {
            const res = await fetch(file, { cache: 'no-store' });
            if (!res.ok) throw new Error(file + ' HTTP ' + res.status);
            return new Uint8Array(await res.arrayBuffer());
        }));
        const size = chunks.reduce((n, chunk) => n + chunk.length, 0);
        const joined = new Uint8Array(size);
        let offset = 0;
        chunks.forEach((chunk) => { joined.set(chunk, offset); offset += chunk.length; });
        return hex(await subtle.digest('SHA-256', joined));
    }

    function renderResult(panel, result) {
        panel.replaceChildren();
        append(panel, el('div', 'verify-title', 'BUILD VERIFY'));
        if (result.error) {
            append(panel, statusRow('statement', 'warn', result.error));
            return;
        }
        append(panel, statusRow('signature', result.signature.state, result.signature.detail));
        append(panel, statusRow('data hash', result.hash.state, result.hash.detail));
        const meta = el('div', 'verify-meta');
        append(meta, el('div', '', 'commit: ' + (result.statement.commit || '—')));
        append(meta, el('div', '', 'built: ' + (result.statement.built_at || '—')));
        append(meta, el('div', '', 'thumbprint: ' + (result.statement.thumbprint || '—')));
        const keyLink = el('a', 'verify-key-link', 're-check hola-watcher key →');
        keyLink.href = KEY_URL;
        keyLink.target = '_blank';
        keyLink.rel = 'noopener';
        append(meta, keyLink);
        append(panel, meta);
    }

    async function run(panel) {
        try {
            const res = await fetch('build_statement.json', { cache: 'no-store' });
            if (!res.ok) throw new Error('build_statement.json HTTP ' + res.status);
            const statement = await res.json();
            const signature = await verifySignature(statement);
            let hash;
            try {
                const actual = await dataHash();
                const ok = actual === String(statement.data_sha256 || '').toLowerCase();
                hash = { ok, state: ok ? 'pass' : 'fail', detail: ok ? actual.slice(0, 16) + '… matches' : 'loaded data hash ' + actual.slice(0, 16) + '… differs' };
            } catch (err) {
                hash = { ok: false, state: 'warn', detail: err.message || 'could not hash loaded data' };
            }
            const result = { statement, signature, hash };
            renderResult(panel, result);
            return result;
        } catch (err) {
            const result = { error: "couldn't verify: " + (err.message || err) };
            renderResult(panel, result);
            return result;
        }
    }

    function init() {
        const host = $('.hud-bottom-right') || document.body;
        const wrap = el('div', 'verify-hud');
        const button = el('button', 'verify-button', '[verify]');
        button.id = 'verify-button';
        button.type = 'button';
        button.setAttribute('aria-expanded', 'false');
        const panel = el('section', 'verify-panel');
        panel.id = 'verify-panel';
        panel.hidden = true;
        panel.setAttribute('aria-live', 'polite');
        append(panel, el('div', 'verify-title', 'BUILD VERIFY'));
        append(panel, statusRow('statement', 'warn', 'checking build_statement.json…'));
        button.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            button.setAttribute('aria-expanded', String(!panel.hidden));
        });
        append(wrap, button);
        append(wrap, panel);
        append(host, wrap);
        const ready = run(panel);
        window.BuildVerify.ready = ready;
        return ready;
    }

    window.BuildVerify = { init, run, ready: null, _test: { b64urlBytes, dataHash, verifySignature } };
    if (document.body) init();
})();
