const Module = require('node:module');
const originalLoad = Module._load;
const documents = new Map();
const writes = [];
const copy = value => JSON.parse(JSON.stringify(value));
function reference(key) {
    return {
        id: key.split('/').pop(),
        key,
        collection(name) { return reference(`${key}/${name}`); },
        doc(id) { return reference(`${key}/${id}`); },
        add(value) { return this.doc('fixture-' + writes.length).set(value); },
        orderBy() { return this; },
        limit() { return this; },
        where() { return this; },
        get() {
            const value = documents.get(key);
            return Promise.resolve({ exists: value !== undefined, data: () => value && copy(value), forEach() {} });
        },
        set(value, options) {
            if (fixture.failNextWrite) { fixture.failNextWrite = false; return Promise.reject(new Error('Fixture save failure')); }
            documents.set(key, options?.merge ? { ...documents.get(key), ...copy(value) } : copy(value));
            writes.push({ key, value: copy(value) });
            return Promise.resolve();
        },
        update(value) { return this.set(value, { merge: true }); },
        onSnapshot(callback) { callback({ forEach() {} }); return () => {}; },
    };
}
const db = {
    collection: name => reference(name),
    async runTransaction(work) {
        if (fixture.failNextTransaction) { fixture.failNextTransaction = false; throw new Error('Fixture transaction failure'); }
        if (fixture.delayTransaction) await new Promise(resolve => { fixture.releaseTransaction = resolve; });
        const pending = [];
        await work({
            get: ref => ref.get(),
            set: (ref, value) => pending.push(() => ref.set(value)),
            update: (ref, value) => pending.push(() => ref.update(value)),
        });
        for (const apply of pending) await apply();
    },
};
const fixture = {
    writes,
    prints: [],
    posEmployeeCalls: [],
    failEmployeeGetOnce: false,
    employeeUsers: [
        { username: 'fixture-admin', name: 'مدير الاختبار', role: 'admin', active: true, canDelete: false, canDeactivate: false, canChangeRole: false },
        { username: 'worker-1', name: 'موظف تجريبي', role: 'worker', active: true, canDelete: true, canDeactivate: true, canChangeRole: true }
    ],
    seed(key, value) { documents.set(key, copy(value)); },
    read(key) { const value = documents.get(key); return value && copy(value); },
};
function employeeResponse() {
    return {
        users: fixture.employeeUsers.map(user => ({
            username: user.username,
            name: user.name,
            role: user.role,
            active: user.active !== false,
            canDelete: user.canDelete !== false,
            canDeactivate: user.canDeactivate !== false,
            canChangeRole: user.canChangeRole !== false
        }))
    };
}
const fakeFirebase = {
    db: { collection: name => reference('projects/isolated-restaurant-fixture/' + name) },
    rawDb: db,
    firebase: { firestore: { FieldValue: { serverTimestamp: () => new Date().toISOString() } } },
    storage: {},
    setProjectId() {},
    getProjectId: () => 'isolated-restaurant-fixture',
    isD1: () => false,
    isMessagingConfigured: () => false,
    configurePosAuth: () => false,
    isPosEmployeeManagementConfigured: () => true,
    posEmployees: async (method, payload) => {
        const verb = String(method || '').toUpperCase();
        const body = payload || {};
        fixture.posEmployeeCalls.push({ method: verb, payload: copy(body) });
        if (verb === 'GET') {
            if (fixture.failEmployeeGetOnce) {
                fixture.failEmployeeGetOnce = false;
                throw new Error('تعذر الوصول إلى خادم حسابات الموظفين.');
            }
            return employeeResponse();
        }
        const idx = fixture.employeeUsers.findIndex(user => user.username === body.username);
        if (verb === 'POST') {
            if (idx >= 0) {
                fixture.employeeUsers[idx] = {
                    ...fixture.employeeUsers[idx],
                    name: body.name,
                    role: body.role,
                    active: fixture.employeeUsers[idx].active !== false
                };
            } else {
                fixture.employeeUsers.push({
                    username: body.username,
                    name: body.name,
                    role: body.role || 'worker',
                    active: true,
                    canDelete: true,
                    canDeactivate: true,
                    canChangeRole: true
                });
            }
            return employeeResponse();
        }
        if (verb === 'PATCH') {
            if (idx >= 0) fixture.employeeUsers[idx].active = !!body.active;
            return employeeResponse();
        }
        if (verb === 'DELETE') {
            if (idx >= 0 && fixture.employeeUsers[idx].canDelete !== false) fixture.employeeUsers.splice(idx, 1);
            return employeeResponse();
        }
        throw new Error('Unsupported fixture employee method: ' + verb);
    },
    serverTimestamp: () => new Date().toISOString(),
    publishOwnerTelemetry: async () => ({ ok: true }),
};
Module._load = function (request, parent, isMain) {
    if (request === './firebase-config') return fakeFirebase;
    if (request === 'electron') return {
        ipcRenderer: {
            on() {},
            send(channel, payload) { fixture.prints.push({ channel, payload }); },
            invoke(channel, payload) {
                fixture.prints.push({ channel, payload });
                return Promise.resolve(channel.includes('printers') ? [] : { success: true });
            },
        },
    };
    if (['http', 'https', 'net', 'tls', 'child_process'].includes(request.replace(/^node:/, ''))) {
        throw new Error(`Network/process access blocked in isolated fixture: ${request}`);
    }
    return originalLoad.call(this, request, parent, isMain);
};
window.__fixture = fixture;
window.fetch = async () => { throw new Error('Live requests are forbidden in this fixture.'); };
window.addEventListener('error', event => { fixture.error = String(event.error || event.message); });
window.addEventListener('unhandledrejection', event => { fixture.error = String(event.reason); });
