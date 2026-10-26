const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const model = require('../src/renderer/restaurant-model.js');

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

test('fixture is deterministic and tags every generated payload as demo data', () => {
    const fixture = model.createRestaurantDemoFixture();
    assert.equal(fixture.products.length, 18);
    assert.equal(fixture.records.filter(record => record.recordType === 'restaurant-offer').length, 3);
    assert.ok(fixture.products.concat(fixture.records).every(item => item.demoDataVersion === model.DEMO_VERSION));
});

test('seed manifest is write-ready and preserves the restaurant feature mode', () => {
    const manifest = model.buildRestaurantDemo('2026-10-26T08:00:00.000Z');
    assert.equal(manifest.featureSettings.restaurant, true);
    assert.equal(manifest.featureSettings.businessType, 'restaurant');
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
