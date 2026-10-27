'use strict';

function validateRestaurantService(input) {
    var type = input && input.type;
    if (['dinein', 'takeaway', 'delivery'].indexOf(type) < 0) return { ok: false, error: 'اختر نوع الطلب.' };
    var order = {
        type: type, table: null,
        customerName: String(input.customerName || '').trim(),
        phone: String(input.phone || '').trim(),
        address: type === 'delivery' ? String(input.address || '').trim() : '',
        deliveryFee: 0
    };
    if (order.customerName.length > 100 || order.phone.length > 40 || order.address.length > 500) {
        return { ok: false, error: 'بيانات العميل أو العنوان أطول من الحد المسموح.' };
    }
    if (type === 'dinein') {
        order.table = Number(input.table);
        if (!Number.isInteger(order.table) || order.table < 1 || order.table > 60) {
            return { ok: false, error: 'اختر طاولة للطلب داخل المطعم.' };
        }
    }
    if (type === 'delivery') {
        order.deliveryFee = input.deliveryFee === '' || input.deliveryFee == null ? 0 : Number(input.deliveryFee);
        if (!Number.isFinite(order.deliveryFee) || order.deliveryFee < 0 || Math.abs(order.deliveryFee * 100 - Math.round(order.deliveryFee * 100)) > 0.000001) {
            return { ok: false, error: 'أدخل رسوم توصيل صحيحة موجبة أو صفراً، حتى منزلتين عشريتين.' };
        }
        if (!order.customerName || !order.phone || !order.address) {
            return { ok: false, error: 'طلب التوصيل يحتاج اسم العميل ورقم الهاتف والعنوان.' };
        }
    }
    return { ok: true, order: order };
}

function serviceLabel(type) {
    return { dinein: 'داخل المطعم', takeaway: 'سفري', delivery: 'توصيل' }[type] || '';
}

module.exports = { validateRestaurantService: validateRestaurantService, serviceLabel: serviceLabel };
