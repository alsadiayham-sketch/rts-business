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

    function businessType(licensedType, legacyConfig) {
        if (licensedType === 'restaurant' || licensedType === 'shop') return licensedType;
        var features = legacyConfig && legacyConfig.features || {};
        return legacyConfig && legacyConfig.businessType === 'restaurant' || features.restaurant === true ? 'restaurant' : 'shop';
    }

    function menuSections(config, products) {
        var seen = Object.create(null), names = Object.create(null);
        var sections = [];
        ((config && config.restaurantMenuSections) || []).forEach(function (section, index) {
            var name = String(section && section.name || '').trim();
            var id = String(section && section.id || '').trim();
            if (!name || !id || seen[id]) return;
            seen[id] = true;
            names[name] = true;
            sections.push({ id: id, name: name, order: Number.isFinite(Number(section.order)) ? Number(section.order) : index });
        });
        sections.sort(function (a, b) { return a.order - b.order || a.name.localeCompare(b.name, 'ar'); });
        (products || []).forEach(function (product) {
            var name = String(product && (product.category || product.type) || '').trim();
            if (!name) return;
            var id = 'legacy-' + name.normalize('NFKC').replace(/\s+/g, '-').replace(/[^\w\u0600-\u06FF-]/g, '').toLowerCase();
            if (!seen[id] && !names[name]) {
                seen[id] = true;
                names[name] = true;
                sections.push({ id: id, name: name, order: sections.length });
            }
        });
        return sections;
    }

    function foodChoices(product) {
        return (product && product.variants || []).map(function (variant, index) {
            return { variant: variant, index: index, label: String(variant && variant.size || '').trim() };
        }).filter(function (choice) {
            var color = String(choice.variant && choice.variant.color || '').trim();
            return !color || color === 'افتراضي';
        });
    }

    function menuImageSource(value) {
        var source = String(value || '').trim();
        if (!source || source.length > 400000) return '';
        if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source)) return source;
        if (source.length > 4096) return '';
        try {
            var url = new URL(source);
            return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
        } catch (_error) { return ''; }
    }

    function foodSelection(product) {
        var choices = foodChoices(product);
        var inStock = choices.filter(function (choice) { return Number(choice.variant && choice.variant.stock || 0) > 0; });
        if (choices.length === 1) return inStock.length === 1 ? { kind: 'direct', choice: choices[0] } : { kind: 'configuration-required', choices: choices };
        var labels = Object.create(null), configured = choices.length > 1;
        choices.forEach(function (choice) {
            var key = normalizedLabel(choice.label);
            if (!choice.label || choice.label === 'افتراضي' || labels[key]) configured = false;
            labels[key] = true;
        });
        return configured ? { kind: 'portions', choices: choices } : { kind: 'configuration-required', choices: choices };
    }

    function variantKey(variant) {
        var color = String(variant && variant.color || '').trim();
        var size = String(variant && variant.size || '').trim();
        return color + '\u0000' + size;
    }

    function strictNumber(value) {
        if (value == null) return null;
        if (typeof value === 'string' && value.trim() === '') return null;
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function strictInteger(value) {
        var parsed = strictNumber(value);
        return parsed != null && Number.isInteger(parsed) ? parsed : null;
    }

    function normalizedLabel(value) {
        return String(value || '').trim().normalize('NFKC').toLocaleLowerCase('ar');
    }

    function buildFoodVariants(existingVariants, rows, editableIndexes) {
        var existing = Array.isArray(existingVariants) ? existingVariants : [];
        var nextRows = Array.isArray(rows) ? rows : [];
        var editable = (Array.isArray(editableIndexes) ? editableIndexes : []).filter(function (value, index, source) {
            return Number.isInteger(value) && value >= 0 && value < existing.length && source.indexOf(value) === index;
        });
        var errors = [];
        if (!nextRows.length) {
            errors.push('يجب إدخال حصة واحدة على الأقل.');
            return { ok: false, errors: errors, variants: existing.slice() };
        }
        var seenLabels = Object.create(null);
        var created = [];
        nextRows.forEach(function (row, rowIndex) {
            var label = String((row && (row.label || row.size)) || '').trim();
            var line = rowIndex + 1;
            if (!label) errors.push('اسم الحصة مطلوب في السطر ' + line + '.');
            var labelKey = normalizedLabel(label);
            if (labelKey && seenLabels[labelKey]) errors.push('اسم الحصة «' + label + '» مكرر.');
            seenLabels[labelKey] = true;

            var price = strictNumber(row && row.price);
            if (price == null || price <= 0) errors.push('سعر الحصة «' + (label || ('#' + line)) + '» يجب أن يكون أكبر من صفر.');

            var stock = strictInteger(row && row.stock);
            if (stock == null || stock < 0) errors.push('المخزون للحصة «' + (label || ('#' + line)) + '» يجب أن يكون رقمًا صحيحًا ≥ 0.');

            var cost = strictNumber(row && row.cost);
            if (cost == null || cost < 0) errors.push('تكلفة الحصة «' + (label || ('#' + line)) + '» يجب أن تكون رقمًا ≥ 0.');

            var sourceIndex = Number.isInteger(row && row.sourceIndex) ? row.sourceIndex : null;
            if (sourceIndex != null && editable.indexOf(sourceIndex) === -1) errors.push('لا يمكن تغيير حصة خارج قائمة الطعام.');
            var base = sourceIndex != null && sourceIndex >= 0 && sourceIndex < existing.length ? existing[sourceIndex] : {};
            created.push(Object.assign({}, base, {
                color: Object.prototype.hasOwnProperty.call(base, 'color') ? base.color : 'افتراضي',
                size: String(base.size || '').trim() === label ? base.size : (label || 'قياسية'),
                price: price,
                stock: stock,
                cost: cost
            }));
        });
        if (errors.length) return { ok: false, errors: errors, variants: existing.slice() };

        var retained = existing.filter(function (_variant, index) {
            return editable.indexOf(index) === -1;
        }).map(function (variant) { return Object.assign({}, variant); });
        var merged = retained.concat(created);
        var seenKeys = Object.create(null);
        merged.forEach(function (variant) {
            var key = variantKey(variant);
            if (typeof variant.color !== 'string' || !String(variant && variant.size || '').trim()) {
                errors.push('كل الحصص يجب أن تحتوي على لون ومسمى صالحين.');
                return;
            }
            if (seenKeys[key]) errors.push('يوجد تكرار في مفتاح المخزون للون/الحصة: ' + String(variant.size || ''));
            seenKeys[key] = true;
        });
        if (errors.length) return { ok: false, errors: errors, variants: existing.slice() };
        return { ok: true, errors: [], variants: merged };
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
            featureSettings: { demoDataVersion: DEMO_VERSION }
        };
    }

    return { DEMO_VERSION: DEMO_VERSION, businessType: businessType, menuSections: menuSections, foodChoices: foodChoices, foodSelection: foodSelection, menuImageSource: menuImageSource, buildFoodVariants: buildFoodVariants, validateOffer: validateOffer, isOfferActive: isOfferActive, offerLabel: offerLabel, applyOffer: applyOffer, revalidateAppliedOffer: revalidateAppliedOffer, validateAttendanceTransition: validateAttendanceTransition, buildRestaurantDemo: buildRestaurantDemo, createRestaurantDemoFixture: function () {
        var fixture = buildRestaurantDemo();
        return { version: DEMO_VERSION, products: fixture.products.map(function (item) { return Object.assign({ id: item.id }, item.data); }), records: fixture.records.map(function (item) { return Object.assign({ id: item.id }, item.data); }) };
    } };
}));
