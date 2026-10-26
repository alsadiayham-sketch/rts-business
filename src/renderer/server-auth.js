'use strict';

var PLATFORM_AUTH_ORIGIN = 'https://rts-royal.pages.dev';

function nodeRequest(url, options) {
    return new Promise(function (resolve, reject) {
        var request = require('node:https').request(url, {
            method: options.method,
            headers: options.headers,
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
                if (size > 64 * 1024) {
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

module.exports = { resolveAuthBase: resolveAuthBase, authenticate: authenticate, nodeRequest: nodeRequest };
