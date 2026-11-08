'use strict';
var test = require('node:test');
var assert = require('node:assert/strict');
var auth = require('../src/renderer/server-auth');

var licence = {
    dataBackend: 'firestore', productType: 'business',
    authBackend: 'rts', authContractVersion: 1,
    authApiBaseUrl: 'https://rts-royal.pages.dev'
};

test('Firestore data storage can use explicit trusted server authentication', function () {
    assert.equal(auth.resolveAuthBase(licence), 'https://rts-royal.pages.dev');
    assert.equal(auth.resolveAuthBase({ dataBackend: 'firestore' }), null);
    assert.equal(auth.resolveAuthBase(Object.assign({}, licence, { authApiBaseUrl: 'https://untrusted.example' })), null);
    assert.equal(auth.resolveAuthBase(Object.assign({}, licence, { authContractVersion: 2 })), null);
    assert.equal(auth.resolveAuthBase(Object.assign({}, licence, { productType: 'clinic' })), null);
});

test('D1 auth stays on its configured HTTPS server', function () {
    assert.equal(auth.resolveAuthBase({}, 'https://aqqad.pages.dev/'), 'https://aqqad.pages.dev');
    for (var url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?redirect=1']) {
        assert.throws(function () { auth.resolveAuthBase({}, url); });
    }
});

test('login calls the verifier with no redirect and returns validated user/token', async function () {
    var credentials = { storeId: 'rts-resturant', username: 'owner', password: 'unit-test-only' };
    var result = await auth.authenticate(async function (url, options) {
        assert.equal(url, 'https://rts-royal.pages.dev/api/pos-login');
        assert.equal(options.redirect, 'error');
        assert.deepEqual(JSON.parse(options.body), credentials);
        return new Response(JSON.stringify({
            token: 'test-token', productType: 'business', store: { id: credentials.storeId },
            user: { username: 'owner', role: 'admin', name: 'Test Owner' }
        }));
    }, licence.authApiBaseUrl, credentials);
    assert.equal(result.token, 'test-token');
    assert.equal(result.user.role, 'admin');
});

test('invalid, cross-tenant and denied authentication never produces a session', async function () {
    var credentials = { storeId: 'rts-resturant', username: 'owner', password: 'unit-test-only' };
    for (var data of [
        {}, { token: 'x', user: { username: 'owner', role: 'superadmin' } },
        { token: 'x', user: { username: 'owner', role: 'admin' }, productType: 'clinic' },
        { token: 'x', user: { username: 'owner', role: 'admin' }, store: { id: 'different-store' } }
    ]) {
        await assert.rejects(auth.authenticate(async function () { return Response.json(data); }, licence.authApiBaseUrl, credentials));
    }
    await assert.rejects(auth.authenticate(async function () {
        return Response.json({ error: { message: 'Invalid credentials' } }, { status: 401 });
    }, licence.authApiBaseUrl, credentials), function (error) { return error.status === 401 && error.message === 'Invalid credentials'; });
    await assert.rejects(auth.authenticate(function () { throw new Error('Must not fetch'); }, null, credentials));
});

test('licence failures remain distinct from invalid credentials', async function () {
    await assert.rejects(auth.authenticate(async function () {
        return Response.json({ error: { code: 'LICENCE_EXPIRED', message: 'Inactive licence' } }, { status: 403 });
    }, licence.authApiBaseUrl, { storeId: 'expired', username: 'owner', password: 'unit-test-only' }), function (error) {
        assert.equal(error.code, 'LICENCE_EXPIRED');
        assert.match(auth.loginErrorMessage(error), /ليست مشكلة في كلمة المرور/);
        return true;
    });
    assert.match(auth.loginErrorMessage({ status: 401 }), /رمز المتجر/);
});

test('employee API uses only the trusted authenticated server and surfaces rejection', async function () {
    var calls = [];
    var request = async function (url, options) {
        calls.push({ url: url, options: options });
        return Response.json(options.method === 'GET' ? { users: [] } : { ok: true });
    };
    for (var method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        await auth.employees(request, licence.authApiBaseUrl, 'fixture-token', method, { username: 'worker' });
        var call = calls.at(-1);
        assert.equal(call.url, licence.authApiBaseUrl + '/api/pos-employees');
        assert.equal(call.options.headers.Authorization, 'Bearer fixture-token');
        assert.equal(call.options.redirect, 'error');
        assert.equal(call.options.body, method === 'GET' ? undefined : JSON.stringify({ username: 'worker' }));
    }
    await assert.rejects(auth.employees(request, 'https://other.example', 'fixture-token', 'POST', {}));
    await assert.rejects(auth.employees(request, licence.authApiBaseUrl, '', 'GET'));
    await assert.rejects(auth.employees(async function () {
        return Response.json({ error: { code: 'POS_AUTH_REQUIRED', message: 'Expired session' } }, { status: 401 });
    }, licence.authApiBaseUrl, 'old-token', 'GET'), function (error) {
        return error.status === 401 && /سجّل الدخول/.test(error.message);
    });
});

test('desktop login transport rejects redirect and oversized responses', async function (t) {
    var https = require('node:https');
    var EventEmitter = require('node:events');
    var mode = 'redirect';
    t.mock.method(https, 'request', function (_url, options, onResponse) {
        assert.equal(options.headers['Content-Length'], Buffer.byteLength('{"username":"موظف"}', 'utf8'));
        assert.equal(options.timeout, 15000);
        assert.equal(options.rejectUnauthorized, undefined);
        var request = new EventEmitter();
        request.end = function () {
            var response = new EventEmitter();
            response.statusCode = mode === 'redirect' ? 302 : 200;
            response.resume = function () {};
            response.destroy = function (error) { response.emit('error', error); };
            onResponse(response);
            if (mode === 'oversize') response.emit('data', Buffer.alloc(65537));
        };
        return request;
    });
    await assert.rejects(auth.nodeRequest('https://rts-royal.pages.dev/api/pos-employees', { method: 'DELETE', headers: {}, body: '{"username":"موظف"}' }));
    mode = 'oversize';
    await assert.rejects(auth.nodeRequest('https://rts-royal.pages.dev/api/pos-login', { method: 'POST', headers: {}, body: '{"username":"موظف"}' }));
});
