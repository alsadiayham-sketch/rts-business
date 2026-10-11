// Privacy boundary for owner telemetry. This module only emits a fixed schema.
(function () {
    'use strict';

    var AUDIT_CATEGORIES = ['auth', 'sales', 'returns', 'inventory', 'cash', 'operations'];
    var MAX_COUNT = 1000000000;
    var MAX_AMOUNT = 1000000000000;
    var SAFE_VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:[-+][0-9A-Za-z.-]{1,32})?$/;

    function nonNegativeNumber(value, max) {
        value = Number(value);
        if (!isFinite(value) || value < 0) return 0;
        return Math.min(value, max == null ? MAX_AMOUNT : max);
    }

    function wholeCount(value) {
        return Math.floor(nonNegativeNumber(value, MAX_COUNT));
    }

    function money(value) {
        return Math.round(nonNegativeNumber(value) * 100) / 100;
    }

    function emptyAuditCounts() {
        return {
            auth: 0,
            sales: 0,
            returns: 0,
            inventory: 0,
            cash: 0,
            operations: 0
        };
    }

    function cloneAuditCounts(counts) {
        var output = emptyAuditCounts();
        for (var i = 0; i < AUDIT_CATEGORIES.length; i++) {
            var category = AUDIT_CATEGORIES[i];
            output[category] = wholeCount(counts && counts[category]);
        }
        return output;
    }

    function mergeAuditCounts(first, second) {
        var output = emptyAuditCounts();
        for (var i = 0; i < AUDIT_CATEGORIES.length; i++) {
            var category = AUDIT_CATEGORIES[i];
            output[category] = wholeCount((first && first[category]) || 0) + wholeCount((second && second[category]) || 0);
            output[category] = Math.min(output[category], MAX_COUNT);
        }
        return output;
    }

    function subtractAuditCounts(total, subtract) {
        var output = emptyAuditCounts();
        for (var i = 0; i < AUDIT_CATEGORIES.length; i++) {
            var category = AUDIT_CATEGORIES[i];
            output[category] = Math.max(0, wholeCount(total && total[category]) - wholeCount(subtract && subtract[category]));
        }
        return output;
    }

    function auditCategory(type) {
        switch (String(type || '').toLowerCase()) {
            case 'login':
            case 'logout':
                return 'auth';
            case 'sale':
                return 'sales';
            case 'return':
                return 'returns';
            case 'stock_add':
            case 'damage':
            case 'stocktake':
                return 'inventory';
            case 'withdrawal':
            case 'deposit':
            case 'register_set':
            case 'day_close':
            case 'debt-add':
            case 'debt-pay':
                return 'cash';
            default:
                return 'operations';
        }
    }

    function incrementAuditCount(counts, type) {
        counts = counts || emptyAuditCounts();
        var category = auditCategory(type);
        counts[category] = Math.min(MAX_COUNT, wholeCount(counts[category]) + 1);
        return counts;
    }

    function toMilliseconds(value) {
        if (value && typeof value.toDate === 'function') value = value.toDate();
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'number' && isFinite(value)) return value;
        if (typeof value === 'string') {
            var parsed = Date.parse(value);
            return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
    }

    function recordTimeMs(record) {
        record = record || {};
        return toMilliseconds(record.createdAt) ||
            toMilliseconds(record.timestamp) ||
            toMilliseconds(record.createdAtIso);
    }

    function isOnLocalDay(record, now) {
        var ms = recordTimeMs(record);
        if (!ms) return false;
        var date = new Date(ms);
        var today = new Date(now);
        return date.getFullYear() === today.getFullYear() &&
            date.getMonth() === today.getMonth() &&
            date.getDate() === today.getDate();
    }

    function localDayKey(now) {
        var date = new Date(now);
        return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
    }

    function auditCountsForEvents(events, now) {
        var counts = emptyAuditCounts();
        for (var i = 0; i < (events || []).length; i++) {
            var event = events[i] || {};
            if (isOnLocalDay(event, now)) incrementAuditCount(counts, event.type);
        }
        return counts;
    }

    function inventoryMetrics(products, lowStockThreshold) {
        var lowStockItems = 0;
        var inventoryUnits = 0;
        var threshold = wholeCount(lowStockThreshold);
        for (var i = 0; i < (products || []).length; i++) {
            var variants = (products[i] && products[i].variants) || [];
            for (var j = 0; j < variants.length; j++) {
                var stock = nonNegativeNumber(variants[j] && variants[j].stock, MAX_COUNT);
                inventoryUnits += stock;
                if (stock <= threshold) lowStockItems++;
            }
        }
        return {
            lowStockItems: wholeCount(lowStockItems),
            inventoryUnits: wholeCount(inventoryUnits)
        };
    }

    function sanitizeOwnerTelemetryPayload(payload) {
        payload = payload || {};
        var generatedAt = toMilliseconds(payload.generatedAt) || Date.now();
        var appVersion = String(payload.appVersion || '');
        if (!SAFE_VERSION.test(appVersion)) appVersion = '0.0.0';
        var auditCounts = cloneAuditCounts(payload.auditCounts);
        var auditEvents = 0;
        for (var i = 0; i < AUDIT_CATEGORIES.length; i++) {
            auditEvents = Math.min(MAX_COUNT, auditEvents + auditCounts[AUDIT_CATEGORIES[i]]);
        }

        return {
            generatedAt: new Date(generatedAt).toISOString(),
            appVersion: appVersion,
            metrics: {
                terminalCount: 1,
                activeTerminalCount: payload.activeTerminal ? 1 : 0,
                pendingSyncCount: 0,
                failedSyncCount: 0,
                databaseHealthy: true,
                syncHealthy: !!payload.online,
                backupHealthy: true,
                salesToday: money(payload.salesTodayNis),
                ordersToday: wholeCount(payload.ordersToday),
                averageOrderValue: money(payload.averageOrderValueNis),
                returnsToday: wholeCount(payload.returnCountToday),
                refundsToday: money(payload.returnsTodayNis),
                lowStockItems: wholeCount(payload.lowStockItems),
                inventoryUnits: wholeCount(payload.inventoryUnits),
                damageUnitsToday: wholeCount(payload.damageUnitsToday)
            },
            eventCounters: {
                auditEvents: auditEvents,
                warningEvents: 0,
                errorEvents: 0,
                loginsSucceeded: auditCounts.auth,
                loginsFailed: 0,
                syncsSucceeded: payload.online ? 1 : 0,
                syncsFailed: payload.online ? 0 : 1,
                backupsSucceeded: 0,
                backupsFailed: 0,
                salesCompleted: auditCounts.sales,
                salesVoided: 0,
                returnsCompleted: auditCounts.returns,
                inventoryAdjustments: auditCounts.inventory
            }
        };
    }

    function buildOwnerTelemetryPayload(input) {
        input = input || {};
        var now = toMilliseconds(input.generatedAt) || Date.now();
        var salesTodayNis = 0;
        var ordersToday = 0;
        var returnsTodayNis = 0;
        var returnCountToday = 0;
        var damageUnitsToday = 0;
        var bills = input.bills || [];
        var returns = input.returnRecords || [];
        var damageRecords = input.damageRecords || [];

        for (var i = 0; i < bills.length; i++) {
            var bill = bills[i] || {};
            if (bill.recordType || !isOnLocalDay(bill, now)) continue;
            salesTodayNis += nonNegativeNumber(bill.total);
            ordersToday++;
        }
        for (var j = 0; j < returns.length; j++) {
            var returnRecord = returns[j] || {};
            if (!isOnLocalDay(returnRecord, now)) continue;
            var refund = returnRecord.refund;
            if (refund == null) refund = Math.max(0, -Number(returnRecord.net || 0));
            returnsTodayNis += nonNegativeNumber(refund);
            returnCountToday++;
        }
        for (var k = 0; k < damageRecords.length; k++) {
            var damage = damageRecords[k] || {};
            if (isOnLocalDay(damage, now)) damageUnitsToday += nonNegativeNumber(damage.qty, MAX_COUNT);
        }

        var inventory = inventoryMetrics(input.products, input.lowStockThreshold);
        var average = ordersToday ? salesTodayNis / ordersToday : 0;
        return sanitizeOwnerTelemetryPayload({
            generatedAt: now,
            appVersion: input.appVersion,
            salesTodayNis: salesTodayNis,
            ordersToday: ordersToday,
            averageOrderValueNis: average,
            returnsTodayNis: returnsTodayNis,
            returnCountToday: returnCountToday,
            lowStockItems: inventory.lowStockItems,
            inventoryUnits: inventory.inventoryUnits,
            damageUnitsToday: damageUnitsToday,
            activeTerminal: input.activeTerminal,
            online: input.online,
            auditCounts: input.auditCounts
        });
    }

    module.exports = {
        AUDIT_CATEGORIES: AUDIT_CATEGORIES.slice(),
        emptyAuditCounts: emptyAuditCounts,
        cloneAuditCounts: cloneAuditCounts,
        mergeAuditCounts: mergeAuditCounts,
        subtractAuditCounts: subtractAuditCounts,
        incrementAuditCount: incrementAuditCount,
        auditCountsForEvents: auditCountsForEvents,
        isOnLocalDay: isOnLocalDay,
        localDayKey: localDayKey,
        sanitizeOwnerTelemetryPayload: sanitizeOwnerTelemetryPayload,
        buildOwnerTelemetryPayload: buildOwnerTelemetryPayload
    };
}());
