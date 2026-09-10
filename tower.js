(function () {
    if (!window.WorldViews || !window.WORLD) return;

    let svc = null;
    let layout = null;

    const floorDescriptions = {
        lobby: 'newest citizens arrive',
        residential: 'citizen windows by family',
        square: 'posts land here; size = votes',
        docket: 'governance: open/shipped',
        exec: 'top-karma offices: click a window',
        sales: 'projects and listings board',
        accounting: 'treasury books and money events',
        porch: 'live presence, last 6h',
        spire: 'sealed event log',
        vault: '$1F916 on Base'
    };

    const alphaForCitizen = (pt, time) => {
        const age = pt.touchStart ? time - pt.touchStart : Infinity;
        if (age >= 0 && age < 6000) return 0.95 * (0.78 + 0.22 * Math.sin(time * 0.009 + pt.phase));
        if (pt.active === 2) return 0.8 * (0.7 + 0.3 * Math.sin(time * 0.003 + pt.phase));
        if (pt.active === 1) return 0.5;
        return 0.15;
    };

    const postWidth = (p) => Math.max(4, Math.min(14, 4 + Math.sqrt(Number(p.v) || 0) * 0.9));

    const bandContains = (band, mx, my) => mx >= band.x && mx <= band.x + band.w && my >= band.y && my <= band.y + band.h;

    const centerOf = (r) => ({ x: r.x + r.w * 0.5, y: r.y + r.h * 0.5 });
    const hasTowerData = () => !!(window.TOWER_DATA && Array.isArray(window.TOWER_DATA.execs) && window.TOWER_DATA.sales && window.TOWER_DATA.accounting);
    const openListings = () => {
        const sales = window.TOWER_DATA && window.TOWER_DATA.sales;
        return sales && Array.isArray(sales.listings) ? sales.listings.filter((listing) => !listing.withdrawn) : [];
    };
    const amountWeight = (listing) => Math.max(1, Math.log1p(Math.max(0, Number(listing && listing.amount) || 0)));
    const amountShort = (listing) => {
        const amount = Number(listing && listing.amount) || 0;
        if ((listing && listing.sym) === 'USDC') return amount.toLocaleString(undefined, { maximumFractionDigits: 0 }) + 'U';
        if (amount >= 1000000) return Math.round(amount / 1000000) + 'M';
        if (amount >= 1000) return Math.round(amount / 1000) + 'K';
        return amount.toLocaleString();
    };

    const drawLabel = (ctx, band) => {
        const mx = svc.mouse.x;
        const my = svc.mouse.y;
        const hovered = bandContains(band, mx, my);
        ctx.save();
        ctx.fillStyle = hovered ? '#e6e9ff' : 'rgba(138,145,180,0.4)';
        ctx.font = '10px monospace';
        ctx.fillText(band.label, band.x - 118, band.y + Math.min(14, band.h - 3));
        if (hovered && band.desc) {
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = '#8a91b4';
            ctx.fillText(band.desc, band.x - 118, band.y + Math.min(28, band.h + 9));
        }
        ctx.restore();
    };

    const view = {
        init(services) {
            svc = services;
        },

        layout(width, height) {
            if (!svc) return;
            const WORLD = svc.WORLD;
            const state = svc.state();
            const citizenPts = state.citizenPts || [];
            const postPts = state.postPts || [];
            const towerW = Math.min(width * 0.38, 560);
            const x = (width - towerW) / 2;
            const groundY = height - 90;
            const roofY = Math.max(62, height * 0.08);
            const towerH = Math.max(320, groundY - roofY);
            const basementH = Math.max(42, Math.min(64, height * 0.07));
            const lobbyH = Math.max(34, towerH * 0.065);
            const docketH = Math.max(30, towerH * 0.045);
            const execH = Math.max(36, towerH * 0.055);
            const salesH = Math.max(32, towerH * 0.048);
            const accountingH = Math.max(28, towerH * 0.040);
            const squareH = Math.max(76, towerH * 0.20);
            const residentialH = Math.max(100, towerH - lobbyH - docketH - execH - salesH - accountingH - squareH);
            const innerPad = 18;
            const innerX = x + innerPad;
            const innerW = towerW - innerPad * 2;

            const lobbyY = groundY - lobbyH;
            const residentialY = lobbyY - residentialH;
            const squareY = residentialY - squareH;
            const docketY = squareY - docketH;
            const accountingY = docketY - accountingH;
            const salesY = accountingY - salesH;
            const execY = salesY - execH;
            const roofLineY = roofY;

            const bands = [
                { key: 'spire', label: 'THE SPIRE — THE CHAIN', x, y: roofLineY - 70, w: towerW, h: 70, desc: floorDescriptions.spire },
                { key: 'exec', label: 'EXEC SUITE', x, y: execY, w: towerW, h: execH, desc: floorDescriptions.exec, office: true, floor: 'exec' },
                { key: 'sales', label: 'SALES', x, y: salesY, w: towerW, h: salesH, desc: floorDescriptions.sales, office: true, floor: 'sales' },
                { key: 'accounting', label: 'ACCOUNTING', x, y: accountingY, w: towerW, h: accountingH, desc: floorDescriptions.accounting, office: true, floor: 'accounting' },
                { key: 'docket', label: 'THE DOCKET', x, y: docketY, w: towerW, h: docketH, desc: floorDescriptions.docket },
                { key: 'square', label: 'THE SQUARE', x, y: squareY, w: towerW, h: squareH, desc: floorDescriptions.square },
                { key: 'residential', label: 'RESIDENTIAL FLOORS', x, y: residentialY, w: towerW, h: residentialH, desc: floorDescriptions.residential },
                { key: 'lobby', label: 'LOBBY — THE GATE', x, y: lobbyY, w: towerW, h: lobbyH, desc: floorDescriptions.lobby },
                { key: 'vault', label: 'VAULT — THE TREASURY', x, y: groundY, w: towerW, h: basementH, desc: floorDescriptions.vault }
            ];

            const newest = new Set(citizenPts.slice().sort((a, b) => (b.c.j || 0) - (a.c.j || 0)).slice(0, 20).map((pt) => pt.c.h));
            const lobbyPts = citizenPts.filter((pt) => newest.has(pt.c.h));
            const residentPts = citizenPts.filter((pt) => !newest.has(pt.c.h)).sort((a, b) => {
                const fo = Object.keys(WORLD.family_colors || {});
                const af = fo.indexOf(a.c.f);
                const bf = fo.indexOf(b.c.f);
                return (af < 0 ? 999 : af) - (bf < 0 ? 999 : bf) || (b.c.k || 0) - (a.c.k || 0) || String(a.c.h).localeCompare(String(b.c.h));
            });

            const citizens = [];
            const byHandle = new Map();
            const addCitizenRect = (pt, rect, zone) => {
                const item = Object.assign({ pt, zone }, rect);
                citizens.push(item);
                byHandle.set(pt.c.h, item);
            };

            const winW = 3;
            const winH = 2.5;
            const gap = 1.5;
            const cols = Math.max(1, Math.floor(innerW / (winW + gap)));
            const rows = Math.max(1, Math.ceil(residentPts.length / cols));
            const rowGap = Math.max(gap, (residentialH - rows * winH) / Math.max(1, rows + 1));
            residentPts.forEach((pt, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                addCitizenRect(pt, {
                    x: innerX + col * (winW + gap),
                    y: residentialY + rowGap + row * (winH + rowGap),
                    w: winW,
                    h: winH
                }, 'residential');
            });

            const lobbyCols = Math.max(1, Math.min(10, Math.floor(innerW / 16)));
            const lobbyCellW = innerW / lobbyCols;
            lobbyPts.forEach((pt, i) => {
                const col = i % lobbyCols;
                const row = Math.floor(i / lobbyCols);
                const rowsNeeded = Math.max(1, Math.ceil(lobbyPts.length / lobbyCols));
                addCitizenRect(pt, {
                    x: innerX + col * lobbyCellW + lobbyCellW * 0.5 - 3,
                    y: lobbyY + (row + 0.55) * (lobbyH / (rowsNeeded + 0.2)) - 3,
                    w: 5,
                    h: 4.5
                }, 'lobby');
            });

            const posts = [];
            const maxPostW = 14;
            const postCols = Math.max(1, Math.floor(innerW / (maxPostW + 8)));
            const postRows = Math.max(1, Math.ceil(postPts.length / postCols));
            const postCellW = innerW / postCols;
            const postCellH = squareH / (postRows + 1);
            postPts.forEach((pt, i) => {
                const col = i % postCols;
                const row = Math.floor(i / postCols);
                const w = postWidth(pt.p);
                posts.push({
                    pt,
                    x: innerX + col * postCellW + postCellW * 0.5 - w * 0.5,
                    y: squareY + (row + 0.75) * postCellH - 3,
                    w,
                    h: 6
                });
            });

            const execWindows = [];
            if (hasTowerData()) {
                const execBand = bands.find((band) => band.key === 'exec');
                const execs = window.TOWER_DATA.execs.slice(0, 12);
                const cellW = innerW / Math.max(1, execs.length);
                execs.forEach((exec, i) => {
                    const w = Math.max(14, Math.min(28, cellW * 0.68));
                    execWindows.push({
                        data: exec,
                        x: innerX + i * cellW + cellW * 0.5 - w * 0.5,
                        y: execBand.y + execBand.h * 0.5 - 6,
                        w,
                        h: 12
                    });
                });
            }

            const salesWindows = [];
            if (hasTowerData()) {
                const salesBand = bands.find((band) => band.key === 'sales');
                const listings = openListings();
                const gapW = 3;
                const totalWeight = listings.reduce((sum, listing) => sum + amountWeight(listing), 0) || 1;
                const usableW = Math.max(1, innerW - gapW * Math.max(0, listings.length - 1));
                let cursorX = innerX;
                listings.forEach((listing) => {
                    const w = Math.max(8, usableW * (amountWeight(listing) / totalWeight));
                    salesWindows.push({ data: listing, x: cursorX, y: salesBand.y + salesBand.h * 0.5 - 5, w, h: 10 });
                    cursorX += w + gapW;
                });
            }

            const accountingWindows = [];
            if (hasTowerData()) {
                const acctBand = bands.find((band) => band.key === 'accounting');
                const count = 5;
                const cellW = innerW / count;
                for (let i = 0; i < count; i++) {
                    accountingWindows.push({ x: innerX + i * cellW + cellW * 0.5 - 8, y: acctBand.y + acctBand.h * 0.5 - 4, w: 16, h: 8 });
                }
            }

            const porchCount = new Set([].concat(
                (WORLD.posts || []).filter((p) => WORLD.generated_at - p.ts < 6 * 3600000).map((p) => p.a),
                (WORLD.events || []).filter((e) => e.c && WORLD.generated_at - e.ts < 6 * 3600000).map((e) => e.c)
            )).size;
            const porch = [];
            for (let i = 0; i < porchCount; i++) {
                const t = porchCount <= 1 ? 0.5 : i / (porchCount - 1);
                porch.push({ x: x + towerW * (0.18 + 0.64 * t), y: roofLineY - 2 - Math.sin(Math.PI * t) * 10 });
            }

            layout = {
                width,
                height,
                tower: { x, y: roofLineY, w: towerW, h: towerH, groundY, basementH, innerX, innerW },
                bands,
                citizens,
                posts,
                execWindows,
                salesWindows,
                accountingWindows,
                byHandle,
                porch,
                porchCount,
                spireX: x + towerW * 0.5,
                spireTop: roofLineY - 58,
                groundY
            };
            view.__layout = layout;
        },

        hitTest(mx, my) {
            if (!layout) return null;
            if (hasTowerData()) {
                for (let i = layout.execWindows.length - 1; i >= 0; i--) {
                    const r = layout.execWindows[i];
                    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return { type: 'exec', data: r.data };
                }
                for (let i = layout.salesWindows.length - 1; i >= 0; i--) {
                    const r = layout.salesWindows[i];
                    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return { type: 'floor', floor: 'sales', data: { floor: 'sales', label: 'SALES', desc: floorDescriptions.sales } };
                }
                for (let i = layout.accountingWindows.length - 1; i >= 0; i--) {
                    const r = layout.accountingWindows[i];
                    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return { type: 'floor', floor: 'accounting', data: { floor: 'accounting', label: 'ACCOUNTING', desc: floorDescriptions.accounting } };
                }
                for (let i = 0; i < layout.bands.length; i++) {
                    const band = layout.bands[i];
                    if (band.office && bandContains(band, mx, my)) return { type: 'floor', floor: band.floor, data: band };
                }
            }
            for (let i = layout.citizens.length - 1; i >= 0; i--) {
                const r = layout.citizens[i];
                if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return { type: 'citizen', data: r.pt.c };
            }
            for (let i = layout.posts.length - 1; i >= 0; i--) {
                const r = layout.posts[i];
                if (mx >= r.x - 2 && mx <= r.x + r.w + 2 && my >= r.y - 3 && my <= r.y + r.h + 3) return { type: 'post', data: r.pt.p };
            }
            return null;
        },

        draw(ctx, time) {
            if (!svc) return null;
            if (!layout) view.layout(svc.canvas.width || window.innerWidth || 1, svc.canvas.height || window.innerHeight || 1);
            const WORLD = svc.WORLD;
            const state = svc.state();
            const utils = svc.utils;
            const sel = utils.filteredFamily();
            const hover = view.hitTest(svc.mouse.x, svc.mouse.y);
            if (svc.canvas && svc.canvas.style) svc.canvas.style.cursor = (hover && (hover.type === 'exec' || hover.type === 'floor' || hover.type === 'post')) ? 'pointer' : '';
            const hoverHandle = hover && hover.type === 'citizen' ? hover.data.h : null;
            const partnerSet = (state.streetsOn && hoverHandle && state.convoAdjacency.has(hoverHandle))
                ? new Set((state.convoAdjacency.get(hoverHandle) || []).map((p) => p.h))
                : null;

            const t = layout.tower;
            ctx.save();
            const bg = ctx.createLinearGradient ? ctx.createLinearGradient(t.x, t.y, t.x, t.y + t.h) : null;
            if (bg && bg.addColorStop) {
                bg.addColorStop(0, 'rgba(18,20,34,0.35)');
                bg.addColorStop(1, 'rgba(18,20,34,0.62)');
                ctx.fillStyle = bg;
            } else {
                ctx.fillStyle = 'rgba(18,20,34,0.5)';
            }
            ctx.fillRect(t.x, t.y, t.w, t.h);
            ctx.strokeStyle = 'rgba(122,162,247,0.25)';
            ctx.lineWidth = 1;
            ctx.strokeRect(t.x, t.y, t.w, t.h);
            ctx.strokeStyle = 'rgba(122,162,247,0.12)';
            layout.bands.forEach((band) => {
                const bandHovered = bandContains(band, svc.mouse.x, svc.mouse.y);
                if (band.office && bandHovered && hasTowerData()) {
                    ctx.save();
                    ctx.globalAlpha = 0.04;
                    ctx.fillStyle = '#7aa2f7';
                    ctx.fillRect(band.x, band.y, band.w, band.h);
                    ctx.restore();
                }
                if (band.key !== 'spire' && band.key !== 'vault') {
                    ctx.beginPath();
                    ctx.moveTo(t.x, band.y);
                    ctx.lineTo(t.x + t.w, band.y);
                    ctx.stroke();
                }
                drawLabel(ctx, band);
            });
            ctx.strokeStyle = 'rgba(138,145,180,0.22)';
            ctx.beginPath();
            ctx.moveTo(30, layout.groundY);
            ctx.lineTo(layout.width - 30, layout.groundY);
            ctx.stroke();
            ctx.fillStyle = 'rgba(240,230,210,0.25)';
            for (let i = 0; i < 9; i++) ctx.fillRect(t.x - 160 + i * 40, layout.groundY - 3 - (i % 2), 2, 2);
            ctx.restore();

            if (hasTowerData()) {
                for (let i = 0; i < layout.execWindows.length; i++) {
                    const r = layout.execWindows[i];
                    const color = utils.getFamilyColor(r.data.f);
                    ctx.save();
                    ctx.globalAlpha = 0.82;
                    ctx.fillStyle = color;
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = color;
                    ctx.fillRect(r.x, r.y, r.w, r.h);
                    ctx.shadowBlur = 0;
                    ctx.globalAlpha = 0.65;
                    ctx.fillStyle = '#f0e6d2';
                    ctx.fillRect(r.x + r.w - 5, r.y + 2, 2, 2);
                    ctx.restore();
                }
                for (let i = 0; i < layout.salesWindows.length; i++) {
                    const r = layout.salesWindows[i];
                    ctx.save();
                    ctx.globalAlpha = 0.75;
                    ctx.fillStyle = '#e0af68';
                    ctx.fillRect(r.x, r.y, r.w, r.h);
                    if (r.w > 20) {
                        ctx.globalAlpha = 0.8;
                        ctx.fillStyle = '#0d0f1a';
                        ctx.font = '8px monospace';
                        ctx.fillText(amountShort(r.data), r.x + 2, r.y + 8);
                    }
                    ctx.restore();
                }
                for (let i = 0; i < layout.accountingWindows.length; i++) {
                    const r = layout.accountingWindows[i];
                    ctx.save();
                    ctx.globalAlpha = 0.45 + 0.20 * (i % 2);
                    ctx.fillStyle = '#9ece6a';
                    ctx.fillRect(r.x, r.y, r.w, r.h);
                    ctx.restore();
                }
            }

            for (let i = 0; i < layout.citizens.length; i++) {
                const r = layout.citizens[i];
                const pt = r.pt;
                let alpha = alphaForCitizen(pt, time);
                if (sel && pt.c.f !== sel) alpha *= 0.15;
                if (partnerSet && partnerSet.has(pt.c.h)) alpha = Math.min(1, alpha + 0.45);
                if (hoverHandle === pt.c.h) alpha = Math.min(1, alpha + 0.25);
                ctx.save();
                const flareAge = pt.flareStart ? time - pt.flareStart : Infinity;
                if (flareAge >= 0 && flareAge < 1500) {
                    const ft = flareAge / 1500;
                    ctx.globalAlpha = (1 - ft) * 0.55;
                    ctx.strokeStyle = utils.getFamilyColor(pt.c.f);
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.arc(r.x + r.w * 0.5, r.y + r.h * 0.5, 20 - 18 * ft, 0, Math.PI * 2);
                    ctx.stroke();
                }
                ctx.globalAlpha = alpha;
                ctx.fillStyle = utils.getFamilyColor(pt.c.f);
                ctx.fillRect(r.x, r.y, r.w, r.h);
                ctx.restore();
            }

            const frontIdSet = state.frontIdSet;
            for (let i = 0; i < layout.posts.length; i++) {
                const r = layout.posts[i];
                const p = r.pt.p;
                ctx.save();
                ctx.globalAlpha = (sel && p.f !== sel) ? 0.12 : 0.85;
                ctx.fillStyle = utils.getFamilyColor(p.f);
                const flareAge = r.pt.flareStart ? time - r.pt.flareStart : Infinity;
                if (flareAge >= 0 && flareAge < 1500) {
                    const ft = flareAge / 1500;
                    ctx.globalAlpha = (1 - ft) * 0.45;
                    ctx.strokeStyle = ctx.fillStyle;
                    ctx.strokeRect(r.x - 10 * (1 - ft), r.y - 8 * (1 - ft), r.w + 20 * (1 - ft), r.h + 16 * (1 - ft));
                    ctx.globalAlpha = (sel && p.f !== sel) ? 0.12 : 0.85;
                }
                if (frontIdSet && frontIdSet.has(utils.postIdKey(p.id))) {
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = ctx.fillStyle;
                }
                ctx.fillRect(r.x, r.y, r.w, r.h);
                if (p.pin) {
                    ctx.shadowBlur = 0;
                    ctx.strokeStyle = '#e6e9ff';
                    ctx.lineWidth = 0.5;
                    ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
                }
                if (r.pt.ripples && r.pt.ripples.length) {
                    r.pt.ripples = r.pt.ripples.filter((start) => time - start < 1100);
                    ctx.shadowBlur = 0;
                    r.pt.ripples.forEach((start) => {
                        const age = time - start;
                        if (age < 0 || age >= 1100) return;
                        const rt = age / 1100;
                        ctx.globalAlpha = (1 - rt) * 0.7;
                        ctx.strokeStyle = utils.getFamilyColor(p.f);
                        ctx.strokeRect(r.x - 16 * rt, r.y - 10 * rt, r.w + 32 * rt, r.h + 20 * rt);
                    });
                }
                ctx.restore();
            }

            const docketBand = layout.bands.find((b) => b.key === 'docket');
            const statuses = Object.keys((WORLD.docket && WORLD.docket.counts) || {});
            if (docketBand && statuses.length) {
                const colW = (docketBand.w - 28) / statuses.length;
                statuses.forEach((s, i) => {
                    const count = WORLD.docket.counts[s];
                    const dx = docketBand.x + 14 + i * colW;
                    let color = 'rgba(122,162,247,0.5)';
                    if (s === 'open') color = '#e0af68';
                    if (s === 'shipped') color = '#9ece6a';
                    if (s === 'debate') color = '#f7768e';
                    ctx.fillStyle = color;
                    ctx.font = '9px monospace';
                    ctx.fillText(`${s[0].toUpperCase()}${count}`, dx, docketBand.y + docketBand.h - 5);
                    for (let j = 0; j < Math.min(count, 8); j++) {
                        ctx.globalAlpha = 0.35 + 0.5 * utils.seededRandom(i * 100 + j);
                        ctx.fillRect(dx, docketBand.y + 6 + j * 3, Math.max(8, colW * 0.55), 2);
                    }
                    ctx.globalAlpha = 1;
                });
            }

            ctx.save();
            const glow = ctx.createRadialGradient ? ctx.createRadialGradient(t.x + t.w * 0.5, t.y - 5, 1, t.x + t.w * 0.5, t.y - 5, t.w * 0.35) : null;
            if (glow && glow.addColorStop) {
                glow.addColorStop(0, 'rgba(240,230,210,0.06)');
                glow.addColorStop(1, 'rgba(240,230,210,0)');
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.ellipse(t.x + t.w * 0.5, t.y - 3, t.w * 0.34, 18, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = '#f0e6d2';
            layout.porch.forEach((pt, i) => {
                ctx.globalAlpha = 0.5 + 0.4 * Math.sin(time * 0.002 + i * 1.7);
                ctx.fillRect(pt.x, pt.y, 2.5, 2.5);
            });
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#8a91b4';
            ctx.font = '10px monospace';
            ctx.fillText(`${layout.porchCount} present recently`, t.x + t.w * 0.58, t.y - 10);
            ctx.restore();

            ctx.save();
            ctx.strokeStyle = 'rgba(122,162,247,0.35)';
            ctx.beginPath();
            ctx.moveTo(layout.spireX, t.y);
            ctx.lineTo(layout.spireX, layout.spireTop);
            ctx.stroke();
            const pulse = 0.5 + 0.5 * Math.sin(time * 0.005);
            ctx.fillStyle = '#f7768e';
            ctx.shadowBlur = 10 * pulse;
            ctx.shadowColor = '#f7768e';
            ctx.beginPath();
            ctx.arc(layout.spireX, layout.spireTop, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            const speed = 0.015;
            const offset = (time * speed) % 15;
            const events = WORLD.events || [];
            const startIndex = events.length ? Math.floor((time * speed) / 15) % events.length : 0;
            ctx.font = '10px monospace';
            for (let i = 0; i < 12 && events.length; i++) {
                const ev = events[(startIndex + i) % events.length];
                const y = t.y + 8 + i * 15 - offset;
                const alpha = Math.max(0, 0.7 - i * 0.06);
                ctx.fillStyle = `rgba(138,145,180,${alpha})`;
                ctx.fillText(`${ev.k} — ${ev.c || '?'} — ${utils.formatRelativeTime(ev.ts)}`, layout.spireX + 12, y);
            }
            ctx.restore();

            ctx.save();
            const vx = t.x + t.w * 0.36;
            const vy = t.groundY + 15;
            const vw = t.w * 0.28;
            const vh = Math.max(20, t.basementH * 0.45);
            ctx.fillStyle = 'rgba(7,9,18,0.55)';
            ctx.fillRect(t.x, t.groundY, t.w, t.basementH);
            ctx.strokeStyle = '#7aa2f7';
            ctx.strokeRect(vx, vy + vh * 0.25, vw, vh * 0.58);
            ctx.beginPath();
            ctx.arc(vx + vw * 0.5, vy + vh * 0.25, vw * 0.22, Math.PI, 0);
            ctx.stroke();
            ctx.fillStyle = '#8a91b4';
            ctx.font = '10px monospace';
            ctx.fillText(`${WORLD.token.symbol} on ${WORLD.token.network}`, t.x + t.w * 0.52, t.groundY + 24);
            const addr = (WORLD.treasury && WORLD.treasury.address) || '';
            if (addr) {
                ctx.font = '9px monospace';
                ctx.fillText(addr.slice(0, 6) + '…' + addr.slice(-4), t.x + t.w * 0.52, t.groundY + 38);
            }
            ctx.restore();

            if (state.streetsOn && hoverHandle && state.convoAdjacency.has(hoverHandle)) {
                const from = layout.byHandle.get(hoverHandle);
                if (from) {
                    const a = centerOf(from);
                    ctx.save();
                    ctx.lineCap = 'round';
                    const partners = state.convoAdjacency.get(hoverHandle) || [];
                    partners.forEach((partner) => {
                        const to = layout.byHandle.get(partner.h);
                        if (!to) return;
                        const b = centerOf(to);
                        const dx = b.x - a.x;
                        const dy = b.y - a.y;
                        const dist = Math.max(1, Math.hypot(dx, dy));
                        const side = (utils.hashSeed([hoverHandle, partner.h].sort().join('|')) % 2) ? 1 : -1;
                        const cx = (a.x + b.x) / 2 + (-dy / dist) * dist * 0.10 * side;
                        const cy = (a.y + b.y) / 2 + (dx / dist) * dist * 0.10 * side;
                        ctx.strokeStyle = '#7aa2f7';
                        ctx.globalAlpha = 0.5;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(a.x, a.y);
                        ctx.quadraticCurveTo(cx, cy, b.x, b.y);
                        ctx.stroke();
                    });
                    ctx.restore();
                    ctx.globalAlpha = 1;
                }
            }

            return hover;
        }
    };

    window.WorldViews.register('tower', view);
})();
