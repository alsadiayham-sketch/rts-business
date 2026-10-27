const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../src/renderer/restaurant-model.js');

function appHarness() {
    const elements = new Map();
    const writes = [];
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
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        navigator: { onLine: true }, setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
        require(request) {
            if (request === './restaurant-service') return require('../src/renderer/restaurant-service');
            if (request === './firebase-config') return {
                db, rawDb: {}, firebase, storage: {}, setProjectId() {}, getProjectId() { return 'test'; }, isD1() { return false; },
                registerD1Tenant() {}, registerD1MessagingBackend() {}, isMessagingConfigured() { return false; },
                messagingGetStatus() {}, messagingPreviewAudience() {}, messagingRequestCredits() {}, messagingSend() {}, messagingUpdatePricing() {},
                serverTimestamp() {}, posAuthenticate() {}, configurePosAuth() { return false; }, publishOwnerTelemetry() {}
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
    return { sandbox, elements, writes };
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
            { id: 'drinks', name: 'مشروبات', order: 2 },
            { id: 'mains', name: 'أطباق رئيسية', order: 0 }
        ]
    }, [
        { category: 'حلويات' },
        { type: 'أطباق رئيسية' }
    ]);
    assert.deepEqual(sections.map(section => section.name), ['أطباق رئيسية', 'مشروبات', 'حلويات']);
    assert.equal(sections[0].id, 'mains');
    assert.equal(sections[2].id, 'legacy-حلويات');
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
        { id: 'drinks', name: 'مشروبات', order: 0 },
        { id: 'mains', name: 'رئيسية', order: 1 }
    ]);
    assert.equal(Object.hasOwn(saved, 'businessType'), false);
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.getMenuSections())).map(section => section.name), ['مشروبات', 'رئيسية']);
});

test('a standard burger with no configured color selector resolves directly to its actual variant', () => {
    const burger = { id: 'burger', variants: [{ color: 'افتراضي', size: 'حصة', price: 39, stock: 8 }] };
    const selection = model.foodSelection(burger);
    assert.equal(selection.kind, 'direct');
    assert.equal(selection.choice.index, 0);
    assert.equal(selection.choice.variant, burger.variants[0]);
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
