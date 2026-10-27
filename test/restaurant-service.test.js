const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRestaurantService: validate } = require('../src/renderer/restaurant-service');

test('dine-in requires a real table and takeaway drops delivery-only data', () => {
    for (const table of ['', 0, -1, 1.5, 61]) assert.equal(validate({ type: 'dinein', table }).ok, false);
    assert.equal(validate({ type: 'dinein', table: '3' }).order.table, 3);
    const takeaway = validate({ type: 'takeaway', address: 'old address', deliveryFee: 7 });
    assert.equal(takeaway.order.deliveryFee, 0);
    assert.equal(takeaway.order.address, '');
    assert.equal(validate({ type: 'unknown' }).ok, false);
});

test('delivery requires recipient details and finite non-negative two-decimal fees', () => {
    const delivery = { type: 'delivery', customerName: 'Demo', phone: 'fixture-only', address: 'Test address', deliveryFee: 5.25 };
    assert.equal(validate(delivery).ok, true);
    for (const field of ['customerName', 'phone', 'address']) assert.equal(validate({ ...delivery, [field]: ' ' }).ok, false);
    for (const deliveryFee of [-1, Infinity, 'invalid', 1.001]) assert.equal(validate({ ...delivery, deliveryFee }).ok, false);
    assert.equal(validate({ ...delivery, deliveryFee: 0 }).order.deliveryFee, 0);
});
