'use strict';

var PLATFORM_AUTH_ORIGIN = 'https://rts-royal.pages.dev';

function nodeRequest(url, options) {
    return new Promise(function (resolve, reject) {
        var maxResponseBytes = options.maxResponseBytes == null ? 64 * 1024 : options.maxResponseBytes;
        if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 2 * 1024 * 1024) {
            reject(new Error('حد استجابة الخادم غير صالح.'));
            return;
        }
        var headers = Object.assign({}, options.headers);
        if (options.body != null) headers['Content-Length'] = Buffer.byteLength(options.body, 'utf8');
        var request = require('node:https').request(url, {
            method: options.method,
            headers: headers,
            timeout: 15000
        }, function (response) {
            if (response.statusCode >= 300 && response.statusCode < 400) {
                response.resume();
                reject(new Error('رفض خادم المصادقة: لا يسمح بإعادة توجيه بيانات الدخول.'));
                return;
            }
            var chunks = [];
            var size = 0;
            response.on('data', function (chunk) {
                size += chunk.length;
                if (size > maxResponseBytes) {
                    response.destroy(new Error('استجابة خادم المصادقة أكبر من الحد المسموح.'));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', function () {
                var body = Buffer.concat(chunks).toString('utf8');
                resolve({
                    ok: response.statusCode >= 200 && response.statusCode < 300,
                    status: response.statusCode,
                    json: function () { return Promise.resolve().then(function () { return JSON.parse(body); }); }
                });
            });
        });
        request.on('timeout', function () { request.destroy(new Error('انتهت مهلة الاتصال بخادم المصادقة.')); });
        request.on('error', reject);
        request.end(options.body);
    });
}

function resolveAuthBase(settings, d1Base) {
    if (d1Base) {
        var url = new URL(d1Base);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
            throw new Error('عنوان خادم المصادقة غير صالح. يجب استخدام عنوان HTTPS آمن.');
        }
        return url.origin;
    }
    if (settings && settings.authBackend === 'rts' && settings.authContractVersion === 1 &&
        settings.authApiBaseUrl === PLATFORM_AUTH_ORIGIN && settings.productType === 'business') {
        return PLATFORM_AUTH_ORIGIN;
    }
    return null;
}

async function authenticate(fetchRequest, base, credentials) {
    if (!base) throw new Error('لم يتم إعداد خادم مصادقة لهذا المتجر.');
    var response = await fetchRequest(base + '/api/pos-login', {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
    });
    var data;
    try { data = await response.json(); } catch (_) {
        throw new Error('استجابة خادم المصادقة غير صالحة.');
    }
    if (!response.ok) {
        var message = typeof data.error === 'string' ? data.error : data.error && data.error.message;
        var error = new Error(message || ('HTTP ' + response.status));
        error.status = response.status;
        error.code = data.error && typeof data.error.code === 'string' ? data.error.code : null;
        throw error;
    }
    var token = data.token || data.sessionToken;
    if (typeof token !== 'string' || !token || !data.user ||
        typeof data.user.username !== 'string' ||
        (data.user.role !== 'admin' && data.user.role !== 'worker') ||
        (data.productType && data.productType !== 'business') ||
        (data.store && data.store.id !== credentials.storeId)) {
        throw new Error('استجابة تسجيل الدخول لا تطابق المتجر أو التطبيق.');
    }
    return { token: token, user: data.user };
}

function loginErrorMessage(error) {
    if (error.code === 'LICENCE_EXPIRED') return 'انتهت صلاحية اشتراك هذا المتجر. جدّد الاشتراك من بوابة RTS Admin؛ ليست مشكلة في كلمة المرور.';
    if (error.status === 401) return 'تعذر تسجيل الدخول. تحقق من رمز المتجر واسم المستخدم وكلمة المرور، وأن الحساب مفعّل لهذا المتجر.';
    if (error.status === 403) return 'هذا الحساب غير مسموح له بالدخول. راجع حالة الحساب والاشتراك مع المدير.';
    if (error.status === 429) return 'محاولات دخول كثيرة. انتظر قليلاً ثم أعد المحاولة.';
    return error.message || 'تعذر الاتصال بخادم تسجيل الدخول. تحقق من الشبكة وأعد المحاولة.';
}

async function employees(fetchRequest, base, token, method, payload) {
    if (base !== PLATFORM_AUTH_ORIGIN || !token) throw new Error('إدارة حسابات الموظفين تحتاج تسجيل الدخول إلى خادم RTS المعتمد.');
    if (['GET', 'POST', 'PATCH', 'DELETE'].indexOf(method) < 0) throw new Error('عملية إدارة الموظفين غير صالحة.');
    var response = await fetchRequest(base + '/api/pos-employees', {
        method: method, redirect: 'error',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(payload || {})
    });
    var data;
    try { data = await response.json(); } catch (_) { throw new Error('استجابة إدارة الموظفين غير صالحة.'); }
    if (!response.ok) {
        var error = new Error(data.error && data.error.message || 'تعذرت إدارة حسابات الموظفين.');
        error.status = response.status;
        error.code = data.error && data.error.code;
        if (error.code === 'POS_AUTH_REQUIRED') error.message = 'انتهت الجلسة أو تغيّرت صلاحيات الحساب. سجّل الدخول مجدداً.';
        throw error;
    }
    return data;
}

async function supplies(fetchRequest, base, token, method, payload, query) {
    if (base !== PLATFORM_AUTH_ORIGIN || !token) throw new Error('مخزون المستلزمات يحتاج تسجيل الدخول إلى خادم RTS المعتمد.');
    if (method !== 'GET' && method !== 'POST') throw new Error('عملية مخزون المستلزمات غير صالحة.');
    var response = await fetchRequest(PLATFORM_AUTH_ORIGIN + '/api/pos-supplies' + (query || ''), {
        method: method,
        redirect: 'error',
        headers: {
            Authorization: 'Bearer ' + token,
            Origin: PLATFORM_AUTH_ORIGIN,
            'Sec-Fetch-Site': 'none',
            'Content-Type': 'application/json'
        },
        body: method === 'GET' ? undefined : JSON.stringify(payload || {})
    });
    var data;
    try { data = await response.json(); } catch (_) { throw new Error('استجابة مخزون المستلزمات غير صالحة.'); }
    if (!response.ok) {
        var error = new Error(data.error && data.error.message || 'تعذر تحديث مخزون المستلزمات.');
        error.status = response.status;
        error.code = data.error && data.error.code;
        if (error.code === 'POS_AUTH_REQUIRED') error.message = 'انتهت الجلسة أو تغيّرت صلاحيات الحساب. سجّل الدخول مجدداً.';
        if (error.code === 'INSUFFICIENT_SUPPLY_STOCK') error.message = 'الكمية المستهلكة أكبر من المخزون المتاح.';
        if (error.code === 'SUPPLY_CONFLICT') error.message = 'تغيّر المخزون من جهاز آخر. حدّث القائمة ثم أعد المحاولة.';
        throw error;
    }
    return data;
}

async function restaurantApi(fetchRequest, base, token, route, method, payload, query) {
    if (base !== PLATFORM_AUTH_ORIGIN || !token) throw new Error('طلبات المطعم المشتركة تحتاج تسجيل الدخول إلى خادم RTS المعتمد.');
    if (method !== 'GET' && method !== 'POST') throw new Error('عملية طلبات المطعم غير صالحة.');
    var parameters = new URLSearchParams(query || {});
    var suffix = parameters.toString();
    var response = await fetchRequest(PLATFORM_AUTH_ORIGIN + route + (suffix ? '?' + suffix : ''), {
        method: method,
        redirect: 'error',
        maxResponseBytes: 2 * 1024 * 1024,
        headers: {
            Authorization: 'Bearer ' + token,
            Origin: PLATFORM_AUTH_ORIGIN,
            'Sec-Fetch-Site': 'none',
            'Content-Type': 'application/json'
        },
        body: method === 'GET' ? undefined : JSON.stringify(payload || {})
    });
    var data;
    try { data = await response.json(); } catch (_) { throw new Error('استجابة طلبات المطعم غير صالحة.'); }
    if (!response.ok) {
        var error = new Error(data.error && data.error.message || 'تعذر تحديث طلبات المطعم المشتركة.');
        error.status = response.status;
        error.code = data.error && data.error.code;
        if (error.code === 'POS_AUTH_REQUIRED') error.message = 'انتهت الجلسة أو تغيّرت صلاحيات الحساب. سجّل الدخول مجدداً.';
        throw error;
    }
    return data;
}

function restaurantOrders(fetchRequest, base, token, method, payload, query) {
    return restaurantApi(fetchRequest, base, token, '/api/pos-mobile-orders', method, payload, query);
}

function restaurantConfig(fetchRequest, base, token, method, payload, query) {
    return restaurantApi(fetchRequest, base, token, '/api/pos-shared-config', method, payload, query);
}

function restaurantTables(fetchRequest, base, token, method, payload, query) {
    return restaurantApi(fetchRequest, base, token, '/api/pos-restaurant-tables', method, payload, query);
}

module.exports = {
    resolveAuthBase: resolveAuthBase,
    authenticate: authenticate,
    nodeRequest: nodeRequest,
    loginErrorMessage: loginErrorMessage,
    employees: employees,
    supplies: supplies,
    restaurantOrders: restaurantOrders,
    restaurantConfig: restaurantConfig,
    restaurantTables: restaurantTables
};
