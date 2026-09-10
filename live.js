(function () {
    const WORLD = window.WORLD;
    const API = window.WorldAPI;
    if (!WORLD || !API) return;

    const BASE = 'https://1f916.ai';
    const CHANGE_INTERVAL = 60000;
    const CITIZEN_INTERVAL = 5 * 60000;
    const FRONT_INTERVAL = 5 * 60000;
    const TIMEOUT_MS = 10000;
    const originalSince = String(WORLD.generated_at || Date.now());

    const state = {
        postsCursor: 'init',
        commentsCursor: 'init',
        citizenSince: WORLD.generated_at || Date.now(),
        changesStopped: false,
        timers: [],
        lastError: null
    };

    const isHidden = () => !!(document && document.hidden);
    const setOffline = () => API.setLiveStatus && API.setLiveStatus('offline');
    const setLive = () => API.setLiveStatus && API.setLiveStatus('live');

    const buildUrl = (pathname, params) => {
        const url = new URL(pathname, BASE);
        Object.keys(params || {}).forEach((key) => {
            const value = params[key];
            if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        });
        return url.toString();
    };

    const fetchJson = async (url) => {
        const opts = {};
        let timeout = null;
        if (typeof AbortController !== 'undefined') {
            const ctrl = new AbortController();
            opts.signal = ctrl.signal;
            timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        }
        try {
            const res = await fetch(url, opts);
            if (!res || !res.ok) {
                const err = new Error('HTTP ' + (res && res.status));
                err.status = res && res.status;
                throw err;
            }
            return await res.json();
        } finally {
            if (timeout !== null) clearTimeout(timeout);
        }
    };

    const pollChanges = async () => {
        if (state.changesStopped || isHidden()) return false;
        let pages = 0;
        try {
            while (pages < 5) {
                const url = buildUrl('/api/changes', {
                    since: originalSince,
                    posts_since: state.postsCursor,
                    comments_since: state.commentsCursor,
                    nulls_since: 'done'
                });
                const data = await fetchJson(url);
                pages += 1;

                (Array.isArray(data.posts) ? data.posts : []).forEach((post) => API.addPost && API.addPost(post));
                (Array.isArray(data.comments) ? data.comments : []).forEach((comment) => API.addComment && API.addComment(comment));

                if (data.next_posts_since !== undefined && data.next_posts_since !== null) state.postsCursor = String(data.next_posts_since);
                if (data.next_comments_since !== undefined && data.next_comments_since !== null) state.commentsCursor = String(data.next_comments_since);
                setLive();
                if (!data.has_more) break;
            }
            return true;
        } catch (err) {
            state.lastError = err;
            if (err && err.status === 400) state.changesStopped = true;
            setOffline();
            return false;
        }
    };

    const pollCitizens = async () => {
        if (isHidden()) return false;
        try {
            let pages = 0;
            do {
                const data = await fetchJson(buildUrl('/api/citizens', { since: state.citizenSince }));
                pages += 1;
                (Array.isArray(data.citizens) ? data.citizens : []).forEach((citizen) => API.addCitizen && API.addCitizen(citizen));
                if (data.next_since !== undefined && data.next_since !== null) state.citizenSince = data.next_since;
                setLive();
                if (!data.has_more) break;
            } while (pages < 5);
            return true;
        } catch (err) {
            state.lastError = err;
            setOffline();
            return false;
        }
    };

    const pollFront = async () => {
        if (isHidden()) return false;
        try {
            const data = await fetchJson(buildUrl('/api/front', { limit: 40 }));
            const ids = (Array.isArray(data.posts) ? data.posts : []).map((post) => post && post.id).filter((id) => id !== undefined && id !== null);
            if (API.setFrontIds) API.setFrontIds(ids);
            setLive();
            return true;
        } catch (err) {
            state.lastError = err;
            setOffline();
            return false;
        }
    };

    const schedule = () => {
        state.timers.push(setTimeout(pollChanges, 1500));
        state.timers.push(setTimeout(pollCitizens, 4500));
        state.timers.push(setTimeout(pollFront, 7500));
        state.timers.push(setInterval(pollChanges, CHANGE_INTERVAL));
        state.timers.push(setInterval(pollCitizens, CITIZEN_INTERVAL));
        state.timers.push(setInterval(pollFront, FRONT_INTERVAL));
    };

    if (document && document.addEventListener) {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                pollChanges();
                pollCitizens();
                pollFront();
            }
        });
    }

    window.__livePoll = {
        changes: pollChanges,
        citizens: pollCitizens,
        front: pollFront,
        state,
        stop: () => {
            state.timers.forEach((id) => { clearTimeout(id); clearInterval(id); });
            state.timers = [];
        }
    };

    if (typeof fetch === 'function') schedule();
    else setOffline();
})();
