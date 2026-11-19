'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var createClient = require('../src/renderer/restaurant-shared').createClient;
var mergePrivateReceipt = require('../src/renderer/restaurant-shared').mergePrivateReceipt;

function adapters(overrides) {
    return Object.assign({
        config: async function () { return { configured: false, revision: 0, config: null }; },
        tables: async function () { return { configured: false, revision: 0, tables: [] }; },
        orders: async function () { return { holds: [] }; }
    }, overrides);
}
function hold(id, revision) { return { id: id, revision: revision, status: 'open', items: [] }; }

test('shared hold response-loss retry keeps one request ID and does not apply the hold twice', async function () {
    var client = createClient(), calls = [], saved = new Map(), lose = true;
    client.configure(adapters({ orders: async function (_method, payload) {
        calls.push(payload);
        if (!saved.has(payload.requestId)) saved.set(payload.requestId, { ok: true, hold: hold(payload.holdId, 1) });
        if (lose) { lose = false; throw new Error('Committed response lost'); }
        return saved.get(payload.requestId);
    } }), 'store-one:worker:1');
    var payload = { action: 'hold', holdId: 'hold-one', revision: 0, items: [{ productId: 'p1', qty: 1 }] };
    await assert.rejects(client.mutate('orders', payload), /response lost/);
    await client.mutate('orders', { items: payload.items, revision: 0, holdId: 'hold-one', action: 'hold' });
    assert.equal(calls[0].requestId, calls[1].requestId);
    assert.equal(saved.size, 1);
    assert.equal(client.state().holds.length, 1);
    await client.mutate('orders', Object.assign({}, payload, { revision: 1 }));
    assert.notEqual(calls[2].requestId, calls[1].requestId);
});

test('shared restaurant state ignores late old-session loads and writes', async function () {
    var resolveLoad, resolveWrite;
    var client = createClient();
    client.configure(adapters({ orders: function (method) {
        return new Promise(function (resolve) {
            if (method === 'GET') resolveLoad = resolve;
            else resolveWrite = resolve;
        });
    } }), 'store-one:worker:1');
    var load = client.refresh();
    var write = client.mutate('orders', { action: 'hold', holdId: 'old-hold', revision: 0 });
    client.configure(adapters(), 'store-two:worker:2');
    await client.refresh();
    resolveLoad({ holds: [hold('old-hold', 1)] });
    resolveWrite({ ok: true, hold: hold('old-hold', 1) });
    await assert.rejects(load, function (error) { return error.code === 'SESSION_CHANGED'; });
    await assert.rejects(write, function (error) { return error.code === 'SESSION_CHANGED'; });
    assert.deepEqual(client.state().holds, []);
});

test('an earlier refresh cannot overwrite a successful shared-order mutation', async function () {
    var resolveLoad;
    var client = createClient();
    client.configure(adapters({ orders: async function (method) {
        if (method === 'GET') return new Promise(function (resolve) { resolveLoad = resolve; });
        return { ok: true, hold: hold('new-hold', 1) };
    } }), 'store-one:worker:1');
    var load = client.refresh();
    await client.mutate('orders', { action: 'hold', holdId: 'new-hold', revision: 0 });
    resolveLoad({ holds: [] });
    await load;
    assert.equal(client.state().holds[0].id, 'new-hold');
});

test('unavailable or malformed shared state never becomes an empty successful load', async function () {
    var client = createClient();
    client.configure(adapters({ orders: async function () { throw new Error('Offline'); } }), 'store-one:worker:1');
    await assert.rejects(client.refresh(), /Offline/);
    assert.equal(client.state().loaded, false);
    client.configure(adapters({ tables: async function () { return { configured: true, revision: 1, tables: null }; } }), 'store-one:worker:2');
    await assert.rejects(client.refresh(), /طاولات/);
    assert.equal(client.state().loaded, false);
});

test('private receipts preserve exact historical zero costs and missing costs without a current-price fallback', function () {
    var items = [
        { productId: 'p1', color: '', size: 'small', qty: 1 },
        { productId: 'p2', color: '', size: 'large', qty: 2 },
        { productId: 'p3', color: '', size: '', qty: 1 }
    ];
    var publicBill = { id: 'public-id', billNumber: 'POS-M-order', privateRef: 'opaque-ref', createdAt: { fixture: true }, items: items };
    var response = {
        bill: { billNumber: publicBill.billNumber, privateRef: publicBill.privateRef, items: items, note: 'Private note' },
        costs: [Object.assign({}, items[0], { cost: 0 }), Object.assign({}, items[1], { cost: 3.25 }), Object.assign({}, items[2], { cost: null })]
    };
    var merged = mergePrivateReceipt(publicBill, response, true);
    assert.deepEqual(merged.items.map(function (item) { return item.cost; }), [0, 3.25, null]);
    assert.equal(merged.items.every(function (item) { return item.historicalCostProtected; }), true);
    assert.equal(merged.createdAt, publicBill.createdAt);
    assert.equal(publicBill.items[0].cost, undefined);
    assert.equal(mergePrivateReceipt(publicBill, response, false).items[1].cost, null);
    assert.throws(function () { mergePrivateReceipt(publicBill, { bill: Object.assign({}, response.bill, { privateRef: 'different' }), costs: [] }, true); }, /مطابقة/);
});

test('late saved-hold replies cannot overwrite a newer revision or resurrect a paid ticket', async function () {
    var pending = [];
    var client = createClient();
    client.configure(adapters({ orders: async function (_method, payload) {
        if (payload.action === 'checkout') return { ok: true, bill: { billNumber: 'POS-M-order' } };
        if (payload.revision === 1) return { ok: true, hold: hold('order', 2) };
        return new Promise(function (resolve) { pending.push(resolve); });
    } }), 'store-one:worker:1');
    var old = client.mutate('orders', { action: 'hold', holdId: 'order', revision: 0 });
    await client.mutate('orders', { action: 'hold', holdId: 'order', revision: 1 });
    pending.shift()({ ok: true, hold: hold('order', 1) });
    await assert.rejects(old, function (error) { return error.code === 'STALE_RESPONSE'; });
    assert.equal(client.state().holds[0].revision, 2);
    var beforePayment = client.mutate('orders', { action: 'hold', holdId: 'order', revision: 2 });
    await client.mutate('orders', { action: 'checkout', holdId: 'order', revision: 3 });
    pending.shift()({ ok: true, hold: hold('order', 3) });
    await assert.rejects(beforePayment, function (error) { return error.code === 'STALE_RESPONSE'; });
    assert.deepEqual(client.state().holds, []);
});
