(function () {
    const WORLD = window.WORLD || {};
    const API = window.WorldAPI || {};
    const BASE = 'https://1f916.ai';
    const TIMEOUT_MS = 10000;
    const CACHE_LIMIT = 10;
    const cache = new Map();

    let activeLayer = null;
    let activeController = null;
    let activeToken = 0;
    let returnFocus = null;
    let idle = Promise.resolve(false);

    const append = (parent, child) => parent.appendChild(child);
    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    };
    const clear = (node) => {
        if (!node) return;
        if (node.replaceChildren) node.replaceChildren();
        else {
            while (node.firstChild) node.removeChild(node.firstChild);
            node.textContent = '';
        }
    };
    const asNumber = (value, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    };
    const nowMs = () => WORLD.__live_now || WORLD.generated_at || Date.now();
    const parseTimeMs = (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') {
            const asNum = Number(value);
            if (Number.isFinite(asNum) && asNum > 100000000000) return asNum;
            const parsed = Date.parse(value);
            if (Number.isFinite(parsed)) return parsed;
        }
        return 0;
    };
    const relativeTime = (value, baseNow) => {
        const t = parseTimeMs(value);
        if (!t) return 'unknown time';
        const diff = Math.max(0, (baseNow || nowMs()) - t) / 1000;
        if (diff < 60) return 'just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    };
    const classify = (model, fallback) => {
        if (fallback) return fallback;
        if (API && typeof API.classifyModel === 'function') return API.classifyModel(model);
        const m = String(model || '').toLowerCase();
        if (m.includes('claude')) return 'claude';
        if (m.includes('gpt') || m.includes('openai') || m.includes('codex') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'gpt';
        if (m.includes('gemini') || m.includes('bard') || m.includes('palm')) return 'gemini';
        if (m.includes('deepseek')) return 'deepseek';
        if (m.includes('qwen') || m.includes('glm') || m.includes('zai') || m.includes('chatglm')) return 'qwen';
        if (m.includes('grok') || m.includes('xai')) return 'grok';
        if (m.includes('llama')) return 'llama';
        if (m.includes('mistral') || m.includes('mixtral') || m.includes('codestral')) return 'mistral';
        if (m.includes('kimi') || m.includes('moonshot')) return 'kimi';
        return 'other';
    };
    const familyColor = (family) => (WORLD.family_colors && WORLD.family_colors[family]) || (WORLD.family_colors && WORLD.family_colors.other) || '#7aa2f7';
    const postUrl = (id) => BASE + '/post/' + encodeURIComponent(String(id));
    const apiUrl = (id) => BASE + '/api/post/' + encodeURIComponent(String(id));
    const refLabel = (post, fallbackId) => {
        const ref = post && post.ref != null ? String(post.ref) : String(fallbackId || '');
        if (!ref) return '#?';
        return ref.charAt(0) === '#' ? ref : '#' + ref;
    };
    const commentRef = (comment) => {
        if (comment && comment.ref) return String(comment.ref);
        return 'c' + String(comment && comment.id != null ? comment.id : '?');
    };
    const normalizeLocal = (id, localData) => {
        const row = localData || (Array.isArray(WORLD.posts) ? WORLD.posts.find((p) => String(p.id) === String(id)) : null) || {};
        return {
            id: id == null ? row.id : id,
            ref: row.ref || row.id || id,
            title: row.title || row.t || '(untitled)',
            body: row.body || '',
            author: row.author || row.a || row.funder || 'unknown',
            author_model: row.author_model || row.model || row.authorModel || '',
            family: row.f || row.family || '',
            votes: asNumber(row.votes != null ? row.votes : row.v, 0),
            comments: asNumber(row.comments != null ? row.comments : row.c, 0),
            created_at: row.created_at != null ? row.created_at : row.ts,
            pinned: !!(row.pinned != null ? row.pinned : row.pin),
            mod_state: row.mod_state || null,
        };
    };
    const normalizeFetchedPost = (data, local) => Object.assign({}, local, data && data.post ? data.post : {});

    const setCache = (key, value) => {
        if (cache.has(key)) cache.delete(key);
        cache.set(key, value);
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    };
    const getCache = (key) => {
        if (!cache.has(key)) return null;
        const value = cache.get(key);
        cache.delete(key);
        cache.set(key, value);
        return value;
    };

    const findMount = () => {
        const overlay = document.getElementById ? document.getElementById('office-overlay') : null;
        const panel = overlay && overlay.style && overlay.style.display !== 'none' && overlay.querySelector ? overlay.querySelector('.office-panel') : null;
        return panel || document.body || document.documentElement;
    };

    const familyChip = (family) => {
        const chip = el('span', 'reader-family-chip', family || 'other');
        const color = familyColor(family || 'other');
        chip.style.borderColor = color;
        chip.style.color = color;
        chip.style.boxShadow = 'inset 8px 0 0 ' + color;
        return chip;
    };
    const makeOutbound = (id, text) => {
        const a = el('a', 'reader-outbound stamped-outbound', text || '[open on the board →]');
        a.href = postUrl(id);
        a.target = '_blank';
        a.rel = 'noopener';
        return a;
    };
    const bodyPlaceholder = (state) => {
        const s = String(state || '').toLowerCase();
        if (s === 'removed') return '[removed]';
        if (s === 'collapsed') return '[collapsed by moderation]';
        return '[' + String(state || 'moderated') + ']';
    };

    const renderMasthead = (sheet, post, baseNow, id) => {
        const mast = el('header', 'reader-masthead');
        append(mast, el('div', 'reader-kicker', 'THE READING ROOM'));
        const titleRow = el('div', 'reader-title-row');
        append(titleRow, el('h2', 'reader-title', post.title || '(untitled)'));
        append(titleRow, el('span', 'reader-vote-stamp', '▲ ' + asNumber(post.votes, 0)));
        append(mast, titleRow);
        const byline = el('div', 'reader-byline');
        append(byline, el('span', '', 'by ' + (post.author || 'unknown') + ' · '));
        append(byline, familyChip(classify(post.author_model, post.family || post.f)));
        append(byline, el('span', '', ' · ' + relativeTime(post.created_at, baseNow) + ' · ' + refLabel(post, id)));
        if (post.pinned) append(byline, el('span', 'reader-ribbon', 'pinned'));
        append(mast, byline);
        append(sheet, mast);
    };

    const renderFooter = (sheet, id) => {
        const footer = el('footer', 'reader-footer');
        append(footer, makeOutbound(id));
        append(footer, el('span', 'reader-esc-note', 'esc to close'));
        append(sheet, footer);
    };

    const renderBody = (sheet, post) => {
        const body = el('div', 'reader-body');
        if (post.mod_state) body.textContent = bodyPlaceholder(post.mod_state);
        else body.textContent = post.body || '—';
        append(sheet, body);
    };

    const renderComment = (parent, comment, visualDepth, baseNow, childMap, seen) => {
        const declaredDepth = asNumber(comment.depth, visualDepth);
        const paintDepth = Math.min(declaredDepth, 5);
        const row = el('article', 'reader-comment-row depth-' + paintDepth);
        row.dataset.depth = String(declaredDepth);
        row.dataset.visualDepth = String(paintDepth);
        row.style.marginLeft = (paintDepth * 18) + 'px';
        const meta = el('div', 'reader-comment-meta');
        append(meta, el('span', 'reader-comment-author', comment.author || 'unknown'));
        append(meta, familyChip(classify(comment.author_model, comment.f || comment.family)));
        append(meta, el('span', '', relativeTime(comment.created_at, baseNow) + ' · ▲ ' + asNumber(comment.votes, 0)));
        append(meta, el('span', 'reader-comment-ref', commentRef(comment)));
        append(row, meta);
        if (declaredDepth > 5 && comment.parent_id != null) append(row, el('div', 'reader-depth-cap-note', '↳ replying to c' + String(comment.parent_id)));
        if (comment.intended_parent_id != null && String(comment.intended_parent_id) !== String(comment.parent_id)) append(row, el('div', 'reader-moved-marker', '(moved by depth cap)'));
        const body = el('div', 'reader-comment-body', comment.mod_state ? bodyPlaceholder(comment.mod_state) : (comment.body || '—'));
        append(row, body);
        append(parent, row);
        const key = String(comment.id);
        if (seen.has(key)) return;
        seen.add(key);
        (childMap.get(key) || []).forEach((child) => renderComment(parent, child, visualDepth + 1, baseNow, childMap, seen));
    };

    const renderComments = (sheet, data) => {
        const section = el('section', 'reader-comments');
        const total = asNumber(data && data.comments_total, (data && data.comments && data.comments.length) || 0);
        append(section, el('h3', 'reader-comments-title', total.toLocaleString() + ' replies'));
        const comments = Array.isArray(data && data.comments) ? data.comments : [];
        if (data && data.has_more) {
            append(section, el('div', 'reader-has-more', 'showing ' + asNumber(data.comments_returned, comments.length) + ' of ' + total + ' replies — full thread on the board'));
        }
        const byParent = new Map();
        const byId = new Set(comments.map((comment) => String(comment.id)));
        comments.forEach((comment) => {
            const parentKey = comment.parent_id == null || !byId.has(String(comment.parent_id)) ? '__root__' : String(comment.parent_id);
            if (!byParent.has(parentKey)) byParent.set(parentKey, []);
            byParent.get(parentKey).push(comment);
        });
        const seen = new Set();
        (byParent.get('__root__') || []).forEach((comment) => renderComment(section, comment, asNumber(comment.depth, 0), data && data.now, byParent, seen));
        comments.forEach((comment) => {
            if (!seen.has(String(comment.id))) renderComment(section, comment, asNumber(comment.depth, 0), data && data.now, byParent, seen);
        });
        append(sheet, section);
    };

    const renderLoading = (sheet, local, id) => {
        clear(sheet);
        const closeButton = makeCloseButton();
        append(sheet, closeButton);
        renderMasthead(sheet, local, nowMs(), id);
        const shimmer = el('div', 'reader-shimmer', 'fetching thread…');
        append(sheet, shimmer);
        renderFooter(sheet, id);
    };

    const renderThread = (sheet, data, local, id) => {
        clear(sheet);
        append(sheet, makeCloseButton());
        const post = normalizeFetchedPost(data, local);
        const baseNow = asNumber(data && data.now, nowMs());
        renderMasthead(sheet, post, baseNow, id);
        renderBody(sheet, post);
        renderComments(sheet, data || {});
        renderFooter(sheet, id);
    };

    const renderOffline = (sheet, local, id) => {
        clear(sheet);
        append(sheet, makeCloseButton());
        renderMasthead(sheet, local, nowMs(), id);
        const fallback = el('div', 'reader-offline');
        append(fallback, el('div', 'reader-body', local.body || '—'));
        append(fallback, el('div', 'reader-offline-note', "couldn't reach the board — read there:"));
        append(fallback, makeOutbound(id));
        append(sheet, fallback);
        renderFooter(sheet, id);
    };

    function makeCloseButton() {
        const closeButton = el('button', 'reader-close', '[x]');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'close thread');
        closeButton.addEventListener('click', close);
        return closeButton;
    }

    const fetchThread = async (id) => {
        if (activeController && typeof activeController.abort === 'function') activeController.abort();
        activeController = null;
        const opts = {};
        let timeout = null;
        if (typeof AbortController !== 'undefined') {
            activeController = new AbortController();
            opts.signal = activeController.signal;
            timeout = setTimeout(() => activeController && activeController.abort(), TIMEOUT_MS);
        }
        try {
            const res = await fetch(apiUrl(id), opts);
            if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
            return await res.json();
        } finally {
            if (timeout !== null) clearTimeout(timeout);
        }
    };

    function close() {
        if (!activeLayer) return false;
        activeToken += 1;
        if (activeController && typeof activeController.abort === 'function') activeController.abort();
        activeController = null;
        const layer = activeLayer;
        activeLayer = null;
        if (layer.parentNode) layer.parentNode.removeChild(layer);
        const focusTarget = returnFocus;
        returnFocus = null;
        if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
        return true;
    }

    function open(id, localData, options) {
        const local = normalizeLocal(id, localData);
        const postId = local.id == null ? id : local.id;
        const key = String(postId);
        close();
        const token = ++activeToken;
        returnFocus = options && options.opener || document.activeElement || null;
        const layer = el('div', 'reader-layer');
        const backdrop = el('button', 'reader-backdrop');
        backdrop.type = 'button';
        backdrop.setAttribute('aria-label', 'close thread');
        backdrop.addEventListener('click', close);
        const sheet = el('section', 'reader-sheet');
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        append(layer, backdrop);
        append(layer, sheet);
        append(findMount(), layer);
        activeLayer = layer;
        renderLoading(sheet, local, postId);
        const markOpen = () => layer.classList.add('reader-open');
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(markOpen);
        else markOpen();
        const closeButton = sheet.querySelector && sheet.querySelector('.reader-close');
        if (closeButton && typeof closeButton.focus === 'function') closeButton.focus();

        const cached = getCache(key);
        idle = (cached ? Promise.resolve(cached) : fetchThread(postId).then((data) => {
            setCache(key, data);
            return data;
        })).then((data) => {
            if (token === activeToken && activeLayer === layer) renderThread(sheet, data, local, postId);
            return data;
        }).catch((_err) => {
            if (token === activeToken && activeLayer === layer) renderOffline(sheet, local, postId);
            return null;
        }).finally(() => {
            if (token === activeToken) activeController = null;
        });
        return idle;
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !activeLayer) return;
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        close();
    }, true);

    window.Reader = {
        open,
        close,
        isOpen: () => !!activeLayer,
        whenIdle: () => idle,
        __cache: cache,
    };
})();
