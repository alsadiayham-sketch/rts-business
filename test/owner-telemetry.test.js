var assert = require('node:assert/strict');
var test = require('node:test');
var telemetry = require('../src/renderer/owner-telemetry');

function localTime(year, month, day, hour) {
    return new Date(year, month - 1, day, hour || 12).getTime();
}

test('buildOwnerTelemetryPayload emits only the fixed aggregate schema', function () {
    var now = localTime(2026, 10, 11);
    var payload = telemetry.buildOwnerTelemetryPayload({
        generatedAt: now,
        appVersion: '4.0.8',
        products: [
            { name: 'Private product', variants: [{ stock: 3 }, { stock: 10 }] },
            { name: 'Another product', variants: [{ stock: 0 }] }
        ],
        bills: [
            { total: 120.5, createdAtIso: new Date(now).toISOString(), customer: { name: 'Customer', phone: '050' } },
            { total: 79.5, createdAtIso: new Date(now).toISOString(), note: 'Private note' },
            { total: 999, createdAtIso: new Date(now - 86400000).toISOString() },
            { recordType: 'deposit', total: 999, createdAtIso: new Date(now).toISOString() }
        ],
        returnRecords: [
            { refund: 25.25, originalBill: 'Private bill', createdAtIso: new Date(now).toISOString() },
            { refund: 50, createdAtIso: new Date(now - 86400000).toISOString() }
        ],
        damageRecords: [
            { qty: 2, reason: 'Private reason', createdAtIso: new Date(now).toISOString() }
        ],
        lowStockThreshold: 3,
        activeTerminal: true,
        online: true,
        auditCounts: { auth: 2, sales: 3, unexpected: 99 }
    });

    assert.deepEqual(payload, {
        generatedAt: new Date(now).toISOString(),
        appVersion: '4.0.8',
        metrics: {
            terminalCount: 1, activeTerminalCount: 1, pendingSyncCount: 0, failedSyncCount: 0,
            databaseHealthy: true, syncHealthy: true, backupHealthy: true,
            salesToday: 200, ordersToday: 2, averageOrderValue: 100, returnsToday: 1,
            refundsToday: 25.25, lowStockItems: 2, inventoryUnits: 13, damageUnitsToday: 2
        },
        eventCounters: {
            auditEvents: 5, warningEvents: 0, errorEvents: 0, loginsSucceeded: 2, loginsFailed: 0,
            syncsSucceeded: 1, syncsFailed: 0, backupsSucceeded: 0, backupsFailed: 0,
            salesCompleted: 3, salesVoided: 0, returnsCompleted: 0, inventoryAdjustments: 0
        }
    });
    assert.equal(JSON.stringify(payload).includes('Customer'), false);
    assert.equal(JSON.stringify(payload).includes('Private'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'tenant'), false);
});

test('audit counts use fixed categories and only include the current local day', function () {
    var now = localTime(2026, 10, 11);
    var counts = telemetry.auditCountsForEvents([
        { type: 'login', timestamp: now },
        { type: 'sale', timestamp: now },
        { type: 'stock_add', timestamp: now, details: { productName: 'Private' } },
        { type: 'unknown-event', timestamp: now, user: 'Private user' },
        { type: 'return', timestamp: now - 86400000 }
    ], now);

    assert.deepEqual(counts, {
        auth: 1,
        sales: 1,
        returns: 0,
        inventory: 1,
        cash: 0,
        operations: 1
    });
});

test('sanitization removes unknown fields and rejects non-version strings', function () {
    var payload = telemetry.sanitizeOwnerTelemetryPayload({
        generatedAt: -1,
        appVersion: 'customer name',
        salesTodayNis: '12.345',
        activeTerminal: 1,
        online: 0,
        customer: { name: 'Private' },
        auditCounts: { sales: 2, customerNames: 5 }
    });

    assert.deepEqual(payload, {
        generatedAt: payload.generatedAt,
        appVersion: '0.0.0',
        metrics: {
            terminalCount: 1, activeTerminalCount: 1, pendingSyncCount: 0, failedSyncCount: 0,
            databaseHealthy: true, syncHealthy: false, backupHealthy: true,
            salesToday: 12.35, ordersToday: 0, averageOrderValue: 0, returnsToday: 0,
            refundsToday: 0, lowStockItems: 0, inventoryUnits: 0, damageUnitsToday: 0
        },
        eventCounters: {
            auditEvents: 2, warningEvents: 0, errorEvents: 0, loginsSucceeded: 0, loginsFailed: 0,
            syncsSucceeded: 0, syncsFailed: 1, backupsSucceeded: 0, backupsFailed: 0,
            salesCompleted: 2, salesVoided: 0, returnsCompleted: 0, inventoryAdjustments: 0
        }
    });
});
