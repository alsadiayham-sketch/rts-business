// Firebase config for RTS Business
var firebaseConfig = {
    apiKey: "AIzaSyAp3mDn6c5D3GKIV7BZ2aKIsm7MxYP0vG0",
    authDomain: "dimaboutique-b4f16.firebaseapp.com",
    projectId: "dimaboutique-b4f16",
    storageBucket: "dimaboutique-b4f16.appspot.com",
    messagingSenderId: "552629390598",
    appId: "1:552629390598:web:7b2a3f2f5e8c4a5b6d7e8f"
};

var firebase = require('firebase/compat/app');
require('firebase/compat/firestore');

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

var rawDb = firebase.firestore();
var PROJECT_ID = null;

// =====================================================================
//  D1 TENANTS
//  Some stores have been migrated off the shared public Firestore onto a
//  server-controlled Cloudflare D1 backend (authenticated Pages Functions).
//  For those tenants, products/orders/pos_logs/pos_damage are routed through
//  the secure HTTP API; cashier login is verified server-side (no hash ever
//  reaches the client). All OTHER tenants stay on Firestore, untouched.
//  settings/* (license + pos_users) always stays on Firestore.
// =====================================================================
var D1_TENANTS = { aqqad: 'https://aqqad.pages.dev' };
var D1_COLLECTIONS = { products: true, orders: true, pos_logs: true, pos_damage: true };
var posToken = null; // cashier bearer token, set by posAuthenticate()

function isD1() { return !!(PROJECT_ID && D1_TENANTS[PROJECT_ID]); }
function d1Base() { return D1_TENANTS[PROJECT_ID]; }

// Register (or update) a D1 tenant at runtime. Lets stores be linked to a
// web-designer project's secure backend via their Firestore license doc
// (settings/pos.apiBaseUrl) instead of being hardcoded here. Called at login
// once the license doc is read, before any products/orders are fetched.
function registerD1Tenant(projectId, baseUrl) {
    if (!projectId || !baseUrl) return;
    D1_TENANTS[projectId] = String(baseUrl).replace(/\/+$/, '');
}

// Per-collection D1 list endpoint config
var D1_CONFIG = {
    products: { list: '/api/products', key: 'products', limitParam: false },
    orders: { list: '/api/orders', key: 'orders', limitParam: false },
    pos_logs: { list: '/api/pos', key: 'logs', limitParam: true },
    pos_damage: { list: '/api/pos-damage', key: 'items', limitParam: true }
};

// Wrap a timestamp value (numeric ms OR ISO/date string) into a
// Firestore-Timestamp-like object so existing render/sort code that calls
// .toDate()/.toMillis() keeps working for both new and migrated records.
function tsWrap(ms) {
    return {
        toDate: function () { return new Date(ms); },
        toMillis: function () { return ms; },
        seconds: Math.floor(ms / 1000),
        nanoseconds: 0
    };
}
function toMs(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { var t = Date.parse(v); if (!isNaN(t)) return t; }
    return null;
}
function wrapDoc(obj) {
    if (obj && typeof obj === 'object') {
        var fields = ['createdAt', 'timestamp', 'updatedAt', 'lastChecked'];
        for (var i = 0; i < fields.length; i++) {
            var v = obj[fields[i]];
            // only wrap primitives; leave already-wrapped objects untouched
            if (typeof v === 'number' || typeof v === 'string') {
                var ms = toMs(v);
                if (ms != null) obj[fields[i]] = tsWrap(ms);
            }
        }
    }
    return obj;
}

function apiFetch(path, opts) {
    opts = opts || {};
    var headers = {};
    if (opts.headers) { for (var k in opts.headers) headers[k] = opts.headers[k]; }
    if (posToken) headers['Authorization'] = 'Bearer ' + posToken;
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetch(d1Base() + path, { method: opts.method || 'GET', headers: headers, body: opts.body })
        .then(function (res) {
            return res.text().then(function (t) {
                var data = {};
                try { data = t ? JSON.parse(t) : {}; } catch (e) { data = {}; }
                if (!res.ok) {
                    var err = new Error(data.error || ('HTTP ' + res.status));
                    err.status = res.status;
                    throw err;
                }
                return data;
            });
        });
}

// ---- Fake Firestore snapshot over a plain array of docs (each has .id) ----
function makeSnapshot(arr) {
    var docs = arr.map(function (o) {
        var id = o.id;
        return {
            id: id,
            exists: true,
            data: function () {
                var c = {};
                for (var k in o) { if (k !== 'id') c[k] = o[k]; }
                return wrapDoc(c);
            }
        };
    });
    return {
        forEach: function (cb) { docs.forEach(cb); },
        docs: docs,
        empty: docs.length === 0,
        size: docs.length
    };
}

function D1Collection(name) {
    this.name = name;
    this.cfg = D1_CONFIG[name];
    this._limit = null;
    this._orderBy = null;
}
D1Collection.prototype.limit = function (n) { this._limit = n; return this; };
D1Collection.prototype.orderBy = function (field, dir) { this._orderBy = { field: field, dir: dir }; return this; };
D1Collection.prototype._fetchAll = function () {
    var cfg = this.cfg, self = this;
    var path = cfg.list;
    if (cfg.limitParam && this._limit) path += (path.indexOf('?') >= 0 ? '&' : '?') + 'limit=' + this._limit;
    return apiFetch(path).then(function (data) {
        var arr = (data[cfg.key] || []).slice();
        if (self._orderBy) {
            var f = self._orderBy.field, dir = self._orderBy.dir === 'desc' ? -1 : 1;
            arr.sort(function (a, b) {
                var av = a[f] || 0, bv = b[f] || 0;
                if (av < bv) return -1 * dir;
                if (av > bv) return 1 * dir;
                return 0;
            });
        }
        if (self._limit && !cfg.limitParam) arr = arr.slice(0, self._limit);
        return arr;
    });
};
D1Collection.prototype.get = function () { return this._fetchAll().then(makeSnapshot); };
D1Collection.prototype.onSnapshot = function (onNext, onErr) {
    var self = this, stopped = false;
    function poll() {
        self._fetchAll().then(function (arr) {
            if (!stopped) onNext(makeSnapshot(arr));
        }).catch(function (e) { if (!stopped && onErr) onErr(e); });
    }
    poll();
    var iv = setInterval(poll, 5000);
    return function () { stopped = true; clearInterval(iv); };
};
D1Collection.prototype.add = function (obj) {
    var endpoint = this.name === 'pos_damage' ? '/api/pos-damage' : '/api/pos';
    return apiFetch(endpoint, { method: 'POST', body: JSON.stringify(obj) });
};
D1Collection.prototype.doc = function (id) { return new D1Doc(this.name, id); };

function D1Doc(coll, id) { this.coll = coll; this.id = id; }
D1Doc.prototype.set = function (obj) {
    if (this.coll === 'orders') {
        var body = {};
        for (var k in obj) body[k] = obj[k];
        body.id = this.id;
        if (!body.source) body.source = 'pos';
        return apiFetch('/api/orders', { method: 'POST', body: JSON.stringify(body) });
    }
    return Promise.reject(new Error('D1 set not supported for ' + this.coll));
};
D1Doc.prototype.update = function (obj) {
    if (this.coll === 'products') {
        // Cashier-scoped stock adjustment (restock / damage). Only variants change.
        return apiFetch('/api/pos-stock', {
            method: 'POST',
            body: JSON.stringify({ productId: this.id, variants: obj.variants })
        });
    }
    return Promise.reject(new Error('D1 update not supported for ' + this.coll));
};
D1Doc.prototype.get = function () {
    var self = this;
    return new D1Collection(this.coll)._fetchAll().then(function (arr) {
        var found = null;
        for (var i = 0; i < arr.length; i++) {
            if (String(arr[i].id) === String(self.id)) { found = arr[i]; break; }
        }
        return {
            id: self.id,
            exists: !!found,
            data: function () {
                if (!found) return undefined;
                var c = {};
                for (var k in found) { if (k !== 'id') c[k] = found[k]; }
                return wrapDoc(c);
            }
        };
    });
};

// =====================================================================
//  Public DB facade — routes D1 collections to the API for D1 tenants,
//  everything else (and all settings/*) to Firestore.
// =====================================================================
var db = {
    collection: function (name) {
        if (isD1() && D1_COLLECTIONS[name]) return new D1Collection(name);
        return rawDb.collection('projects').doc(PROJECT_ID).collection(name);
    }
};

function setProjectId(id) {
    PROJECT_ID = id;
    posToken = null; // new store -> drop any old cashier token
}

// Returns the right "now" token for the active backend.
function serverTimestamp() {
    return isD1() ? Date.now() : firebase.firestore.FieldValue.serverTimestamp();
}

// Server-side cashier authentication for D1 tenants. Never receives a hash.
// Resolves with { username, name, role } on success; rejects with err.status
// 401/403 on bad/disabled credentials.
function posAuthenticate(username, password, storeId) {
    return fetch(d1Base() + '/api/pos-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: storeId || PROJECT_ID, username: username, password: password })
    }).then(function (res) {
        return res.text().then(function (t) {
            var data = {};
            try { data = t ? JSON.parse(t) : {}; } catch (e) { data = {}; }
            if (!res.ok) {
                var err = new Error(data.error || ('HTTP ' + res.status));
                err.status = res.status;
                throw err;
            }
            posToken = data.token;
            return data.user;
        });
    });
}

function clearPosToken() { posToken = null; }

module.exports = {
    db: db,
    rawDb: rawDb,
    firebase: firebase,
    PROJECT_ID: PROJECT_ID,
    setProjectId: setProjectId,
    getProjectId: function () { return PROJECT_ID; },
    isD1: isD1,
    registerD1Tenant: registerD1Tenant,
    serverTimestamp: serverTimestamp,
    posAuthenticate: posAuthenticate,
    clearPosToken: clearPosToken
};
