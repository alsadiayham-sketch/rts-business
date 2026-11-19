'use strict';

var randomUUID = require('node:crypto').randomUUID;

function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]); }).join(',') + '}';
    }
    return JSON.stringify(value);
}

function emptyState() {
    return { loaded: false, configured: false, config: null, configRevision: 0, tablesConfigured: false, tables: [], tablesRevision: 0, holds: [] };
}

function sessionChanged() {
    var error = new Error('تم تغيير جلسة المطعم. لم يتم تطبيق نتيجة الطلب السابق.');
    error.code = 'SESSION_CHANGED';
    return error;
}

function createClient(onChange) {
    var adapters = null, sessionKey = null, generation = 0, loadSequence = 0;
    var state = emptyState();
    var pending = new Map();
    var closedHolds = new Set();

    function notify() { if (onChange) onChange(state); }
    function current(expected) { if (expected !== generation) throw sessionChanged(); }
    function configState(data) {
        if (!data || typeof data.configured !== 'boolean' || !Number.isInteger(data.revision)
            || (data.configured && (!data.config || typeof data.config.features !== 'object'
                || typeof data.config.features.tax !== 'boolean' || !Number.isFinite(data.config.taxPercent)
                || typeof data.config.taxIncluded !== 'boolean'))) {
            throw new Error('استجابة إعدادات المطعم المشترك غير صالحة.');
        }
        return { configured: data.configured, config: data.config, configRevision: data.revision };
    }
    function tableState(data) {
        if (!data || typeof data.configured !== 'boolean' || !Number.isInteger(data.revision) || !Array.isArray(data.tables)
            || data.tables.some(function (table) {
                return !table || !Number.isInteger(table.id) || table.id < 1
                    || typeof table.name !== 'string' || typeof table.archived !== 'boolean';
            })) throw new Error('استجابة طاولات المطعم المشترك غير صالحة.');
        return { tablesConfigured: data.configured, tables: data.tables, tablesRevision: data.revision };
    }
    function validateHolds(holds) {
        if (!Array.isArray(holds) || holds.some(function (hold) {
            return !hold || typeof hold.id !== 'string' || hold.status !== 'open'
                || !Number.isInteger(hold.revision) || hold.revision < 1 || !Array.isArray(hold.items);
        })) throw new Error('استجابة الطلبات المشتركة غير صالحة.');
        return holds;
    }

    return {
        configure: function (nextAdapters, key) {
            if (sessionKey === key && adapters === nextAdapters) return;
            adapters = nextAdapters;
            sessionKey = key;
            generation++;
            loadSequence++;
            pending.clear();
            closedHolds.clear();
            state = emptyState();
            notify();
        },
        state: function () { return state; },
        refresh: async function () {
            if (!adapters) throw new Error('طلبات المطعم المشتركة تحتاج جلسة خادم موثوقة.');
            var expected = generation, sequence = ++loadSequence, bound = adapters;
            var data = await Promise.all([bound.config('GET'), bound.tables('GET'), bound.orders('GET')]);
            current(expected);
            if (sequence !== loadSequence) return state;
            var next = Object.assign({}, configState(data[0]), tableState(data[1]), { holds: validateHolds(data[2] && data[2].holds), loaded: true });
            if (canonical(state) === canonical(next)) return state;
            state.holds.forEach(function (previous) {
                if (!next.holds.some(function (hold) { return hold.id === previous.id; })) closedHolds.add(previous.id);
            });
            state = next;
            notify();
            return state;
        },
        read: async function (kind, query) {
            if (!adapters || !['config', 'tables', 'orders'].includes(kind)) throw new Error('عملية مطعم مشتركة غير صالحة.');
            var expected = generation;
            var result = await adapters[kind]('GET', null, query);
            current(expected);
            return result;
        },
        mutate: async function (kind, payload) {
            if (!adapters || !['config', 'tables', 'orders'].includes(kind) || !payload || typeof payload.action !== 'string') {
                throw new Error('عملية مطعم مشتركة غير صالحة.');
            }
            var expected = generation, bound = adapters[kind];
            var body = JSON.parse(JSON.stringify(payload));
            delete body.requestId;
            var intent = kind + ':' + canonical(body);
            var requestId = pending.get(intent) || randomUUID();
            pending.set(intent, requestId);
            body.requestId = requestId;
            var result;
            try { result = await bound('POST', body); }
            catch (error) {
                if (expected === generation && error.status >= 400 && error.status < 500) pending.delete(intent);
                throw error;
            }
            current(expected);
            if (!result || result.ok !== true) throw new Error('لم يؤكد الخادم حفظ العملية المشتركة.');
            var previousHold = result.hold && state.holds.find(function (hold) { return hold.id === result.hold.id; });
            if ((kind === 'config' && result.revision < state.configRevision)
                || (kind === 'tables' && result.revision < state.tablesRevision)
                || (result.hold && (closedHolds.has(result.hold.id) || (previousHold && previousHold.revision > result.hold.revision)))) {
                pending.delete(intent);
                var stale = new Error('وصل تأكيد قديم لعملية محفوظة، لكن حالة الطلب أو الإعدادات تغيّرت بعدها. راجع الحالة الحالية قبل المتابعة.');
                stale.status = 409;
                stale.code = 'STALE_RESPONSE';
                throw stale;
            }
            loadSequence++;
            if (kind === 'config') state = Object.assign({}, state, configState(result));
            if (kind === 'tables') state = Object.assign({}, state, tableState(Object.assign({ configured: true }, result)));
            if (kind === 'orders' && result.hold) {
                validateHolds([result.hold]);
                state = Object.assign({}, state, {
                    holds: state.holds.filter(function (hold) { return hold.id !== result.hold.id; }).concat([result.hold])
                });
            }
            if (kind === 'orders' && (result.cancelled || result.bill)) {
                closedHolds.add(body.holdId);
                state = Object.assign({}, state, {
                    holds: state.holds.filter(function (hold) { return hold.id !== body.holdId; })
                });
            }
            notify();
            pending.delete(intent);
            return result;
        }
    };
}

function mergePrivateReceipt(publicBill, response, includeCost) {
    var receipt = response && response.bill;
    if (!receipt || receipt.billNumber !== publicBill.billNumber || receipt.privateRef !== publicBill.privateRef
        || !Array.isArray(receipt.items) || (includeCost && !Array.isArray(response.costs))) {
        throw new Error('تعذر مطابقة بيانات الفاتورة الخاصة مع النسخة المحفوظة.');
    }
    function key(item) { return JSON.stringify([item.productId, item.color, item.size, item.qty]); }
    var costs = new Map((includeCost ? response.costs : []).map(function (item) { return [key(item), item.cost]; }));
    var items = receipt.items.map(function (item) {
        var cost = costs.get(key(item));
        return Object.assign({}, item, {
            historicalCostProtected: true,
            cost: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
        });
    });
    return Object.assign({}, publicBill, receipt, {
        id: publicBill.id, createdAt: publicBill.createdAt, items: items, privateReceiptLoaded: true
    });
}

module.exports = { createClient: createClient, mergePrivateReceipt: mergePrivateReceipt };
