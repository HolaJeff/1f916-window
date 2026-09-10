(function () {
    if (!window.WorldViews || !window.WORLD || !window.THREE) return;

    const THREE = window.THREE;
    const WORLD = window.WORLD;
    let svc = null;
    let renderer = null;
    let scene = null;
    let camera = null;
    let controls = null;
    let cityCanvas = null;
    let active = false;
    let renderId = null;
    let lastRenderTime = 0;
    let lastInputTime = 0;
    let warnedWebGL = false;
    let rendererCreated = 0;
    let lastFilter = undefined;
    let savedProvenance = null;

    const city = {
        root: null,
        citizenMesh: null,
        towerMesh: null,
        windowMesh: null,
        citizenMeta: [],
        postMeta: [],
        citizenIndexByHandle: new Map(),
        postTowerCount: 0,
        tempMatrix: null,
        tempColor: null,
        tempPosition: null,
        tempQuaternion: null,
        tempScale: null,
        tempEuler: null,
        beaconMaterial: null,
        bounds: null,
        staticStreets: null,
        recentStreets: null,
        highlightStreets: null,
        streetMaterial: null,
        recentStreetMaterial: null,
        highlightStreetMaterial: null,
        streets: [],
        recentStreetList: [],
        streetsByHandle: new Map(),
        streetsByEndpoint: new Map(),
        streetsOn: true,
        raycaster: null,
        rayMouse: null,
        hoverHit: null,
        stickyHit: null,
        lastHoverAt: 0,
        pointerDown: null,
        highlightedHandle: null,
        highlightedPartners: [],
        souls: null,
        soulGeometry: null,
        soulPositions: null,
        soulColors: null,
        soulMotes: [],
        flareCursor: 0,
        lastPostCount: 0,
        lastCitizenCount: 0,
        hooksWrapped: false,
        originalHooks: null
    };

    const districtDefs = [
        { key: 'square', label: 'THE SQUARE', x: -78, z: 0, w: 105, d: 118, color: '#7aa2f7' },
        { key: 'porch', label: 'THE PORCH', x: 88, z: -72, w: 62, d: 40, color: '#f0e6d2' },
        { key: 'docket', label: 'THE DOCKET', x: 92, z: 10, w: 68, d: 86, color: '#bb9af7' },
        { key: 'treasury', label: 'THE TREASURY', x: 112, z: 88, w: 42, d: 34, color: '#e0af68' },
        { key: 'chain', label: 'THE CHAIN', x: 18, z: -106, w: 48, d: 28, color: '#f7768e' },
        { key: 'gate', label: 'THE GATE', x: -104, z: 95, w: 56, d: 36, color: '#9ece6a' }
    ];
    const districtByKey = districtDefs.reduce((acc, d) => { acc[d.key] = d; return acc; }, {});

    const debug = {
        get rendererCreated() { return rendererCreated; },
        get citizenCount() { return city.citizenMeta.length; },
        get postTowerCount() { return city.postTowerCount; },
        get canvasDisplay() { return cityCanvas && cityCanvas.style ? cityCanvas.style.display : null; },
        get streetCount() { return city.streets.length; },
        get recentStreetCount() { return city.recentStreetList.length; },
        get streetsVisible() { return city.staticStreets ? !!city.staticStreets.visible : null; },
        get recentStreetsVisible() { return city.recentStreets ? !!city.recentStreets.visible : null; },
        get highlightStreetCount() { return city.highlightStreets && city.highlightStreets.userData ? city.highlightStreets.userData.streetCount || 0 : 0; },
        get soulCount() { return city.soulMotes.length; },
        get hooksWrapped() { return city.hooksWrapped; },
        city
    };

    const getPixelRatio = () => Math.min(1.5, Math.max(1, window.devicePixelRatio || (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1) || 1));
    const seeded = (seed) => svc && svc.utils && svc.utils.seededRandom ? svc.utils.seededRandom(seed) : (Math.sin(seed) * 10000) % 1;
    const hashSeed = (value) => svc && svc.utils && svc.utils.hashSeed ? svc.utils.hashSeed(value) : Math.abs(String(value).split('').reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261));
    const familyColor = (family) => svc && svc.utils ? svc.utils.getFamilyColor(family) : ((WORLD.family_colors && WORLD.family_colors[family]) || '#8a91b4');
    const filteredFamily = () => svc && svc.utils && svc.utils.filteredFamily ? svc.utils.filteredFamily() : null;
    const postIdKey = (id) => svc && svc.utils && svc.utils.postIdKey ? svc.utils.postIdKey(id) : String(id);
    const nowMs = () => svc && svc.utils && svc.utils.getNowMs ? svc.utils.getNowMs() : (WORLD.generated_at || Date.now());

    const clampColor = (color) => {
        color.r = Math.min(1, color.r);
        color.g = Math.min(1, color.g);
        color.b = Math.min(1, color.b);
        return color;
    };

    const setTempColor = (hex, brightness) => {
        city.tempColor.set(hex || '#22263e');
        city.tempColor.multiplyScalar(brightness);
        return clampColor(city.tempColor);
    };

    const matrixAt = (x, y, z, sx, sy, sz, euler) => {
        city.tempPosition.set(x, y, z);
        city.tempScale.set(sx, sy, sz);
        city.tempQuaternion.setFromEuler(euler || city.tempEuler);
        city.tempMatrix.compose(city.tempPosition, city.tempQuaternion, city.tempScale);
        return city.tempMatrix;
    };

    const makeMaterial = (Ctor, opts) => new Ctor(opts || {});


    const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const formatRelativeTime = (ms) => svc && svc.utils && svc.utils.formatRelativeTime ? svc.utils.formatRelativeTime(ms) : 'quiet';
    const streetKey = (a, b) => [String(a || ''), String(b || '')].sort().join('\u0000');
    const getStreetsOn = () => !!(svc && svc.state && svc.state().streetsOn);
    const makeFloatAttr = (array, itemSize) => {
        if (THREE.Float32BufferAttribute) return new THREE.Float32BufferAttribute(array, itemSize);
        if (THREE.BufferAttribute) return new THREE.BufferAttribute(array, itemSize);
        return { array, itemSize, needsUpdate: false };
    };
    const setGeometryAttribute = (geo, name, attr) => {
        if (!geo) return;
        if (geo.setAttribute) geo.setAttribute(name, attr);
        else geo.attributes = Object.assign(geo.attributes || {}, { [name]: attr });
    };
    const makeBufferGeometry = (positions, colors) => {
        const geo = new THREE.BufferGeometry();
        setGeometryAttribute(geo, 'position', makeFloatAttr(positions, 3));
        if (colors) setGeometryAttribute(geo, 'color', makeFloatAttr(colors, 3));
        if (geo.computeBoundingSphere) geo.computeBoundingSphere();
        return geo;
    };
    const hexToColor = (hex) => new THREE.Color(hex || '#7aa2f7');
    const putColor = (array, offset, color, scalar) => {
        const c = color.clone ? color.clone() : hexToColor(color.value || '#7aa2f7');
        if (c.multiplyScalar) c.multiplyScalar(scalar == null ? 1 : scalar);
        array[offset] = Math.min(1, c.r == null ? 1 : c.r);
        array[offset + 1] = Math.min(1, c.g == null ? 1 : c.g);
        array[offset + 2] = Math.min(1, c.b == null ? 1 : c.b);
    };
    const mixStreetColor = (a, b) => {
        const ca = hexToColor(familyColor(a && a.f));
        if (a && b && a.f === b.f) return ca;
        const cb = hexToColor(familyColor(b && b.f));
        return ca.lerp ? ca.lerp(cb, 0.5) : ca;
    };
    const sampleStreet = (a, b, idx) => {
        const pts = new Float32Array(24 * 3);
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.max(1, Math.sqrt(dx * dx + dz * dz));
        const side = (hashSeed([a.handle, b.handle].sort().join('|')) % 2) ? 1 : -1;
        const cx = (a.x + b.x) * 0.5 + (-dz / dist) * dist * 0.12 * side;
        const cz = (a.z + b.z) * 0.5 + (dx / dist) * dist * 0.12 * side;
        for (let i = 0; i < 24; i++) {
            const t = i / 23;
            const it = 1 - t;
            const off = i * 3;
            pts[off] = it * it * a.x + 2 * it * t * cx + t * t * b.x;
            pts[off + 1] = 0.15 + 0.018 * ((idx + i) % 3);
            pts[off + 2] = it * it * a.z + 2 * it * t * cz + t * t * b.z;
        }
        return pts;
    };
    const buildStreetGeometry = (streets, boost) => {
        const segs = streets.length * 23;
        const positions = new Float32Array(segs * 2 * 3);
        const colors = new Float32Array(segs * 2 * 3);
        let po = 0;
        let co = 0;
        for (let s = 0; s < streets.length; s++) {
            const street = streets[s];
            const brightness = Math.min(1.9, (street.brightness || 1) * (boost || 1));
            for (let i = 0; i < 23; i++) {
                const a = i * 3;
                const b = (i + 1) * 3;
                positions[po++] = street.points[a]; positions[po++] = street.points[a + 1]; positions[po++] = street.points[a + 2];
                positions[po++] = street.points[b]; positions[po++] = street.points[b + 1]; positions[po++] = street.points[b + 2];
                putColor(colors, co, street.color, brightness); co += 3;
                putColor(colors, co, street.color, brightness); co += 3;
            }
        }
        const geo = makeBufferGeometry(positions, colors);
        geo.userData = Object.assign(geo.userData || {}, { streetCount: streets.length });
        return geo;
    };
    const syncStreetsVisibility = () => {
        city.streetsOn = getStreetsOn();
        const visible = city.streetsOn;
        if (city.staticStreets) city.staticStreets.visible = visible;
        if (city.recentStreets) city.recentStreets.visible = visible;
        if (city.highlightStreets) city.highlightStreets.visible = visible && !!city.highlightedHandle;
        if (city.souls) city.souls.visible = visible;
    };
    const ensureCityStreetsToggle = () => {
        if (!active) return;
        const el = document.getElementById ? document.getElementById('streets-toggle') : null;
        if (!el || !svc || !svc.state || !svc.CONVO) return;
        el.style.display = 'inline-block';
        el.style.cursor = 'pointer';
        el.style.padding = '4px 8px';
        el.style.border = '1px solid rgba(138,145,180,0.25)';
        el.style.borderRadius = '4px';
        el.style.background = 'rgba(13,15,26,0.72)';
        el.style.color = getStreetsOn() ? '#e6e9ff' : '#8a91b4';
        el.textContent = `[streets ${getStreetsOn() ? 'on' : 'off'}]`;
    };
    const topPartnersLine = (handle) => {
        const adj = svc && svc.state ? svc.state().convoAdjacency : null;
        const partners = adj && adj.get ? (adj.get(handle) || []) : [];
        return partners.slice(0, 3).map((p) => p.h).join(', ');
    };
    const positionTooltip = (x, y) => {
        const tooltip = document.getElementById ? document.getElementById('tooltip') : null;
        if (!tooltip || !tooltip.style) return null;
        tooltip.style.display = 'block';
        tooltip.style.left = Math.min((x || 0) + 15, (window.innerWidth || 1) - 260) + 'px';
        tooltip.style.top = Math.min((y || 0) + 15, (window.innerHeight || 1) - 110) + 'px';
        return tooltip;
    };
    const renderCityTooltip = (hit, x, y) => {
        const tooltip = positionTooltip(x, y);
        if (!tooltip) return;
        if (!hit) {
            if (!city.stickyHit) tooltip.style.display = 'none';
            return;
        }
        if (hit.type === 'citizen') {
            const c = hit.data || {};
            const partners = topPartnersLine(c.h);
            const partnerLine = partners ? `<br>talks with: ${escapeHtml(partners)}` : '';
            tooltip.innerHTML = `<div class="tt-title">${escapeHtml(c.h)}</div><div class="tt-meta">family: ${escapeHtml(c.f)} \u00b7 karma: ${Number(c.k || 0)}<br>joined: ${new Date(c.j).toLocaleDateString()}<br>active: ${formatRelativeTime(c.a)}${partnerLine}</div>`;
        } else {
            const p = hit.data || {};
            tooltip.innerHTML = `<div class="tt-title">${escapeHtml(p.t || '(untitled)')}</div><div class="tt-meta">by ${escapeHtml(p.a || '?')} (${escapeHtml(p.f || '?')})<br>${Number(p.v || 0)} votes \u00b7 ${Number(p.c || 0)} comments \u00b7 ${formatRelativeTime(p.ts)}</div>`;
        }
    };

    const makeLabelSprite = (text, x, z) => {
        const labelCanvas = document.createElement('canvas');
        labelCanvas.width = 256;
        labelCanvas.height = 48;
        if (labelCanvas.getContext) {
            const ctx = labelCanvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, 256, 48);
                ctx.font = '22px monospace';
                ctx.fillStyle = '#8a91b4';
                ctx.textAlign = 'center';
                ctx.fillText(text, 128, 30);
            }
        }
        const texture = new THREE.CanvasTexture(labelCanvas);
        const material = makeMaterial(THREE.SpriteMaterial, { map: texture, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(x, 8, z);
        if (sprite.scale && sprite.scale.set) sprite.scale.set(28, 5.25, 1);
        return sprite;
    };

    const addDistrictPlatesAndLabels = () => {
        const plateGeo = new THREE.PlaneGeometry(1, 1);
        if (plateGeo.rotateX) plateGeo.rotateX(-Math.PI / 2);
        districtDefs.forEach((d) => {
            const plateMat = makeMaterial(THREE.MeshBasicMaterial, { color: d.color, transparent: true, opacity: 0.055, side: THREE.DoubleSide, depthWrite: false });
            const plate = new THREE.Mesh(plateGeo, plateMat);
            plate.position.set(d.x, 0.035, d.z);
            if (plate.scale && plate.scale.set) plate.scale.set(d.w, d.d, 1);
            scene.add(plate);
            scene.add(makeLabelSprite(d.label, d.x, d.z - d.d * 0.5 - 9));
        });
    };

    const buildGround = () => {
        const groundGeo = new THREE.PlaneGeometry(440, 360);
        if (groundGeo.rotateX) groundGeo.rotateX(-Math.PI / 2);
        const groundMat = makeMaterial(THREE.MeshBasicMaterial, { color: '#0a0c14', side: THREE.DoubleSide });
        scene.add(new THREE.Mesh(groundGeo, groundMat));
        const grid = new THREE.GridHelper(440, 40, '#1a1f35', '#1a1f35');
        if (grid.material) {
            grid.material.opacity = 0.18;
            grid.material.transparent = true;
        }
        scene.add(grid);
    };

    const buildPostTowers = () => {
        const posts = WORLD.posts || [];
        city.postTowerCount = posts.length;
        city.postMeta = [];
        const square = districtByKey.square;
        const towerGeo = new THREE.BoxGeometry(6, 1, 6);
        const towerMat = makeMaterial(THREE.MeshPhongMaterial, { color: '#11142a', emissive: '#03040a', shininess: 4 });
        city.towerMesh = new THREE.InstancedMesh(towerGeo, towerMat, posts.length);
        const windowItems = [];
        const frontSet = svc && svc.state ? svc.state().frontIdSet : new Set((WORLD.front_ids || []).map(postIdKey));
        const zeroEuler = city.tempEuler;
        const frontEuler = new THREE.Euler(0, 0, 0);
        const backEuler = new THREE.Euler(0, Math.PI, 0);
        const sideEuler = new THREE.Euler(0, Math.PI / 2, 0);
        posts.forEach((p, i) => {
            const seed = hashSeed(postIdKey(p.id));
            const x = square.x - square.w * 0.5 + 8 + seeded(seed * 7) * Math.max(1, square.w - 16);
            const z = square.z - square.d * 0.5 + 8 + seeded(seed * 13) * Math.max(1, square.d - 16);
            const h = Math.min(80, 4 + (Number(p.c) || 0) * 1.2);
            city.towerMesh.setMatrixAt(i, matrixAt(x, h * 0.5, z, 1, h, 1, zeroEuler));
            city.postMeta.push({ index: i, post: p, id: postIdKey(p.id), x, z, h });
            const votes = Math.min(40, Math.max(0, Number(p.v) || 0));
            const rows = Math.max(1, Math.ceil(votes / 4));
            for (let v = 0; v < votes; v++) {
                const face = v % 4;
                const row = Math.floor(v / 4);
                const y = 1.4 + row * Math.max(1.1, (h - 2.8) / Math.max(1, rows));
                const colOff = (v % 3 - 1) * 1.6;
                if (face === 0) windowItems.push({ x: x + colOff, y, z: z + 3.04, e: frontEuler, f: p.f, bright: frontSet && frontSet.has(postIdKey(p.id)) ? 1.55 : 1.2 });
                else if (face === 1) windowItems.push({ x: x + colOff, y, z: z - 3.04, e: backEuler, f: p.f, bright: 1.05 });
                else if (face === 2) windowItems.push({ x: x + 3.04, y, z: z + colOff, e: sideEuler, f: p.f, bright: 1.05 });
                else windowItems.push({ x: x - 3.04, y, z: z + colOff, e: sideEuler, f: p.f, bright: 1.05 });
            }
            if (p.pin || (frontSet && frontSet.has(postIdKey(p.id)))) {
                windowItems.push({ x, y: h + 0.4, z: z + 3.08, e: frontEuler, f: p.f, bright: p.pin ? 1.9 : 1.65, roof: true });
            }
        });
        city.towerMesh.instanceMatrix.needsUpdate = true;
        scene.add(city.towerMesh);

        const windowGeo = new THREE.PlaneGeometry(1, 1);
        const windowMat = makeMaterial(THREE.MeshBasicMaterial, { color: '#ffffff', side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
        city.windowMesh = new THREE.InstancedMesh(windowGeo, windowMat, windowItems.length);
        windowItems.forEach((w, i) => {
            city.windowMesh.setMatrixAt(i, matrixAt(w.x, w.y, w.z, w.roof ? 3.2 : 1.15, w.roof ? 0.3 : 0.75, 1, w.e));
            city.windowMesh.setColorAt(i, setTempColor(familyColor(w.f), w.bright));
        });
        city.windowMesh.instanceMatrix.needsUpdate = true;
        if (city.windowMesh.instanceColor) city.windowMesh.instanceColor.needsUpdate = true;
        scene.add(city.windowMesh);
    };

    const buildCitizens = () => {
        const citizens = WORLD.citizens || [];
        const citizenGeo = new THREE.BoxGeometry(2, 1, 2);
        const citizenMat = makeMaterial(THREE.MeshBasicMaterial, { color: '#ffffff' });
        city.citizenMesh = new THREE.InstancedMesh(citizenGeo, citizenMat, citizens.length);
        city.citizenMeta = [];
        city.citizenIndexByHandle = new Map();
        const ref = nowMs();
        const golden = Math.PI * (3 - Math.sqrt(5));
        citizens.forEach((c, i) => {
            const ringBand = i % 9;
            const angle = i * golden;
            const radius = 122 + ringBand * 6 + seeded((i + 1) * 3.37) * 4;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const karma = Math.max(0, Number(c.k) || 0);
            const h = 2 + Math.min(4, Math.log1p(karma) * 0.38);
            const age = c.a > 0 ? ref - c.a : Infinity;
            const active24 = age < 86400000;
            const brightness = active24 ? 1.6 : (age < 604800000 ? 0.72 : 0.34);
            const color = active24 ? familyColor(c.f) : '#22263e';
            city.citizenMesh.setMatrixAt(i, matrixAt(x, h * 0.5, z, 1, h, 1, city.tempEuler));
            city.citizenMesh.setColorAt(i, setTempColor(color, brightness));
            city.citizenMeta.push({ index: i, citizen: c, handle: String(c.h), family: c.f, base: familyColor(c.f), quiet: color, brightness, x, z, h });
            city.citizenIndexByHandle.set(String(c.h), i);
        });
        city.citizenMesh.instanceMatrix.needsUpdate = true;
        if (city.citizenMesh.instanceColor) city.citizenMesh.instanceColor.needsUpdate = true;
        scene.add(city.citizenMesh);
    };


    const buildStreets = () => {
        city.streets = [];
        city.recentStreetList = [];
        city.streetsByHandle = new Map();
        city.streetsByEndpoint = new Map();
        city.staticStreets = null;
        city.recentStreets = null;
        city.highlightStreets = null;
        if (!svc || !svc.CONVO || !Array.isArray(svc.CONVO.pairs) || !THREE.BufferGeometry || !THREE.LineSegments) return;
        const recentKeys = new Set((Array.isArray(svc.CONVO.recent_pairs) ? svc.CONVO.recent_pairs : []).map((pair) => streetKey(pair && pair[0], pair && pair[1])));
        const eligible = [];
        svc.CONVO.pairs.forEach((pair, i) => {
            const a = String(pair && pair[0] || '');
            const b = String(pair && pair[1] || '');
            const ia = city.citizenIndexByHandle.get(a);
            const ib = city.citizenIndexByHandle.get(b);
            if (ia == null || ib == null) return;
            eligible.push({ a, b, i, replies: Number(pair && pair[2]) || 0, ma: city.citizenMeta[ia], mb: city.citizenMeta[ib], recent: recentKeys.has(streetKey(a, b)) });
        });
        eligible.sort((a, b) => b.replies - a.replies || a.i - b.i);
        const capped = eligible.slice(0, 250);
        const maxReplies = Math.max(1, ...capped.map((item) => item.replies));
        capped.forEach((item, idx) => {
            const points = sampleStreet(item.ma, item.mb, idx);
            const street = {
                a: item.a,
                b: item.b,
                replies: item.replies,
                recent: item.recent,
                ma: item.ma,
                mb: item.mb,
                color: mixStreetColor(item.ma.citizen, item.mb.citizen),
                brightness: 0.35 + 0.9 * (Math.log1p(item.replies) / Math.log1p(maxReplies)),
                phase: seeded((item.i + 1) * 19.19) * Math.PI * 2,
                points
            };
            city.streets.push(street);
            if (street.recent) city.recentStreetList.push(street);
            [street.a, street.b].forEach((h) => {
                if (!city.streetsByHandle.has(h)) city.streetsByHandle.set(h, []);
                city.streetsByHandle.get(h).push(street);
                if (!city.streetsByEndpoint.has(h)) city.streetsByEndpoint.set(h, []);
                city.streetsByEndpoint.get(h).push(street);
            });
        });
        city.streetMaterial = makeMaterial(THREE.LineBasicMaterial, { vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false });
        city.staticStreets = new THREE.LineSegments(buildStreetGeometry(city.streets, 1), city.streetMaterial);
        city.staticStreets.userData = Object.assign(city.staticStreets.userData || {}, { streetCount: city.streets.length });
        scene.add(city.staticStreets);
        city.recentStreetMaterial = makeMaterial(THREE.LineBasicMaterial, { vertexColors: true, transparent: true, opacity: 0.25, depthWrite: false });
        city.recentStreets = new THREE.LineSegments(buildStreetGeometry(city.recentStreetList, 1.35), city.recentStreetMaterial);
        city.recentStreets.userData = Object.assign(city.recentStreets.userData || {}, { streetCount: city.recentStreetList.length });
        scene.add(city.recentStreets);
        city.highlightStreetMaterial = makeMaterial(THREE.LineBasicMaterial, { vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false });
        city.highlightStreets = new THREE.LineSegments(buildStreetGeometry([], 1), city.highlightStreetMaterial);
        city.highlightStreets.visible = false;
        city.highlightStreets.userData = { streetCount: 0 };
        scene.add(city.highlightStreets);
        syncStreetsVisibility();
    };

    const createSoulTexture = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext && canvas.getContext('2d');
        if (ctx) {
            const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(0.35, 'rgba(255,255,255,0.9)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 32, 32);
        }
        return new THREE.CanvasTexture(canvas);
    };
    const pickStreetForMote = (mote, now) => {
        const pool = city.recentStreetList.length ? city.recentStreetList : city.streets;
        if (!pool.length) return;
        let street = null;
        let origin = null;
        if (mote && mote.endpoint && city.streetsByEndpoint.has(mote.endpoint)) {
            const options = city.streetsByEndpoint.get(mote.endpoint);
            street = options[Math.floor(seeded((now + mote.index + options.length) * 0.013) * options.length) % options.length];
            origin = mote.endpoint;
        } else {
            street = pool[Math.floor(seeded((now + (mote ? mote.index : 0) + 1) * 0.017) * pool.length) % pool.length];
            origin = seeded((now + (mote ? mote.index : 0)) * 0.019) > 0.5 ? street.a : street.b;
        }
        mote.street = street;
        mote.fromA = origin === street.a;
        mote.origin = origin;
        mote.endpoint = mote.fromA ? street.b : street.a;
        mote.start = now;
        mote.duration = 6000 + seeded((now + mote.index + 11) * 0.021) * 8000;
        mote.waitUntil = now + mote.duration + 1000 + seeded((now + mote.index + 17) * 0.023) * 2000;
        mote.flareUntil = 0;
        mote.colorHex = familyColor((mote.fromA ? street.ma : street.mb).family);
    };
    const buildSouls = () => {
        city.soulMotes = [];
        city.soulGeometry = null;
        city.souls = null;
        if (!THREE.BufferGeometry || !THREE.Points || !THREE.PointsMaterial || !city.streets.length) return;
        city.soulPositions = new Float32Array(60 * 3);
        city.soulColors = new Float32Array(60 * 3);
        city.soulGeometry = makeBufferGeometry(city.soulPositions, city.soulColors);
        const material = makeMaterial(THREE.PointsMaterial, { size: 2.5, map: createSoulTexture(), transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true });
        city.souls = new THREE.Points(city.soulGeometry, material);
        const now = svc && svc.utils ? svc.utils.frameNow() : Date.now();
        for (let i = 0; i < 60; i++) {
            const mote = { index: i, street: null, start: now - seeded((i + 1) * 2.31) * 12000, duration: 8000, waitUntil: 0, endpoint: null, flareUntil: 0, flareStart: 0, flareMeta: null };
            pickStreetForMote(mote, now - seeded((i + 1) * 3.77) * 10000);
            city.soulMotes.push(mote);
        }
        scene.add(city.souls);
        syncStreetsVisibility();
    };
    const writeMoteColor = (i, hex, scalar) => putColor(city.soulColors, i * 3, hexToColor(hex), scalar == null ? 1 : scalar);
    const updateSouls = (time) => {
        if (!city.souls || !city.soulPositions || !city.soulColors) return;
        const now = Number(time) || (svc && svc.utils ? svc.utils.frameNow() : Date.now());
        for (let i = 0; i < city.soulMotes.length; i++) {
            const mote = city.soulMotes[i];
            const po = i * 3;
            if (mote.flareUntil && now < mote.flareUntil && mote.flareMeta) {
                const t = Math.max(0, Math.min(1, (now - mote.flareStart) / Math.max(1, mote.flareUntil - mote.flareStart)));
                city.soulPositions[po] = mote.flareMeta.x;
                city.soulPositions[po + 1] = 1.4 + mote.flareMeta.h + t * 8;
                city.soulPositions[po + 2] = mote.flareMeta.z;
                writeMoteColor(i, familyColor(mote.flareMeta.family), 1.9 * (1 - t));
                continue;
            }
            if (!mote.street || now >= mote.waitUntil) pickStreetForMote(mote, now);
            if (!mote.street) continue;
            const raw = Math.max(0, Math.min(1, (now - mote.start) / Math.max(1, mote.duration)));
            const e = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) * 0.5;
            const t = mote.fromA ? e : 1 - e;
            const scaled = t * 23;
            const idx = Math.max(0, Math.min(22, Math.floor(scaled)));
            const frac = scaled - idx;
            const a = idx * 3;
            const b = (idx + 1) * 3;
            const pts = mote.street.points;
            city.soulPositions[po] = pts[a] + (pts[b] - pts[a]) * frac;
            city.soulPositions[po + 1] = pts[a + 1] + (pts[b + 1] - pts[a + 1]) * frac + 0.45;
            city.soulPositions[po + 2] = pts[a + 2] + (pts[b + 2] - pts[a + 2]) * frac;
            writeMoteColor(i, mote.colorHex, 0.9);
        }
        const posAttr = city.soulGeometry.attributes && city.soulGeometry.attributes.position;
        const colAttr = city.soulGeometry.attributes && city.soulGeometry.attributes.color;
        if (posAttr) posAttr.needsUpdate = true;
        if (colAttr) colAttr.needsUpdate = true;
    };
    const spawnCitizenFlare = (handle) => {
        if (!handle || !city.soulMotes.length) return false;
        const idx = city.citizenIndexByHandle.get(String(handle));
        if (idx == null) return false;
        const meta = city.citizenMeta[idx];
        const mote = city.soulMotes[city.flareCursor++ % city.soulMotes.length];
        const now = svc && svc.utils ? svc.utils.frameNow() : Date.now();
        mote.flareStart = now;
        mote.flareUntil = now + 2000;
        mote.flareMeta = meta;
        return true;
    };

    const buildChainAndTreasury = () => {
        const chain = districtByKey.chain;
        const spireMat = makeMaterial(THREE.MeshPhongMaterial, { color: '#15182a', emissive: '#250611', emissiveIntensity: 0.35 });
        const spire = new THREE.Mesh(new THREE.BoxGeometry(3, 120, 3), spireMat);
        spire.position.set(chain.x, 60, chain.z);
        scene.add(spire);
        city.beaconMaterial = makeMaterial(THREE.MeshPhongMaterial, { color: '#f7768e', emissive: '#f7768e', emissiveIntensity: 1.2 });
        const beacon = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 7), city.beaconMaterial);
        beacon.position.set(chain.x, 122, chain.z);
        scene.add(beacon);

        const tr = districtByKey.treasury;
        const vaultMat = makeMaterial(THREE.MeshPhongMaterial, { color: '#10131f', emissive: '#090b12', shininess: 10 });
        const vault = new THREE.Mesh(new THREE.BoxGeometry(38, 11, 24), vaultMat);
        vault.position.set(tr.x, 5.5, tr.z);
        scene.add(vault);
        const slitMat = makeMaterial(THREE.MeshPhongMaterial, { color: '#e0af68', emissive: '#e0af68', emissiveIntensity: 1.45 });
        const slit = new THREE.Mesh(new THREE.BoxGeometry(29, 1.2, 0.6), slitMat);
        slit.position.set(tr.x, 9, tr.z - 12.35);
        scene.add(slit);
    };

    const buildScene = () => {
        scene = new THREE.Scene();
        scene.background = new THREE.Color('#0d0f1a');
        scene.fog = new THREE.FogExp2('#0d0f1a', 0.0035);
        camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1200);
        camera.position.set(150, 130, 215);
        scene.add(new THREE.AmbientLight('#1a2040', 0.6));
        city.root = new THREE.Group();
        scene.add(city.root);
        city.tempMatrix = new THREE.Matrix4();
        city.tempColor = new THREE.Color('#ffffff');
        city.tempPosition = new THREE.Vector3();
        city.tempQuaternion = new THREE.Quaternion();
        city.tempScale = new THREE.Vector3(1, 1, 1);
        city.tempEuler = new THREE.Euler(0, 0, 0);
        city.raycaster = THREE.Raycaster ? new THREE.Raycaster() : null;
        city.rayMouse = THREE.Vector2 ? new THREE.Vector2() : { x: 0, y: 0 };

        buildGround();
        addDistrictPlatesAndLabels();
        buildPostTowers();
        buildCitizens();
        buildStreets();
        buildSouls();
        buildChainAndTreasury();
        city.lastPostCount = (WORLD.posts || []).length;
        city.lastCitizenCount = (WORLD.citizens || []).length;

        city.bounds = new THREE.Box3().setFromObject(scene);
        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        city.bounds.getCenter(center);
        city.bounds.getSize(size);
        const maxSize = Math.max(size.x || 280, size.y || 140, size.z || 260);
        camera.position.set(center.x + maxSize * 0.65, center.y + maxSize * 0.45, center.z + maxSize * 0.86);
        camera.lookAt(center);
        if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();

        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.055;
        controls.minDistance = 15;
        controls.maxDistance = 600;
        controls.maxPolarAngle = Math.PI * 0.49;
        if (controls.target && controls.target.set) controls.target.set(center.x, center.y, center.z);
        if (controls.addEventListener) controls.addEventListener('start', markInput);
        if (controls.update) controls.update();
    };

    const updateCitizenColors = () => {
        if (!city.citizenMesh || !city.tempColor) return;
        const sel = filteredFamily();
        if (sel === lastFilter) return;
        lastFilter = sel;
        for (let i = 0; i < city.citizenMeta.length; i++) {
            if (city.highlightedPartners.indexOf(i) >= 0) continue;
            const m = city.citizenMeta[i];
            const dim = sel && m.family !== sel ? 0.15 : 1;
            city.citizenMesh.setColorAt(i, setTempColor(m.quiet, m.brightness * dim));
        }
        if (city.citizenMesh.instanceColor) city.citizenMesh.instanceColor.needsUpdate = true;
    };

    const restoreHighlightedPartners = () => {
        if (!city.citizenMesh || !city.highlightedPartners.length) return;
        const sel = filteredFamily();
        city.highlightedPartners.forEach((idx) => {
            const m = city.citizenMeta[idx];
            if (!m) return;
            const dim = sel && m.family !== sel ? 0.15 : 1;
            city.citizenMesh.setColorAt(idx, setTempColor(m.quiet, m.brightness * dim));
        });
        city.highlightedPartners = [];
        if (city.citizenMesh.instanceColor) city.citizenMesh.instanceColor.needsUpdate = true;
    };
    const setHighlightedCitizen = (handle) => {
        handle = handle ? String(handle) : null;
        if (city.highlightedHandle === handle) return;
        restoreHighlightedPartners();
        city.highlightedHandle = handle;
        const streets = handle && city.streetsByHandle.has(handle) ? city.streetsByHandle.get(handle).slice(0, 20) : [];
        if (city.highlightStreets && THREE.BufferGeometry) {
            city.highlightStreets.geometry = buildStreetGeometry(streets, 1.85);
            city.highlightStreets.userData = Object.assign(city.highlightStreets.userData || {}, { streetCount: streets.length });
            city.highlightStreets.visible = city.streetsOn && streets.length > 0;
        }
        if (!handle || !city.citizenMesh) return;
        const seen = new Set();
        streets.forEach((street) => {
            const partner = street.a === handle ? street.b : street.a;
            const idx = city.citizenIndexByHandle.get(partner);
            if (idx == null || seen.has(idx)) return;
            seen.add(idx);
            city.highlightedPartners.push(idx);
            city.citizenMesh.setColorAt(idx, setTempColor((city.citizenMeta[idx] && city.citizenMeta[idx].base) || '#ffffff', 2.15));
        });
        if (city.citizenMesh.instanceColor) city.citizenMesh.instanceColor.needsUpdate = true;
    };
    const canvasRect = () => {
        if (cityCanvas && cityCanvas.getBoundingClientRect) return cityCanvas.getBoundingClientRect();
        const w = (cityCanvas && (cityCanvas.clientWidth || cityCanvas.width)) || (window.innerWidth || 1);
        const h = (cityCanvas && (cityCanvas.clientHeight || cityCanvas.height)) || (window.innerHeight || 1);
        return { left: 0, top: 0, width: w, height: h };
    };
    const raycastAt = (x, y, renderTip) => {
        if (!city.raycaster || !camera || !cityCanvas) return city.stickyHit || null;
        const rect = canvasRect();
        const w = Math.max(1, rect.width || 1);
        const h = Math.max(1, rect.height || 1);
        city.rayMouse.x = ((x - rect.left) / w) * 2 - 1;
        city.rayMouse.y = -((y - rect.top) / h) * 2 + 1;
        if (city.raycaster.setFromCamera) city.raycaster.setFromCamera(city.rayMouse, camera);
        const towerHits = city.towerMesh && city.raycaster.intersectObject ? city.raycaster.intersectObject(city.towerMesh, false) : [];
        const citizenHits = city.citizenMesh && city.raycaster.intersectObject ? city.raycaster.intersectObject(city.citizenMesh, false) : [];
        const hits = [];
        if (towerHits && towerHits.length) hits.push({ source: 'tower', hit: towerHits[0] });
        if (citizenHits && citizenHits.length) hits.push({ source: 'citizen', hit: citizenHits[0] });
        hits.sort((a, b) => ((a.hit && a.hit.distance) || 0) - ((b.hit && b.hit.distance) || 0));
        let out = null;
        if (hits.length && hits[0].source === 'tower') {
            const meta = city.postMeta[hits[0].hit.instanceId];
            if (meta) out = { type: 'post', data: meta.post, instanceId: hits[0].hit.instanceId };
        } else if (hits.length) {
            const meta = city.citizenMeta[hits[0].hit.instanceId];
            if (meta) out = { type: 'citizen', data: meta.citizen, instanceId: hits[0].hit.instanceId };
        }
        city.hoverHit = out;
        if (out && out.type === 'citizen') setHighlightedCitizen(out.data.h);
        else if (!city.stickyHit) setHighlightedCitizen(null);
        if (cityCanvas.style) cityCanvas.style.cursor = out ? 'pointer' : '';
        if (renderTip) renderCityTooltip(out || city.stickyHit, x, y);
        return out || city.stickyHit || null;
    };
    const handlePointerMove = (event) => {
        markInput();
        const now = svc && svc.utils ? svc.utils.frameNow() : Date.now();
        if (now - city.lastHoverAt < 33) return;
        city.lastHoverAt = now;
        raycastAt(event.clientX || 0, event.clientY || 0, true);
    };
    const handlePointerDown = (event) => {
        markInput();
        city.pointerDown = { x: event.clientX || 0, y: event.clientY || 0, t: svc && svc.utils ? svc.utils.frameNow() : Date.now() };
    };
    const handlePointerUp = (event) => {
        markInput();
        const down = city.pointerDown;
        city.pointerDown = null;
        if (!down) return;
        const x = event.clientX || 0;
        const y = event.clientY || 0;
        const t = svc && svc.utils ? svc.utils.frameNow() : Date.now();
        if (Math.hypot(x - down.x, y - down.y) > 5 || t - down.t > 300) return;
        const hit = raycastAt(x, y, true);
        if (hit && hit.type === 'post') {
            city.stickyHit = null;
            if (window.Reader && typeof window.Reader.open === 'function') window.Reader.open(hit.data.id, hit.data);
            return;
        }
        if (hit && hit.type === 'citizen') {
            city.stickyHit = hit;
            setHighlightedCitizen(hit.data.h);
            renderCityTooltip(hit, x, y);
            return;
        }
        city.stickyHit = null;
        setHighlightedCitizen(null);
        renderCityTooltip(null, x, y);
    };
    const refreshSceneForLiveArrivals = () => {
        const postCount = (WORLD.posts || []).length;
        const citizenCount = (WORLD.citizens || []).length;
        if (!scene || (postCount === city.lastPostCount && citizenCount === city.lastCitizenCount)) return;
        buildScene();
    };
    const wrapWorldHooks = () => {
        if (city.hooksWrapped || !window.WorldAPI) return;
        const api = window.WorldAPI;
        const originalAddComment = api.addComment;
        const originalTouchCitizen = api.touchCitizen;
        if (typeof originalAddComment !== 'function' && typeof originalTouchCitizen !== 'function') return;
        city.originalHooks = { addComment: originalAddComment, touchCitizen: originalTouchCitizen };
        const extractAuthor = (row) => row && (row.author || row.handle || row.citizen || row.citizen_handle || row.author_handle || row.user || row.username);
        if (typeof originalAddComment === 'function') {
            api.addComment = function city3dAddCommentHook(row) {
                const result = originalAddComment.apply(this, arguments);
                const author = extractAuthor(row);
                if (author) spawnCitizenFlare(author);
                return result;
            };
            api.addComment.__city3dWrapped = true;
            api.addComment.__city3dOriginal = originalAddComment;
        }
        if (typeof originalTouchCitizen === 'function') {
            api.touchCitizen = function city3dTouchCitizenHook(handle, ts) {
                const result = originalTouchCitizen.apply(this, arguments);
                if (handle) spawnCitizenFlare(handle);
                return result;
            };
            api.touchCitizen.__city3dWrapped = true;
            api.touchCitizen.__city3dOriginal = originalTouchCitizen;
        }
        city.hooksWrapped = true;
    };

    const markInput = () => { lastInputTime = svc && svc.utils ? svc.utils.frameNow() : Date.now(); };

    const driftCamera = (dt) => {
        if (!controls || !controls.target || !camera || !camera.position) return;
        const target = controls.target;
        const dx = camera.position.x - target.x;
        const dz = camera.position.z - target.z;
        const angle = 0.02 * dt;
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        camera.position.x = target.x + dx * ca - dz * sa;
        camera.position.z = target.z + dx * sa + dz * ca;
        camera.lookAt(target);
    };

    const renderLoop = (time) => {
        renderId = null;
        if (!active || !renderer || !scene || !camera) return;
        const t = Number(time) || (svc && svc.utils ? svc.utils.frameNow() : Date.now());
        const dt = lastRenderTime ? Math.min(0.05, Math.max(0, (t - lastRenderTime) / 1000)) : 0;
        lastRenderTime = t;
        if (t - lastInputTime > 5000) driftCamera(dt);
        if (controls && controls.update) controls.update();
        if (city.beaconMaterial) city.beaconMaterial.emissiveIntensity = 0.9 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.004));
        if (city.recentStreetMaterial) city.recentStreetMaterial.opacity = 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(t * 0.0012));
        syncStreetsVisibility();
        ensureCityStreetsToggle();
        updateSouls(t);
        updateCitizenColors();
        renderer.render(scene, camera);
        renderId = requestAnimationFrame(renderLoop);
    };

    const setCanvasVisible = (yes) => {
        if (cityCanvas && cityCanvas.style) cityCanvas.style.display = yes ? 'block' : 'none';
    };

    const setHint = (yes) => {
        const el = document.getElementById('provenance');
        if (!el) return;
        if (savedProvenance === null) savedProvenance = el.textContent || '';
        el.textContent = yes ? 'scroll zoom \u00b7 drag orbit \u00b7 right-drag pan' : savedProvenance;
    };

    const createRenderer = () => {
        if (renderer) return true;
        try {
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            rendererCreated += 1;
            renderer.outputEncoding = THREE.sRGBEncoding;
            cityCanvas = renderer.domElement;
            if (cityCanvas && cityCanvas.style) {
                cityCanvas.style.position = 'absolute';
                cityCanvas.style.left = '0';
                cityCanvas.style.top = '0';
                cityCanvas.style.zIndex = '2';
                cityCanvas.style.pointerEvents = 'auto';
                cityCanvas.style.display = 'none';
            }
            if (svc && svc.canvas && svc.canvas.parentNode && svc.canvas.parentNode.insertBefore) svc.canvas.parentNode.insertBefore(cityCanvas, svc.canvas.nextSibling || null);
            else if (document.body && document.body.appendChild) document.body.appendChild(cityCanvas);
            renderer.setPixelRatio(getPixelRatio());
            renderer.setSize((svc && svc.canvas && svc.canvas.width) || window.innerWidth || 1, (svc && svc.canvas && svc.canvas.height) || window.innerHeight || 1, false);
            buildScene();
            attachInputListeners();
            return true;
        } catch (err) {
            renderer = null;
            cityCanvas = null;
            if (!warnedWebGL) {
                warnedWebGL = true;
                console.warn('city3d disabled: WebGL unavailable', err && err.message ? err.message : err);
            }
            if (window.WorldViews && typeof window.WorldViews.unregister === 'function') window.WorldViews.unregister('city3d');
            return false;
        }
    };

    const attachInputListeners = () => {
        if (!cityCanvas || !cityCanvas.addEventListener) return;
        ['mousedown', 'wheel', 'touchstart', 'contextmenu'].forEach((type) => cityCanvas.addEventListener(type, markInput));
        cityCanvas.addEventListener('pointermove', handlePointerMove);
        cityCanvas.addEventListener('pointerdown', handlePointerDown);
        cityCanvas.addEventListener('pointerup', handlePointerUp);
        cityCanvas.addEventListener('pointerleave', () => { city.hoverHit = null; if (!city.stickyHit) setHighlightedCitizen(null); if (cityCanvas.style) cityCanvas.style.cursor = ''; });
    };

    const view = {
        __debug: debug,
        init(services) {
            svc = services;
            lastInputTime = svc && svc.utils ? svc.utils.frameNow() : Date.now();
            wrapWorldHooks();
        },
        activate() {
            if (!createRenderer()) return false;
            refreshSceneForLiveArrivals();
            wrapWorldHooks();
            active = true;
            setCanvasVisible(true);
            setHint(true);
            view.layout((svc && svc.canvas && svc.canvas.width) || window.innerWidth || 1, (svc && svc.canvas && svc.canvas.height) || window.innerHeight || 1);
            if (renderId == null) renderId = requestAnimationFrame(renderLoop);
            return true;
        },
        deactivate() {
            active = false;
            setCanvasVisible(false);
            setHint(false);
            if (renderId != null) {
                cancelAnimationFrame(renderId);
                renderId = null;
            }
        },
        layout(width, height) {
            if (!renderer || !camera) return;
            const w = Math.max(1, width || window.innerWidth || 1);
            const h = Math.max(1, height || window.innerHeight || 1);
            renderer.setPixelRatio(getPixelRatio());
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();
        },
        draw(_ctx, time) {
            if (!active) return null;
            if (!renderer && !createRenderer()) return null;
            updateCitizenColors();
            if (renderer && scene && camera) {
                const t = Number(time) || 0;
                if (city.beaconMaterial) city.beaconMaterial.emissiveIntensity = 0.9 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.004));
                if (city.recentStreetMaterial) city.recentStreetMaterial.opacity = 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(t * 0.0012));
                syncStreetsVisibility();
                ensureCityStreetsToggle();
                updateSouls(t);
                renderer.render(scene, camera);
            }
            return city.stickyHit || city.hoverHit || null;
        },
        hitTest(mx, my) {
            if (!renderer && !createRenderer()) return null;
            return raycastAt(mx || 0, my || 0, false);
        }
    };

    window.WorldViews.register('city3d', view);
})();
