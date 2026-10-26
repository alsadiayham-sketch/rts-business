(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.RestaurantModel = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    var DEMO_VERSION = 'restaurant-demo-v1';

    function number(value) {
        var parsed = Number(value);
        return isFinite(parsed) ? parsed : 0;
    }

    function isoDay(value) {
        return String(value || '').slice(0, 10);
    }

    function validateOffer(offer) {
        var errors = [];
        var discount = number(offer && offer.discountValue);
        var type = offer && offer.discountType;
        if (!offer || !String(offer.name || '').trim()) errors.push('اسم العرض مطلوب.');
        if (type !== 'percent' && type !== 'amount') errors.push('نوع الخصم غير صالح.');
        if (discount <= 0) errors.push('قيمة الخصم يجب أن تكون أكبر من صفر.');
        if (type === 'percent' && discount > 100) errors.push('النسبة لا يمكن أن تتجاوز 100%.');
        if (number(offer && offer.minQty) < 1) errors.push('الحد الأدنى للكمية يجب أن يكون 1 على الأقل.');
        if (offer && offer.expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(offer.expiresOn)) errors.push('تاريخ الانتهاء غير صالح.');
        return errors;
    }

    function isOfferActive(offer, today) {
        if (!offer || offer.enabled === false) return false;
        return !offer.expiresOn || isoDay(today || new Date().toISOString()) <= offer.expiresOn;
    }

    function offerLabel(offer) {
        var value = number(offer && offer.discountValue);
        return offer && offer.discountType === 'percent' ? value + '%' : '₪' + value.toFixed(2);
    }

    function applyOffer(offer, cart, today) {
        var errors = validateOffer(offer);
        var items = Array.isArray(cart) ? cart : [];
        var qty = items.reduce(function (sum, item) { return sum + Math.max(0, number(item.qty || item.quantity || 0)); }, 0);
        var subtotal = items.reduce(function (sum, item) {
            return sum + Math.max(0, number(item.price)) * Math.max(0, number(item.qty || item.quantity || 0));
        }, 0);
        if (!isOfferActive(offer, today)) errors.push('هذا العرض غير مفعّل أو منتهي.');
        if (qty < number(offer && offer.minQty || 1)) errors.push('لا تتحقق الكمية الدنيا لهذا العرض.');
        if (subtotal <= 0) errors.push('لا توجد أصناف صالحة لتطبيق العرض.');
        if (errors.length) return { ok: false, errors: errors, discount: 0, subtotal: subtotal };
        var raw = offer.discountType === 'percent' ? subtotal * number(offer.discountValue) / 100 : number(offer.discountValue);
        var cap = number(offer.maxDiscount);
        var discount = Math.min(subtotal, cap > 0 ? Math.min(raw, cap) : raw);
        return { ok: true, errors: [], subtotal: subtotal, discount: Math.round(discount * 100) / 100 };
    }

    function revalidateAppliedOffer(records, offerId, cart, today) {
        var offer = (records || []).find(function (record) {
            return record && record.recordType === 'restaurant-offer' && String(record.id) === String(offerId);
        });
        if (!offer) return { ok: false, errors: ['العرض لم يعد متاحاً.'], discount: 0 };
        var result = applyOffer(offer, cart, today);
        result.offer = offer;
        return result;
    }

    function validateAttendanceTransition(records, employeeId, action, at) {
        if (!employeeId) return { ok: false, error: 'الموظف مطلوب.' };
        var open = (records || []).filter(function (record) {
            return record.recordType === 'restaurant-attendance' && record.employeeId === employeeId && record.action === 'in' &&
                !(records || []).some(function (candidate) { return candidate.recordType === 'restaurant-attendance' && candidate.action === 'out' && candidate.shiftId === record.shiftId; });
        });
        var day = isoDay(at || new Date().toISOString());
        if (action === 'in' && open.length) return { ok: false, error: 'لدى الموظف وردية مفتوحة بالفعل.' };
        if (action === 'out' && !open.length) return { ok: false, error: 'لا يمكن تسجيل الانصراف دون وردية مفتوحة.' };
        if (action === 'out' && isoDay(open[open.length - 1].occurredAt) > day) return { ok: false, error: 'تاريخ الانصراف لا يمكن أن يسبق الحضور.' };
        return { ok: true, shiftId: action === 'out' ? open[open.length - 1].shiftId : 'shift-' + employeeId + '-' + String(at || Date.now()) };
    }

    function buildRestaurantDemo(seedTime) {
        var createdAtIso = new Date(seedTime || '2026-10-26T08:00:00.000Z').toISOString();
        var categories = [
            ['مقبلات', [['حمص بالطحينة', 18], ['بطاطا ودجز', 16], ['ورق عنب', 22]]],
            ['مشاوي', [['كباب لحم', 52], ['شيش طاووق', 46], ['طبق مشاوي مشكل', 78]]],
            ['برغر', [['برغر كلاسيك', 39], ['برغر دجاج', 36], ['برغر نباتي', 38]]],
            ['بيتزا', [['بيتزا مارغريتا', 42], ['بيتزا خضار', 45], ['بيتزا بيبروني', 49]]],
            ['مشروبات', [['ليمون ونعناع', 14], ['عصير برتقال', 15], ['قهوة عربية', 9]]],
            ['حلويات', [['كنافة ساخنة', 20], ['تشيزكيك', 24], ['آيس كريم', 16]]]
        ];
        var products = [], seq = 1;
        categories.forEach(function (group) {
            group[1].forEach(function (item) {
                var id = 'demo-menu-' + String(seq++).padStart(2, '0');
                products.push({
                    id: id, name: item[0], category: group[0], type: group[0], brand: 'بيانات تجريبية', demoDataVersion: DEMO_VERSION,
                    status: 'active', variants: [{ color: 'افتراضي', size: 'حصة', price: item[1], cost: Math.round(item[1] * 0.42 * 100) / 100, stock: 35 }]
                });
            });
        });
        var customers = ['ليان التجريبية', 'عمر التجريبي', 'سارة التجريبية', 'آدم التجريبي', 'نور التجريبية', 'رامي التجريبي'].map(function (name, index) {
            return { id: 'demo-customer-' + (index + 1), recordType: 'customer', name: name, phone: '', demoContactId: 'DEMO-CUST-' + String(index + 1).padStart(3, '0'), messagingExcluded: true, notes: 'عميل تجريبي — بلا رقم هاتف ولا رسائل', birthday: '', total: 0, status: 'customer', source: 'pos', createdAtIso: createdAtIso, demoDataVersion: DEMO_VERSION };
        });
        var employees = ['هند', 'ياسر', 'مريم', 'سامر', 'رنا', 'كريم'].map(function (name, index) {
            return { id: 'demo-employee-' + (index + 1), name: name + ' التجريبي', role: index < 2 ? 'مشرف صالة' : 'طاقم خدمة', demoDataVersion: DEMO_VERSION };
        });
        var offers = [
            { id: 'demo-offer-1', recordType: 'restaurant-offer', name: 'غداء العمل', discountType: 'percent', discountValue: 12, maxDiscount: 20, minQty: 2, enabled: true, expiresOn: '', total: 0, status: 'restaurant-offer', source: 'pos', createdAtIso: createdAtIso, demoDataVersion: DEMO_VERSION },
            { id: 'demo-offer-2', recordType: 'restaurant-offer', name: 'حلوى مع الطلب', discountType: 'amount', discountValue: 8, maxDiscount: 8, minQty: 3, enabled: true, expiresOn: '', total: 0, status: 'restaurant-offer', source: 'pos', createdAtIso: createdAtIso, demoDataVersion: DEMO_VERSION },
            { id: 'demo-offer-3', recordType: 'restaurant-offer', name: 'عرض منتهي للتوضيح', discountType: 'percent', discountValue: 10, maxDiscount: 15, minQty: 2, enabled: false, expiresOn: '2025-01-01', total: 0, status: 'restaurant-offer', source: 'pos', createdAtIso: createdAtIso, demoDataVersion: DEMO_VERSION }
        ];
        var attendance = employees.slice(0, 4).flatMap(function (employee, index) {
            var date = '2026-10-' + String(20 + index).padStart(2, '0');
            var shiftId = 'demo-shift-' + (index + 1);
            return [
                { id: shiftId + '-in', recordType: 'restaurant-attendance', employeeId: employee.id, employeeName: employee.name, action: 'in', shiftId: shiftId, occurredAt: date + 'T08:00:00.000Z', total: 0, status: 'restaurant-attendance', source: 'pos', createdAtIso: createdAtIso, demoDataVersion: DEMO_VERSION },
                { id: shiftId + '-out', recordType: 'restaurant-attendance', employeeId: employee.id, employeeName: employee.name, action: 'out', shiftId: shiftId, occurredAt: date + 'T16:00:00.000Z', total: 0, status: 'restaurant-attendance', source: 'pos', createdAtIso: createdAtIso, demoDataVersion: DEMO_VERSION }
            ];
        });
        var loyalty = customers.map(function (customer, index) {
            return { id: 'demo-loyalty-' + (index + 1), recordType: 'loyalty-txn', customer: { name: customer.name, phone: customer.phone }, delta: 10 + index * 5, reason: 'رصيد ولاء تجريبي', billNumber: '', total: 0, status: 'loyalty', source: 'pos', createdAtIso: createdAtIso, demoDataVersion: DEMO_VERSION };
        });
        var employeeRecords = employees.map(function (employee) {
            return { id: employee.id, recordType: 'restaurant-employee', name: employee.name, role: employee.role, total: 0, status: 'restaurant-employee', source: 'pos', createdAtIso: createdAtIso, demoDataVersion: DEMO_VERSION };
        });
        return {
            products: products.map(function (product) { return { id: product.id, data: product }; }),
            records: customers.concat(offers, employeeRecords, attendance, loyalty).map(function (record) { return { id: record.id, data: record }; }),
            featureSettings: { restaurant: true, businessType: 'restaurant', demoDataVersion: DEMO_VERSION }
        };
    }

    return { DEMO_VERSION: DEMO_VERSION, validateOffer: validateOffer, isOfferActive: isOfferActive, offerLabel: offerLabel, applyOffer: applyOffer, revalidateAppliedOffer: revalidateAppliedOffer, validateAttendanceTransition: validateAttendanceTransition, buildRestaurantDemo: buildRestaurantDemo, createRestaurantDemoFixture: function () {
        var fixture = buildRestaurantDemo();
        return { version: DEMO_VERSION, products: fixture.products.map(function (item) { return Object.assign({ id: item.id }, item.data); }), records: fixture.records.map(function (item) { return Object.assign({ id: item.id }, item.data); }) };
    } };
}));
