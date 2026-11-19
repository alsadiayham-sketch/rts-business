const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../src/renderer/restaurant-model.js');

function appHarness() {
    const elements = new Map();
    const writes = [];
    const storage = new Map();
    function element() {
        return {
            value: '', innerHTML: '', textContent: '', disabled: false, style: {}, attributes: {},
            classList: { add() {}, remove() {}, toggle() {} },
            addEventListener() {}, removeAttribute() {}, setAttribute(name, value) { this.attributes[name] = value; },
            getAttribute(name) { return this.attributes[name]; }, closest() { return null; }
        };
    }
    const document = {
        body: { classList: { add() {}, remove() {}, toggle() {} } },
        getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
        querySelector() { return null; }, querySelectorAll() { return []; }, getElementsByClassName() { return []; },
        addEventListener() {}, createElement() { return element(); }
    };
    const firebase = {
        firestore: { FieldValue: { serverTimestamp() { return {}; } } }
    };
    const db = { collection(name) { return { doc(id) { return { set(record) { writes.push({ name, id, record }); return Promise.resolve(); } }; } }; } };
    const sandbox = {
        console, document, window: { RestaurantModel: model, addEventListener() {}, print() {}, crypto: { randomUUID() { return 'id'; } } },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
        navigator: { onLine: true }, setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
        require(request) {
            if (request === './restaurant-service') return require('../src/renderer/restaurant-service');
            if (request === './restaurant-shared') return require('../src/renderer/restaurant-shared');
            if (request === 'node:crypto') return require('node:crypto');
            if (request === './firebase-config') return {
                db, rawDb: {}, firebase, storage: {}, setProjectId() {}, getProjectId() { return 'test'; }, isD1() { return false; },
                registerD1Tenant() {}, registerD1MessagingBackend() {}, isMessagingConfigured() { return false; },
                messagingGetStatus() {}, messagingPreviewAudience() {}, messagingRequestCredits() {}, messagingSend() {}, messagingUpdatePricing() {},
                serverTimestamp() {}, posAuthenticate() {}, configurePosAuth() { return false; }, publishOwnerTelemetry() {},
                posEmployees() { return Promise.resolve({ users: [] }); }, isPosEmployeeManagementConfigured() { return true; }
            };
            if (request === './owner-telemetry') return { emptyAuditCounts() { return {}; } };
            if (request === 'electron') return { ipcRenderer: { invoke() { return Promise.resolve(); } } };
            if (request === 'fs' || request === 'path') return {};
            if (request === '../../package.json') return { version: '4.0.10' };
            throw new Error('Unexpected require: ' + request);
        }
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(require.resolve('../src/renderer/app.js'), 'utf8'), sandbox, { filename: 'app.js' });
    vm.runInContext('renderCart = function () { window.__renderedCart = cart.slice(); };', sandbox);
    return { sandbox, elements, writes, storage };
}

test('offers reject expired, under-quantity, and excessive percentage values', () => {
    const offer = { name: 'عرض', discountType: 'percent', discountValue: 120, minQty: 2, enabled: true, expiresOn: '2026-10-25' };
    const result = model.applyOffer(offer, [{ price: 20, qty: 1 }], '2026-10-26');
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /100%/);
    assert.match(result.errors.join(' '), /منتهي/);
    assert.match(result.errors.join(' '), /الكمية/);
});

test('offers cap a valid calculated discount at the subtotal and configured maximum', () => {
    const result = model.applyOffer({ name: 'غداء', discountType: 'percent', discountValue: 50, maxDiscount: 15, minQty: 2, enabled: true }, [{ price: 20, qty: 2 }], '2026-10-26');
    assert.deepEqual(result, { ok: true, errors: [], subtotal: 40, discount: 15 });
});

test('stored offer display values never reflect malicious markup', () => {
    const markup = '<img src=x onerror="globalThis.pwned=1">';
    assert.equal(model.offerLabel({ discountType: 'percent', discountValue: markup }), '0%');
    assert.equal(model.offerLabel({ discountType: 'amount', discountValue: markup }), '₪0.00');
    const renderer = fs.readFileSync(require.resolve('../src/renderer/restaurant-workspace.js'), 'utf8');
    assert.match(renderer, /esc\(label\)/);
});

test('revalidation rejects deleted, expired, disabled, and under-quantity applied offers', () => {
    const cart = [{ price: 20, qty: 2 }];
    const active = { id: 'offer-1', recordType: 'restaurant-offer', name: 'عرض', discountType: 'percent', discountValue: 20, minQty: 2, enabled: true };
    assert.equal(model.revalidateAppliedOffer([], 'offer-1', cart, '2026-10-26').ok, false);
    assert.equal(model.revalidateAppliedOffer([{ ...active, expiresOn: '2026-10-25' }], 'offer-1', cart, '2026-10-26').ok, false);
    assert.equal(model.revalidateAppliedOffer([{ ...active, enabled: false }], 'offer-1', cart, '2026-10-26').ok, false);
    assert.equal(model.revalidateAppliedOffer([active], 'offer-1', [{ price: 20, qty: 1 }], '2026-10-26').ok, false);
});

test('revalidation recalculates a current offer against the current cart', () => {
    const offer = { id: 'offer-1', recordType: 'restaurant-offer', name: 'عرض', discountType: 'percent', discountValue: 50, maxDiscount: 12, minQty: 1, enabled: true };
    const result = model.revalidateAppliedOffer([offer], 'offer-1', [{ price: 30, qty: 1 }], '2026-10-26');
    assert.equal(result.ok, true);
    assert.equal(result.discount, 12);
});

test('manual discount edits clear only an active restaurant offer', () => {
    const app = fs.readFileSync(require.resolve('../src/renderer/app.js'), 'utf8');
    assert.match(app, /if \(!activeRestaurantOffer\) return \{ ok: true, offer: null \};/);
    assert.match(app, /discountInput'\)\.addEventListener\('input', function \(\) \{ resetActiveRestaurantOffer\(\);/);
    assert.match(app, /discountType'\)\.addEventListener\('change', function \(\) \{ resetActiveRestaurantOffer\(\);/);
});

test('attendance transitions prevent duplicate check-in and checkout without an open shift', () => {
    const records = [{ recordType: 'restaurant-attendance', employeeId: 'e1', action: 'in', shiftId: 's1', occurredAt: '2026-10-26T08:00:00.000Z' }];
    assert.equal(model.validateAttendanceTransition(records, 'e1', 'in', '2026-10-26T09:00:00.000Z').ok, false);
    assert.equal(model.validateAttendanceTransition(records, 'e2', 'out', '2026-10-26T09:00:00.000Z').ok, false);
    assert.equal(model.validateAttendanceTransition(records, 'e1', 'out', '2026-10-26T09:00:00.000Z').shiftId, 's1');
});

test('authoritative shop mode overrides a stale legacy restaurant add-on', () => {
    assert.equal(model.businessType('shop', { businessType: 'restaurant', features: { restaurant: true } }), 'shop');
    assert.equal(model.businessType('restaurant', { features: { restaurant: false } }), 'restaurant');
    assert.equal(model.businessType(null, { features: { restaurant: true } }), 'restaurant');
    assert.equal(model.businessType(null, { features: {} }), 'shop');
});

test('restaurant menu sections preserve configured ids and order while adopting legacy product categories', () => {
    const sections = model.menuSections({
        restaurantMenuSections: [
            { id: 'drinks', name: 'مشروبات', order: 2, icon: '☕', image: 'https://cdn.example.test/drinks.webp' },
            { id: 'mains', name: 'أطباق رئيسية', order: 0, icon: 'javascript:bad()', image: 'file:///private.png' }
        ]
    }, [
        { category: 'حلويات' },
        { type: 'أطباق رئيسية' }
    ]);
    assert.deepEqual(sections.map(section => section.name), ['أطباق رئيسية', 'مشروبات', 'حلويات']);
    assert.equal(sections[0].id, 'mains');
    assert.equal(sections[2].id, 'legacy-حلويات');
    assert.equal(sections[0].icon, '');
    assert.equal(sections[0].image, '');
    assert.equal(sections[1].icon, '☕');
    assert.equal(sections[1].image, 'https://cdn.example.test/drinks.webp');
});

test('Node VM config adapter saves ordered menu sections without persisting business mode', async () => {
    const { sandbox, writes } = appHarness();
    vm.runInContext(`
        currentUser = { username: 'admin', role: 'admin' };
        storeConfig = { features: { tax: false }, restaurantMenuSections: [{ id: 'mains', name: 'رئيسية', order: 0 }] };
        products = [{ id: 'tea', category: 'مشروبات', variants: [] }];
    `, sandbox);
    await new Promise((resolve, reject) => {
        sandbox.saveMenuSections([
            { id: 'drinks', name: 'مشروبات', order: 0 },
            { id: 'mains', name: 'رئيسية', order: 1 }
        ], resolve, reject);
    });
    const saved = writes.find(write => write.name === 'orders').record;
    assert.deepEqual(JSON.parse(JSON.stringify(saved.restaurantMenuSections)), [
        { id: 'drinks', name: 'مشروبات', order: 0, icon: '', image: '' },
        { id: 'mains', name: 'رئيسية', order: 1, icon: '', image: '' }
    ]);
    assert.equal(Object.hasOwn(saved, 'businessType'), false);
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.getMenuSections())).map(section => section.name), ['مشروبات', 'رئيسية']);
});

test('restaurant worker cannot switch to restricted pages even through direct calls', () => {
    const { sandbox } = appHarness();
    vm.runInContext(`
        currentUser = { username: 'worker', role: 'worker' };
        licensedBusinessType = 'restaurant';
        switchPage('reports');
    `, sandbox);
    assert.equal(vm.runInContext('currentPage', sandbox), 'sales');
});

test('restaurant workers are blocked from restricted shortcuts in restaurant mode', () => {
    const { sandbox } = appHarness();
    vm.runInContext(`
        currentUser = { username: 'worker', role: 'worker' };
        licensedBusinessType = 'restaurant';
        runShortcutAction('page-settings');
    `, sandbox);
    assert.equal(vm.runInContext('currentPage', sandbox), 'sales');
});

test('a standard burger with no configured color selector resolves directly to its actual variant', () => {
    const burger = { id: 'burger', variants: [{ color: 'افتراضي', size: 'حصة', price: 39, stock: 8 }] };
    const selection = model.foodSelection(burger);
    assert.equal(selection.kind, 'direct');
    assert.equal(selection.choice.index, 0);
    assert.equal(selection.choice.variant, burger.variants[0]);
});

test('a late menu save cannot insert a prior store item into the newly active store', async () => {
    const { sandbox } = appHarness();
    sandbox.currentUser = { role: 'admin' };
    sandbox.storeSessionId = 1;
    sandbox.products = [{ id: 'old-food', name: 'Old store food', variants: [] }];
    let completed = false;
    sandbox.saveRestaurantMenuProduct({ id: 'old-food', name: 'Edited old food' }, () => { completed = true; });
    sandbox.storeSessionId = 2;
    sandbox.products = [{ id: 'new-food', name: 'New store food' }];
    await Promise.resolve();
    assert.deepEqual(sandbox.products.map(p => p.id), ['new-food']);
    assert.equal(completed, false);
});

test('food portions are shown only for explicit distinct portion labels', () => {
    const portions = model.foodSelection({ variants: [
        { color: 'افتراضي', size: 'صغير', price: 20, stock: 3 },
        { color: 'افتراضي', size: 'كبير', price: 29, stock: 3 }
    ] });
    assert.equal(portions.kind, 'portions');
    assert.deepEqual(portions.choices.map(choice => choice.label), ['صغير', 'كبير']);
    assert.equal(model.foodSelection({ variants: [
        { color: 'أحمر', size: 'افتراضي', stock: 2 },
        { color: 'أزرق', size: 'افتراضي', stock: 2 }
    ] }).kind, 'configuration-required');
});

test('Node VM sales adapter directly adds a no-color burger and retains retail color choice behavior', () => {
    const { sandbox, elements } = appHarness();
    vm.runInContext(`
        products = [{ id: 'burger', name: 'برغر', variants: [{ color: 'افتراضي', size: 'حصة', price: 39, cost: 12, stock: 5 }] }];
        licensedBusinessType = 'restaurant';
        openVariantModal('burger');
    `, sandbox);
    assert.equal(sandbox.window.__renderedCart.length, 1);
    assert.equal(sandbox.window.__renderedCart[0].name, 'برغر');
    assert.equal(sandbox.window.__renderedCart[0].color, 'افتراضي');
    assert.equal(sandbox.document.getElementById('variantColors').innerHTML, '');
    assert.equal(sandbox.document.getElementById('variantModal').style.display, undefined);

    vm.runInContext(`
        products = [{ id: 'shirt', name: 'قميص', colors: [{ name: 'أحمر', hex: '#f00' }, { name: 'أزرق', hex: '#00f' }], variants: [
            { color: 'أحمر', size: 'M', price: 20, stock: 2 },
            { color: 'أزرق', size: 'M', price: 20, stock: 2 }
        ] }];
        licensedBusinessType = 'shop';
        openVariantModal('shirt');
    `, sandbox);
    assert.match(sandbox.document.getElementById('variantColors').innerHTML, /data-color="أحمر"/);
    assert.match(sandbox.document.getElementById('variantColors').innerHTML, /data-color="أزرق"/);
    assert.equal(sandbox.document.getElementById('addToCartFromModal').disabled, true);
});

test('login and sidebar version labels are sourced from package version', () => {
    const { sandbox, elements } = appHarness();
    vm.runInContext('showLogin();', sandbox);
    assert.equal(elements.get('loginAppVersion').textContent, 'الإصدار v4.0.10');
    assert.equal(elements.get('appVersion').textContent, 'v4.0.10');
});

test('restaurant workers cannot access financial report aggregates through direct APIs', () => {
    const { sandbox } = appHarness();
    sandbox.document.getElementById('todaySales').textContent = 'locked';
    vm.runInContext(`
        currentUser = { username: 'worker', role: 'worker' };
        licensedBusinessType = 'restaurant';
        bills = [{
            total: 125,
            createdAt: { toDate: function () { return new Date(); } },
            items: [{ price: 25, qty: 1, total: 25 }]
        }];
        updateReports();
    `, sandbox);
    assert.equal(sandbox.document.getElementById('todaySales').textContent, 'locked');
});

test('fixture is deterministic and tags every generated payload as demo data', () => {
    const fixture = model.createRestaurantDemoFixture();
    assert.equal(fixture.products.length, 18);
    assert.equal(fixture.records.filter(record => record.recordType === 'restaurant-offer').length, 3);
    assert.ok(fixture.products.concat(fixture.records).every(item => item.demoDataVersion === model.DEMO_VERSION));
});

test('seed manifest is write-ready without persisting an application mode', () => {
    const manifest = model.buildRestaurantDemo('2026-10-26T08:00:00.000Z');
    assert.equal(manifest.featureSettings.businessType, undefined);
    assert.deepEqual(Object.keys(manifest.products[0]).sort(), ['data', 'id']);
    assert.equal(manifest.records.some(item => item.data.recordType === 'restaurant-attendance'), true);
    const customer = manifest.records.find(item => item.data.recordType === 'customer').data;
    const loyalty = manifest.records.find(item => item.data.recordType === 'loyalty-txn').data;
    assert.equal(customer.phone, '');
    assert.equal(customer.messagingExcluded, true);
    assert.equal(loyalty.customer.phone, '');
    assert.equal(loyalty.customer.name, customer.name);
    assert.equal(manifest.products.every(item => item.data.category === item.data.type), true);
});

test('table configuration supports add/edit/archive/delete with occupancy guards', async () => {
    const { sandbox } = appHarness();
    vm.runInContext(`
        currentUser = { username: 'admin', role: 'admin' };
        localStorage.setItem(tableCountKey(), '2');
    `, sandbox);
    await new Promise((resolve, reject) => sandbox.createRestaurantTable({ name: 'ركن العائلة' }, resolve, reject));
    assert.equal(vm.runInContext('getRestaurantTables(false).length', sandbox), 3);
    assert.equal(vm.runInContext('getRestaurantTables(false)[2].name', sandbox), 'ركن العائلة');
    await new Promise((resolve, reject) => sandbox.updateRestaurantTable(3, { name: 'VIP' }, resolve, reject));
    assert.equal(vm.runInContext('getRestaurantTables(false)[2].name', sandbox), 'VIP');
    vm.runInContext(`heldSales = [{ id: 'held-1', table: 3, cart: [{ qty: 1, price: 10 }] }];`, sandbox);
    await assert.rejects(() => new Promise((resolve, reject) => sandbox.archiveRestaurantTable(3, true, resolve, reject)), /مفتوح|محفوظ/);
    vm.runInContext(`heldSales = [];`, sandbox);
    await new Promise((resolve, reject) => sandbox.archiveRestaurantTable(3, true, resolve, reject));
    assert.equal(vm.runInContext('findRestaurantTable(3, true).archived', sandbox), true);
    await new Promise((resolve, reject) => sandbox.deleteRestaurantTable(3, resolve, reject));
    assert.equal(vm.runInContext('findRestaurantTable(3, true)', sandbox), null);
});

test('restaurant workers cannot mutate table configuration', async () => {
    const { sandbox } = appHarness();
    vm.runInContext(`currentUser = { username: 'worker', role: 'worker' };`, sandbox);
    await assert.rejects(() => new Promise((resolve, reject) => sandbox.createRestaurantTable({ name: 'غير مسموح' }, resolve, reject)), /للمدير فقط/);
    assert.equal(vm.runInContext('getRestaurantTables(true).length', sandbox), 0);
});

async function sharedHarness(options = {}) {
    const harness = appHarness();
    const { sandbox } = harness;
    const calls = [], remoteHolds = new Map(), paid = new Map();
    let loseCheckout = !!options.loseCheckout;
    sandbox.currentUser = { username: 'admin-fixture', role: 'admin' };
    sandbox.licensedBusinessType = 'restaurant';
    sandbox.licenseValid = true;
    sandbox.products = [{ id: 'burger', name: 'برغر اختبار', variants: [{ color: '', size: '100g', price: 20, cost: 9, stock: 5 }] }];
    Object.assign(sandbox.sharedRestaurantAdapters, {
        config: async () => ({ configured: true, revision: 3, config: { features: { tax: false }, taxPercent: 16, taxIncluded: false, restaurantMenuSections: [] } }),
        tables: async () => ({ configured: true, revision: 2, tables: [{ id: 71, name: 'طاولة الاختبار', archived: false }] }),
        orders: async (method, payload) => {
            if (method === 'GET') return { holds: Array.from(remoteHolds.values()) };
            calls.push(JSON.parse(JSON.stringify(payload)));
            if (payload.action === 'hold') {
                const existing = remoteHolds.get(payload.holdId);
                if (existing && existing.revision !== payload.revision) {
                    const error = new Error('Revision conflict'); error.status = 409; throw error;
                }
                const hold = {
                    id: payload.holdId, revision: payload.revision + 1, status: 'open',
                    items: payload.items, service: payload.service, note: payload.note, discount: payload.discount, offerId: payload.offerId,
                    createdAtIso: '2026-01-01T10:00:00Z'
                };
                remoteHolds.set(hold.id, hold);
                return { ok: true, hold };
            }
            if (payload.action === 'quote') return { ok: true, quoteHash: 'fixture-quote', quote: { total: 40 } };
            if (payload.action === 'checkout') {
                if (!paid.has(payload.requestId)) {
                    paid.set(payload.requestId, {
                        billNumber: 'POS-M-' + payload.holdId, total: 40, paymentMethod: payload.paymentMethod,
                        items: [], restaurantOrder: remoteHolds.get(payload.holdId).service
                    });
                    remoteHolds.delete(payload.holdId);
                }
                if (loseCheckout) {
                    loseCheckout = false;
                    const error = new Error('Committed response lost'); error.status = 503; throw error;
                }
                return { ok: true, bill: paid.get(payload.requestId) };
            }
            throw new Error('Unexpected shared fixture action');
        }
    });
    vm.runInContext("showReceipt = function (bill) { window.fixtureReceipt = bill; }; printReceipt = function () { window.fixturePrints = (window.fixturePrints || 0) + 1; }; setRestaurantService({ type: 'takeaway' });", sandbox);
    sandbox.sharedRestaurantClient.configure(sandbox.sharedRestaurantAdapters, 'shared-fixture');
    await sandbox.sharedRestaurantClient.refresh();
    return { ...harness, calls, remoteHolds, paid };
}

test('shared desktop holds preserve local tickets and use canonical configuration and monotonic table IDs', async () => {
    const { sandbox, storage, calls, elements } = await sharedHarness();
    const local = JSON.stringify([{ id: 'local-ticket', cart: [{ productId: 'burger', qty: 1 }] }]);
    storage.set('ada_pos_held_test', local);
    sandbox.storeConfig = { features: { tax: true }, taxPercent: 99 };
    assert.equal(sandbox.getStoreConfig().features.tax, false);
    assert.equal(sandbox.getRestaurantTables(false)[0].id, 71);
    sandbox.addVariantToCart(sandbox.products[0], '', '100g', 2);
    sandbox.document.getElementById('discountInput').value = '5';
    sandbox.document.getElementById('discountType').value = 'fixed';
    sandbox.holdSale();
    await new Promise(setImmediate);
    assert.equal(calls.filter(call => call.action === 'hold').length, 1);
    assert.equal(calls[0].discount.value, 5);
    assert.equal(sandbox.heldSales.length, 1);
    assert.equal(sandbox.cart.length, 0);
    assert.equal(storage.get('ada_pos_held_test'), local);
    assert.equal(sandbox.heldSales[0].shared, true);
    sandbox.resumeHeld(sandbox.heldSales[0].id);
    assert.equal(sandbox.cart[0].qty, 2);
    assert.equal(sandbox.activeRestaurantHeldRevision, 1);
    assert.equal(elements.get('discountInput').value, 5);
});

test('shared desktop checkout locks uncertain outcomes and retries one committed charge without a local write', async () => {
    const { sandbox, elements, calls, paid, writes } = await sharedHarness({ loseCheckout: true });
    sandbox.addVariantToCart(sandbox.products[0], '', '100g', 2);
    sandbox.checkout();
    await new Promise(setImmediate);
    assert.match(elements.get('confirmMessage').textContent, /40.00/);
    const confirmPayment = sandbox._confirmCb;
    sandbox._closeConfirm(true);
    confirmPayment();
    await new Promise(setImmediate);
    assert.equal(paid.size, 1);
    assert.equal(sandbox.checkoutInFlight, true);
    assert.equal(sandbox._confirmLocked, true);
    sandbox._closeConfirm();
    assert.equal(elements.get('confirmModal').style.display, 'flex');
    const retry = sandbox._confirmCb;
    sandbox._closeConfirm(true);
    retry();
    await new Promise(setImmediate);
    const checkouts = calls.filter(call => call.action === 'checkout');
    assert.equal(checkouts[0].requestId, checkouts[1].requestId);
    assert.equal(paid.size, 1);
    assert.equal(sandbox.window.fixturePrints, 1);
    assert.equal(sandbox.window.fixtureReceipt.total, 40);
    assert.equal(sandbox.checkoutInFlight, false);
    assert.equal(sandbox.cart.length, 0);
    assert.equal(writes.length, 0);
});

test('shared desktop preserves the selected offer through hold and resume and clears it only explicitly', async () => {
    const { sandbox, calls } = await sharedHarness();
    sandbox.restaurantRecords = [{ id: 'offer-one', recordType: 'restaurant-offer', name: 'عرض الاختبار', discountType: 'percent', discountValue: 20, minQty: 2, enabled: true }];
    sandbox.addVariantToCart(sandbox.products[0], '', '100g', 2);
    sandbox.activeRestaurantOffer = { id: 'offer-one' };
    sandbox.holdSale();
    await new Promise(setImmediate);
    assert.equal(calls[0].offerId, 'offer-one');
    assert.equal(calls[0].discount.value, 8);
    sandbox.resumeHeld(sandbox.heldSales[0].id);
    assert.equal(sandbox.activeRestaurantOffer.id, 'offer-one');
    assert.equal(sandbox.sharedTicketIntent().offerId, 'offer-one');
    sandbox.resetActiveRestaurantOffer();
    assert.equal(sandbox.sharedTicketIntent().offerId, null);
});

test('a missing or invalid shared offer cannot silently become an undiscounted replacement hold', async () => {
    const { sandbox, calls } = await sharedHarness();
    sandbox.addVariantToCart(sandbox.products[0], '', '100g', 1);
    sandbox.activeRestaurantOffer = { id: 'offer-not-loaded' };
    sandbox.renderCart();
    assert.equal(sandbox.activeRestaurantOffer.id, 'offer-not-loaded');
    sandbox.holdSale();
    await new Promise(setImmediate);
    assert.equal(calls.length, 0);
    assert.equal(sandbox.activeRestaurantOffer.id, 'offer-not-loaded');
    assert.equal(sandbox.cart.length, 1);
});

test('shared desktop rejects unsupported benefits without silently dropping them', async () => {
    const { sandbox, elements, calls } = await sharedHarness();
    sandbox.addVariantToCart(sandbox.products[0], '', '100g', 1);
    sandbox.pendingRedeem = { points: 10, value: 5 };
    sandbox.holdSale();
    await new Promise(setImmediate);
    assert.equal(calls.length, 0);
    assert.equal(sandbox.pendingRedeem.points, 10);
    assert.equal(sandbox.cart.length, 1);
    assert.match(elements.get('confirmMessage').textContent, /غير مدعوم/);
});

test('queued shared operations cannot write into a newly active session', async () => {
    const { sandbox } = await sharedHarness();
    let invoked = false;
    sandbox.runSharedRestaurantWrite(async () => { invoked = true; return { ok: true }; }, () => {});
    sandbox.storeSessionId++;
    await new Promise(setImmediate);
    assert.equal(invoked, false);
});

test('protected historical costs never fall back to the current product cost or display invented margins', async () => {
    const { sandbox } = await sharedHarness();
    const item = { productId: 'burger', color: '', size: '100g', historicalCostProtected: true, cost: 0 };
    assert.equal(sandbox.itemUnitCost(item), 0);
    assert.equal(Number.isNaN(sandbox.itemUnitCost({ ...item, cost: null })), true);
    assert.equal(sandbox.profitLabel(NaN), 'غير متاح');
});

test('explicit legacy ticket import preserves its original and rejects already billed tickets', async () => {
    const { sandbox, storage, calls, elements } = await sharedHarness();
    const original = JSON.stringify([{ id: 'legacy-paid', cart: [{ productId: 'burger', color: '', size: '100g', qty: 1 }], restaurantOrder: { type: 'takeaway' } }]);
    sandbox.legacyRestaurantHeldSales = JSON.parse(original);
    storage.set('ada_pos_held_test', original);
    sandbox.db.collection = () => ({ doc: () => ({ get: async () => ({ exists: true }) }) });
    sandbox.importLegacyRestaurantHeld(0);
    const confirm = sandbox._confirmCb;
    sandbox._closeConfirm(true);
    confirm();
    await new Promise(setImmediate);
    assert.equal(calls.length, 0);
    assert.equal(storage.get('ada_pos_held_test'), original);
    assert.match(elements.get('confirmMessage').textContent, /محفوظة بالفعل كفاتورة/);
});

test('repeating explicit legacy import after a restart cannot create a second shared ticket', async () => {
    const first = await sharedHarness();
    const original = JSON.stringify([{ id: 'legacy-unpaid', cart: [{ productId: 'burger', color: '', size: '100g', qty: 1 }], restaurantOrder: { type: 'takeaway' } }]);
    first.sandbox.legacyRestaurantHeldSales = JSON.parse(original);
    first.storage.set('ada_pos_held_test', original);
    first.sandbox.db.collection = () => ({ doc: () => ({ get: async () => ({ exists: false }) }) });
    first.sandbox.importLegacyRestaurantHeld(0);
    let confirm = first.sandbox._confirmCb;
    first.sandbox._closeConfirm(true);
    confirm();
    await new Promise(setImmediate);
    assert.equal(first.remoteHolds.size, 1);
    const second = await sharedHarness();
    Object.assign(second.sandbox.sharedRestaurantAdapters, { orders: first.sandbox.sharedRestaurantAdapters.orders });
    for (const [key, value] of first.storage) second.storage.set(key, value);
    second.sandbox.legacyRestaurantHeldSales = JSON.parse(original);
    second.sandbox.db.collection = () => ({ doc: () => ({ get: async () => ({ exists: false }) }) });
    second.sandbox.importLegacyRestaurantHeld(0);
    confirm = second.sandbox._confirmCb;
    second.sandbox._closeConfirm(true);
    confirm();
    await new Promise(setImmediate);
    const imports = first.calls.filter(call => call.action === 'hold');
    assert.equal(imports.length, 2);
    assert.equal(imports[0].holdId, imports[1].holdId);
    assert.equal(first.remoteHolds.size, 1);
    assert.equal(first.storage.get('ada_pos_held_test'), original);
    assert.equal(second.storage.get('ada_pos_held_test'), original);
});
