const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/renderer/restaurant-model.js');

test('food selection keeps all configured sizes when only one size is in stock', () => {
    const product = {
        variants: [
            { color: 'افتراضي', size: 'صغير', stock: 0, price: 10 },
            { color: 'افتراضي', size: 'وسط', stock: 2, price: 15 },
            { color: 'افتراضي', size: 'كبير', stock: 0, price: 20 }
        ]
    };
    const selection = model.foodSelection(product);
    assert.equal(selection.kind, 'portions');
    assert.deepEqual(selection.choices.map(function (choice) { return choice.index; }), [0, 1, 2]);
    assert.deepEqual(selection.choices.map(function (choice) { return choice.variant.stock; }), [0, 2, 0]);
});

test('food selection never auto-selects direct mode when all variants are out of stock', () => {
    const product = {
        variants: [
            { color: 'افتراضي', size: '100غ', stock: 0, price: 25 },
            { color: 'افتراضي', size: '150غ', stock: 0, price: 30 },
            { color: 'افتراضي', size: '300غ', stock: 0, price: 45 }
        ]
    };
    const selection = model.foodSelection(product);
    assert.notEqual(selection.kind, 'direct');
    assert.equal(selection.choices.length, 3);
});

test('buildFoodVariants preserves untouched non-default variants and metadata fields', () => {
    const existing = [
        { color: 'افتراضي', size: 'صغير', stock: 4, price: 10, cost: 3, sku: 'small-default' },
        { color: 'أحمر', size: 'L', stock: 5, price: 50, cost: 20, barcode: 'retail-1' }
    ];
    const rows = [{ sourceIndex: 0, label: 'وسط', price: '15', cost: '6', stock: '7' }];
    const result = model.buildFoodVariants(existing, rows, [0]);
    assert.equal(result.ok, true);
    assert.equal(result.variants.length, 2);
    const preserved = result.variants.find((variant) => variant.color === 'أحمر');
    const edited = result.variants.find((variant) => variant.color === 'افتراضي');
    assert.equal(preserved.barcode, 'retail-1');
    assert.equal(edited.sku, 'small-default');
    assert.equal(edited.size, 'وسط');
    assert.equal(edited.price, 15);
    assert.equal(edited.stock, 7);
});

test('buildFoodVariants rejects duplicate size labels after normalization', () => {
    const duplicateLabels = model.buildFoodVariants([], [
        { label: '100غ', price: '12', cost: '4', stock: '5' },
        { label: ' 100غ ', price: '15', cost: '5', stock: '3' }
    ], []);
    assert.equal(duplicateLabels.ok, false);
    assert.match(duplicateLabels.errors.join(' '), /مكرر/);
});

test('buildFoodVariants enforces finite positive price and integer non-negative stock', () => {
    const invalidPrice = model.buildFoodVariants([], [
        { label: '150غ', price: '0', cost: '1', stock: '2' }
    ], []);
    assert.equal(invalidPrice.ok, false);
    assert.match(invalidPrice.errors.join(' '), /أكبر من صفر/);

    const invalidStock = model.buildFoodVariants([], [
        { label: '300غ', price: '22', cost: '4', stock: '2.5' }
    ], []);
    assert.equal(invalidStock.ok, false);
    assert.match(invalidStock.errors.join(' '), /رقمًا صحيحًا/);
});

test('preserved retail variants never become food portions or influence food stock', () => {
    const retail = { color: 'أحمر', size: 'L', price: 1, stock: 100 };
    const food = { color: 'افتراضي', size: 'صغير', price: 10, stock: 2 };
    const selection = model.foodSelection({ variants: [retail, food] });
    assert.equal(selection.kind, 'direct');
    assert.equal(selection.choice.index, 1);
    assert.equal(selection.choice.variant, food);
    assert.equal(model.foodSelection({ variants: [retail] }).kind, 'configuration-required');
    assert.equal(model.foodSelection({ variants: [retail, { ...food, stock: 0 }] }).kind, 'configuration-required');
});

test('editing numbers preserves original blank-color and whitespace size inventory keys', () => {
    const existing = [{ color: '', size: ' صغير ', price: 10, cost: 2, stock: 3, sku: 'keep' }];
    const result = model.buildFoodVariants(existing, [{ sourceIndex: 0, label: 'صغير', price: 12, cost: 2, stock: 3 }], [0]);
    assert.equal(result.ok, true);
    assert.equal(result.variants[0].color, '');
    assert.equal(result.variants[0].size, ' صغير ');
    assert.equal(result.variants[0].sku, 'keep');
});
