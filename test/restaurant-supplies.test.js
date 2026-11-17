const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const supplies = require('../src/renderer/restaurant-supplies.js');

function serverAdapter() {
    let item = null;
    const audit = [];
    const calls = [];
    return {
        calls,
        configured: true,
        isPosSuppliesConfigured() { return this.configured; },
        async posSupplies(method, payload) {
            calls.push({ method, payload });
            if (method === 'GET') return { items: item ? [item] : [], audit: audit.slice(), auditCursor: null };
            if (payload.action === 'create') {
                item = {
                    id: 'ketchup', name: payload.name, category: payload.category, unit: payload.unit,
                    quantity: payload.quantity, lowStockThreshold: payload.lowStockThreshold,
                    lowStock: Number(payload.quantity) <= Number(payload.lowStockThreshold)
                };
            } else if (payload.action === 'use') {
                if (Number(payload.quantity) > Number(item.quantity)) {
                    const error = new Error('الكمية المستهلكة أكبر من المخزون المتاح.');
                    error.code = 'INSUFFICIENT_SUPPLY_STOCK';
                    throw error;
                }
                item = Object.assign({}, item, {
                    quantity: String(Number(item.quantity) - Number(payload.quantity))
                });
                item.lowStock = Number(item.quantity) <= Number(item.lowStockThreshold);
            }
            const entry = {
                id: 'audit-' + audit.length, action: payload.action, itemId: item.id, itemName: item.name,
                unit: item.unit, beforeQuantity: payload.action === 'use' ? '5' : '0',
                quantity: payload.quantity || item.quantity, afterQuantity: item.quantity,
                beforeLowStockThreshold: '0', lowStockThreshold: item.lowStockThreshold,
                lowStock: item.lowStock, actor: 'worker', actorRole: 'worker', timestamp: '2026-11-17T12:00:00.000Z'
            };
            audit.unshift(entry);
            return { ok: true, replayed: false, item, audit: entry };
        }
    };
}

test('renderer creates stock 5, consumes 3 to 2, shows low stock and audit actor', async () => {
    const adapter = serverAdapter();
    supplies.init(adapter, () => {});
    await supplies.load(false);
    await supplies.submit('create', {
        requestId: 'create-ketchup-01', name: 'كاتشب', category: 'صلصات',
        unit: 'زجاجة', quantity: '5', lowStockThreshold: '2'
    });
    await supplies.submit('use', {
        requestId: 'use-ketchup-001', itemId: 'ketchup', quantity: '3'
    });
    const state = supplies._state();
    assert.equal(state.items[0].quantity, '2');
    assert.equal(state.items[0].lowStock, true);
    assert.equal(state.audit[0].actor, 'worker');
    assert.match(supplies.render('usage'), /مخزون منخفض/);
    assert.match(supplies.render('usage'), /worker/);
});

test('renderer validates decimal precision and exposes overspend/server failures visibly', async () => {
    const adapter = serverAdapter();
    supplies.init(adapter, () => {});
    await supplies.load(false);
    await supplies.submit('create', {
        requestId: 'create-flour-001', name: 'طحين', category: 'مخبوزات',
        unit: 'كغ', quantity: '1.25', lowStockThreshold: '0.5'
    });
    assert.equal(supplies.validQuantity('1.234'), true);
    assert.equal(supplies.validQuantity('1.2345'), false);
    assert.equal(supplies.validQuantity('-1'), false);
    await assert.rejects(() => supplies.submit('use', {
        requestId: 'overspend-flour', itemId: 'ketchup', quantity: '2'
    }), /أكبر من المخزون/);
    assert.match(supplies.render('usage'), /أكبر من المخزون/);
});

test('restaurant workers receive supplies and usage tabs without gaining unrelated manager tabs', () => {
    const workspace = fs.readFileSync(require.resolve('../src/renderer/restaurant-workspace.js'), 'utf8');
    assert.match(workspace, /\[\['supplies', 'المستلزمات'\], \['usage', 'الاستهلاك'\], \['tables', 'الطاولات'\]\]/);
    assert.match(workspace, /\['tables', 'supplies', 'usage'\]/);
});

test('trusted supplies adapter uses only the fixed RTS origin and structured bearer session', () => {
    const source = fs.readFileSync(require.resolve('../src/renderer/server-auth.js'), 'utf8');
    assert.match(source, /PLATFORM_AUTH_ORIGIN \+ '\/api\/pos-supplies'/);
    assert.match(source, /Origin: PLATFORM_AUTH_ORIGIN/);
    assert.match(source, /Authorization: 'Bearer ' \+ token/);
});

test('uncertain retry reuses one requestId so a committed consumption is not applied twice', async () => {
    let stock = 5;
    let auditCount = 0;
    let loseFirstResponse = true;
    const requests = new Map();
    const requestIds = [];
    const adapter = {
        isPosSuppliesConfigured() { return true; },
        async posSupplies(method, payload) {
            if (method === 'GET') return {
                items: [{ id: 'ketchup', name: 'كاتشب', category: 'صلصات', unit: 'زجاجة', quantity: String(stock), lowStockThreshold: '2', lowStock: stock <= 2 }],
                audit: [], auditCursor: null
            };
            requestIds.push(payload.requestId);
            if (requests.has(payload.requestId)) return Object.assign({}, requests.get(payload.requestId), { replayed: true });
            stock -= Number(payload.quantity);
            auditCount += 1;
            const result = {
                ok: true, replayed: false,
                item: { id: 'ketchup', name: 'كاتشب', category: 'صلصات', unit: 'زجاجة', quantity: String(stock), lowStockThreshold: '2', lowStock: stock <= 2 },
                audit: { id: 'audit-1', action: 'use', itemId: 'ketchup', itemName: 'كاتشب', unit: 'زجاجة', beforeQuantity: '5', quantity: payload.quantity, afterQuantity: String(stock), beforeLowStockThreshold: '2', lowStockThreshold: '2', lowStock: stock <= 2, actor: 'worker', actorRole: 'worker', timestamp: '2026-11-17T12:00:00.000Z' }
            };
            requests.set(payload.requestId, result);
            if (loseFirstResponse) {
                loseFirstResponse = false;
                throw new Error('انقطع الاتصال بعد الحفظ.');
            }
            return result;
        }
    };
    supplies.init(Object.assign({ sessionKey: 'retry-session' }, adapter), () => {});
    await supplies.load(false);
    const retry = {};
    await assert.rejects(
        () => supplies.submitWithRetryIdentity('use', { itemId: 'ketchup', quantity: '3' }, retry),
        /انقطع الاتصال/
    );
    await supplies.submitWithRetryIdentity('use', { itemId: 'ketchup', quantity: '3' }, retry);
    assert.equal(requestIds[0], requestIds[1]);
    assert.equal(stock, 2);
    assert.equal(auditCount, 1);
    assert.equal(supplies._state().items[0].quantity, '2');
    assert.equal(supplies._state().audit.length, 1);
});

test('changing retry payload gets a fresh requestId', async () => {
    const requestIds = [];
    const adapter = {
        isPosSuppliesConfigured() { return true; },
        async posSupplies(method, payload) {
            if (method === 'GET') return { items: [], audit: [], auditCursor: null };
            requestIds.push(payload.requestId);
            throw new Error('uncertain');
        }
    };
    supplies.init(Object.assign({ sessionKey: 'payload-session' }, adapter), () => {});
    const retry = {};
    await assert.rejects(() => supplies.submitWithRetryIdentity('use', { itemId: 'item-1', quantity: '1' }, retry));
    await assert.rejects(() => supplies.submitWithRetryIdentity('use', { itemId: 'item-1', quantity: '2' }, retry));
    assert.notEqual(requestIds[0], requestIds[1]);
});

test('late prior-store loads and mutations cannot alter the current store state', async () => {
    let resolveOldLoad;
    let resolveOldMutation;
    const oldAdapter = {
        sessionKey: 'old-store',
        isPosSuppliesConfigured() { return true; },
        posSupplies(method) {
            if (method === 'GET') return new Promise(resolve => { resolveOldLoad = resolve; });
            return new Promise(resolve => { resolveOldMutation = resolve; });
        }
    };
    const newAdapter = {
        sessionKey: 'new-store',
        isPosSuppliesConfigured() { return true; },
        async posSupplies(method) {
            if (method === 'GET') return {
                items: [{ id: 'new-item', name: 'New store', category: 'Type', unit: 'unit', quantity: '7', lowStockThreshold: '1', lowStock: false }],
                audit: [], auditCursor: null
            };
            throw new Error('Unexpected new-store mutation');
        }
    };
    supplies.init(oldAdapter, () => {});
    const oldLoad = supplies.load(false);
    supplies.init(newAdapter, () => {});
    await supplies.load(false);
    resolveOldLoad({
        items: [{ id: 'old-item', name: 'Old store', category: 'Type', unit: 'unit', quantity: '99', lowStockThreshold: '1', lowStock: false }],
        audit: [], auditCursor: null
    });
    await oldLoad;
    assert.deepEqual(supplies._state().items.map(item => item.id), ['new-item']);

    supplies.init(oldAdapter, () => {});
    const oldMutation = supplies.submit('adjust', { requestId: 'old-request-01', itemId: 'old-item', quantity: '4' });
    supplies.init(newAdapter, () => {});
    await supplies.load(false);
    resolveOldMutation({
        ok: true, replayed: false,
        item: { id: 'old-item', name: 'Old store', category: 'Type', unit: 'unit', quantity: '4', lowStockThreshold: '1', lowStock: false },
        audit: { id: 'old-audit', action: 'adjust', itemId: 'old-item', itemName: 'Old store', unit: 'unit', beforeQuantity: '3', quantity: '4', afterQuantity: '4', beforeLowStockThreshold: '1', lowStockThreshold: '1', lowStock: false, actor: 'old', actorRole: 'worker', timestamp: '2026-11-17T12:00:00.000Z' }
    });
    await assert.rejects(oldMutation, /تبديل المتجر/);
    assert.deepEqual(supplies._state().items.map(item => item.id), ['new-item']);
    assert.equal(supplies._state().error, '');
});

test('store switch closes supply modals and guards stale modal submission', () => {
    const source = fs.readFileSync(require.resolve('../src/renderer/restaurant-supplies.js'), 'utf8');
    assert.match(source, /querySelectorAll\('\[data-supply-modal\]'\)/);
    assert.match(source, /generation !== modalGeneration/);
});
