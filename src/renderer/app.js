var fbConfig = require('./firebase-config');
var db = fbConfig.db;
var rawDb = fbConfig.rawDb;
var firebase = fbConfig.firebase;
var setProjectId = fbConfig.setProjectId;
var getProjectId = fbConfig.getProjectId;
var isD1 = fbConfig.isD1;
var serverTimestamp = fbConfig.serverTimestamp;
var posAuthenticate = fbConfig.posAuthenticate;
var electron = require('electron');
var ipcRenderer = electron.ipcRenderer;
var fs = require('fs');
var path = require('path');

// App version from package.json
var APP_VERSION = '2.0.1';

// ============ STATE ============
var products = [];
var cart = [];
var bills = [];
var withdrawals = [];
var debtPayments = [];
var debtManual = [];
var returnRecords = [];
var registerRecords = [];
var registerBalance = 0;
var heldSales = [];
var damageRecords = [];
var selectedPayment = 'cash';
var pendingCustomer = null;
var currentPage = 'sales';
var currentUser = null;
var licenseValid = false;

var varModalProduct = null;
var varModalColor = null;
var varModalSize = null;
var varModalTarget = 'sale';
var catModalType = null;
var catModalBrand = null;
var catModalSize = null;
var catModalTarget = 'sale';
var catModalShowCats = false;
var returnReplaceCart = [];
var returnSourceBill = null;
var currentReceiptBill = null;
var openInvRows = {};

// ============ SECURITY: LICENSE CHECK ============
function checkLicense() {
    var storeId = getProjectId();
    if (!storeId) {
        showLogin();
        return Promise.resolve();
    }
    return db.collection('settings').doc('pos').get({ source: 'server' }).then(function (doc) {
        if (!doc.exists) {
            showLicenseExpired(new Date());
            return;
        }
        var data = doc.data();
        if (!data.warrantyEnd) {
            showLicenseExpired(new Date());
            return;
        }
        var endDate = data.warrantyEnd.toDate ? data.warrantyEnd.toDate() : new Date(data.warrantyEnd);
        if (endDate < new Date()) {
            showLicenseExpired(endDate);
            return;
        }
        licenseValid = true;
        db.collection('settings').doc('pos').update({
            lastChecked: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(function () {});
        showLogin();
    }).catch(function () {
        showLicenseExpired(new Date());
    });
}

function showLicenseExpired(date) {
    licenseValid = false;
    document.getElementById('licenseExpDate').textContent = date.toLocaleDateString('ar-EG');
    document.getElementById('licenseOverlay').style.display = 'flex';
    document.getElementById('loadingScreen').style.display = 'none';
}

// ============ AUTH SYSTEM ============
function showLogin() {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    // Auto-fill store name from last session
    var savedStore = '';
    try { savedStore = localStorage.getItem('ada_pos_store') || ''; } catch (e) {}
    document.getElementById('loginStoreName').value = savedStore;
}

function attemptLogin() {
    var storeName = document.getElementById('loginStoreName').value.trim().toLowerCase();
    var username = document.getElementById('loginUsername').value.trim();
    var password = document.getElementById('loginPassword').value;
    var errorEl = document.getElementById('loginError');

    if (!storeName || !username || !password) {
        errorEl.textContent = 'يرجى إدخال اسم المتجر واسم المستخدم وكلمة المرور';
        return;
    }

    errorEl.textContent = '';
    var loginBtn = document.getElementById('loginBtn');
    loginBtn.textContent = 'جاري الدخول...';
    loginBtn.disabled = true;

    // Set project ID dynamically
    setProjectId(storeName);

    // First verify store exists and license is valid
    db.collection('settings').doc('pos').get({ source: 'server' }).then(function (doc) {
        if (!doc.exists) {
            errorEl.textContent = 'المتجر غير موجود أو لم يتم إعداد نقطة البيع';
            loginBtn.textContent = 'دخول';
            loginBtn.disabled = false;
            return;
        }
        var data = doc.data();
        if (data.warrantyEnd) {
            var endDate = data.warrantyEnd.toDate ? data.warrantyEnd.toDate() : new Date(data.warrantyEnd);
            if (endDate < new Date()) {
                showLicenseExpired(endDate);
                loginBtn.textContent = 'دخول';
                loginBtn.disabled = false;
                return;
            }
        }
        licenseValid = true;
        db.collection('settings').doc('pos').update({
            lastChecked: firebase.firestore.FieldValue.serverTimestamp()
        }).catch(function () {});

        // Now authenticate user. For D1 tenants the comparison happens
        // server-side (no hash/password list ever reaches this client).
        if (isD1()) {
            return posAuthenticate(username, password).then(function (user) {
                return { __d1user: user };
            }).catch(function (e) {
                if (e.status === 401 || e.status === 403) return { __authFailed: true };
                throw e;
            });
        }
        return db.collection('settings').doc('pos_users').get();
    }).then(function (doc) {
        if (!doc) return; // license expired path
        var found = null;
        if (doc.__d1user || doc.__authFailed) {
            // D1 server-side auth result
            if (doc.__authFailed || !doc.__d1user) {
                errorEl.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة';
                loginBtn.textContent = 'دخول';
                loginBtn.disabled = false;
                return;
            }
            var u = doc.__d1user;
            found = { username: u.username, displayName: u.name, role: u.role, active: true };
        } else {
            if (!doc.exists) {
                errorEl.textContent = 'لم يتم إعداد المستخدمين بعد';
                loginBtn.textContent = 'دخول';
                loginBtn.disabled = false;
                return;
            }
            var data = doc.data();
            var users = data.users || [];
            for (var i = 0; i < users.length; i++) {
                if (users[i].username === username && users[i].password === password && users[i].active !== false) {
                    found = users[i];
                    break;
                }
            }
        }
        if (!found) {
            errorEl.textContent = 'اسم المستخدم أو كلمة المرور غير صحيحة';
            loginBtn.textContent = 'دخول';
            loginBtn.disabled = false;
            return;
        }
        currentUser = found;
        // Save store name for next time
        try { localStorage.setItem('ada_pos_store', storeName); } catch (e) {}
        logActivity('login', found.displayName + ' قام بتسجيل الدخول');
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('appContainer').style.display = 'flex';
        document.getElementById('currentUserName').textContent = found.displayName || found.username;
        document.getElementById('sidebarStoreName').textContent = storeName;
        document.getElementById('appVersion').textContent = 'v' + APP_VERSION;
        initApp();
        setupUpdaterListeners();
        checkForUpdates();
    }).catch(function (err) {
        errorEl.textContent = 'خطأ في الاتصال: ' + err.message;
        loginBtn.textContent = 'دخول';
        loginBtn.disabled = false;
    });
}

function logout() {
    if (currentUser) {
        logActivity('logout', (currentUser.displayName || currentUser.username) + ' قام بتسجيل الخروج');
    }
    currentUser = null;
    cart = [];
    if (fbConfig.clearPosToken) fbConfig.clearPosToken();
    document.getElementById('appContainer').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginUsername').value = '';
    // Keep store name filled from localStorage
    var savedStore = '';
    try { savedStore = localStorage.getItem('ada_pos_store') || ''; } catch (e) {}
    document.getElementById('loginStoreName').value = savedStore;
    var loginBtn = document.getElementById('loginBtn');
    loginBtn.textContent = 'دخول';
    loginBtn.disabled = false;
    document.getElementById('loginError').textContent = '';
}

// ============ AUTO-UPDATE SYSTEM ============
function compareVersions(v1, v2) {
    var parts1 = v1.split('.').map(Number);
    var parts2 = v2.split('.').map(Number);
    for (var i = 0; i < 3; i++) {
        var a = parts1[i] || 0;
        var b = parts2[i] || 0;
        if (a > b) return 1;
        if (a < b) return -1;
    }
    return 0;
}

function checkForUpdates() {
    rawDb.collection('projects').doc('_global').collection('settings').doc('pos_updates').get().then(function (doc) {
        if (!doc.exists) return;
        var data = doc.data();
        var remoteVersion = data.currentVersion || '0.0.0';
        var minVersion = data.minVersion || '0.0.0';
        var forceUpdate = data.forceUpdate === true;
        var downloadUrl = data.downloadUrl || '';
        var releaseNotes = data.releaseNotes || '';

        // Security: only allow HTTPS URLs from trusted domains
        if (downloadUrl && !isAllowedUpdateUrl(downloadUrl)) {
            console.warn('Blocked untrusted update URL');
            return;
        }

        // Check if update available
        if (compareVersions(remoteVersion, APP_VERSION) > 0) {
            // Check if force update required
            if (forceUpdate && compareVersions(APP_VERSION, minVersion) < 0) {
                showForceUpdate(remoteVersion, releaseNotes, downloadUrl);
            } else {
                showUpdateAvailable(remoteVersion, releaseNotes, downloadUrl);
            }
        }
    }).catch(function () {});
}

// Security: validate update URLs against trusted domains
function isAllowedUpdateUrl(url) {
    var trustedDomains = [
        'https://github.com/alsadiayham-sketch/',
        'https://drive.google.com/',
        'https://web-designer-555.pages.dev/'
    ];
    for (var i = 0; i < trustedDomains.length; i++) {
        if (url.indexOf(trustedDomains[i]) === 0) return true;
    }
    return false;
}

function showUpdateAvailable(version, notes, url) {
    var overlay = document.getElementById('updateOverlay');
    document.getElementById('updateVersion').textContent = version;
    document.getElementById('updateNotes').textContent = notes;
    setUpdateButtonToInstall(url);
    document.getElementById('updateDismissBtn').style.display = 'inline-block';
    document.getElementById('updateDismissBtn').onclick = function () {
        overlay.style.display = 'none';
    };
    document.getElementById('updateForceMsg').style.display = 'none';
    overlay.style.display = 'flex';
}

function showForceUpdate(version, notes, url) {
    var overlay = document.getElementById('updateOverlay');
    document.getElementById('updateVersion').textContent = version;
    document.getElementById('updateNotes').textContent = notes;
    setUpdateButtonToInstall(url);
    document.getElementById('updateDismissBtn').style.display = 'none';
    document.getElementById('updateForceMsg').style.display = 'block';
    overlay.style.display = 'flex';
    // Block the app
    document.getElementById('appContainer').style.display = 'none';
}

// ===== In-app auto-update wiring (electron-updater) =====
var _updateDownloadUrl = '';
var _updaterListening = false;

function setUpdateText(msg) {
    var el = document.getElementById('updateProgressText');
    if (el) { el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none'; }
}
function setUpdateProgress(pct) {
    var wrap = document.getElementById('updateProgressWrap');
    var bar = document.getElementById('updateProgressBar');
    if (wrap) wrap.style.display = (pct === null) ? 'none' : 'block';
    if (bar && pct !== null) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

// Fall back to a plain browser download if in-app update can't run.
function fallbackToBrowserDownload(url) {
    var btn = document.getElementById('updateDownloadBtn');
    btn.disabled = false;
    btn.textContent = '⬇ تحميل التحديث من المتصفح';
    btn.onclick = function () { if (url) electron.shell.openExternal(url); };
}

function setUpdateButtonToInstall(url) {
    _updateDownloadUrl = url || '';
    var btn = document.getElementById('updateDownloadBtn');
    btn.disabled = false;
    btn.textContent = '⬇ تحديث التطبيق الآن';
    setUpdateProgress(null);
    setUpdateText('');
    btn.onclick = function () {
        btn.disabled = true;
        btn.textContent = '... جارٍ التحقق من التحديث';
        setUpdateText('جارٍ الاتصال بخادم التحديثات...');
        if (!ipcRenderer || !ipcRenderer.invoke) { fallbackToBrowserDownload(_updateDownloadUrl); return; }
        ipcRenderer.invoke('updater-start').then(function (res) {
            if (!res || !res.ok) {
                // Dev mode or updater error -> let the user download manually.
                setUpdateText('تعذّر التحديث التلقائي، يمكنك التحميل يدوياً.');
                fallbackToBrowserDownload(_updateDownloadUrl);
            }
        }).catch(function () {
            fallbackToBrowserDownload(_updateDownloadUrl);
        });
    };
}

function setupUpdaterListeners() {
    if (_updaterListening || !ipcRenderer || !ipcRenderer.on) return;
    _updaterListening = true;
    var btn = document.getElementById('updateDownloadBtn');

    ipcRenderer.on('updater-available', function () {
        if (btn) btn.textContent = '... جارٍ تنزيل التحديث';
        setUpdateText('جارٍ تنزيل التحديث، الرجاء الانتظار...');
        setUpdateProgress(0);
    });
    ipcRenderer.on('updater-progress', function (event, p) {
        var pct = Math.round(p && p.percent || 0);
        setUpdateProgress(pct);
        var mb = (p && p.total) ? (p.transferred / 1048576).toFixed(1) + ' / ' + (p.total / 1048576).toFixed(1) + ' م.ب' : '';
        setUpdateText('جارٍ التنزيل ' + pct + '% ' + mb);
    });
    ipcRenderer.on('updater-downloaded', function () {
        setUpdateProgress(100);
        setUpdateText('تم تنزيل التحديث. سيتم إعادة تشغيل التطبيق للتثبيت.');
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔄 إعادة التشغيل والتثبيت الآن';
            btn.onclick = function () {
                btn.disabled = true;
                btn.textContent = '... جارٍ التثبيت';
                ipcRenderer.invoke('updater-install');
            };
        }
    });
    ipcRenderer.on('updater-none', function () {
        setUpdateText('أنت تستخدم أحدث إصدار.');
        fallbackToBrowserDownload(_updateDownloadUrl);
    });
    ipcRenderer.on('updater-error', function (event, e) {
        setUpdateProgress(null);
        setUpdateText('حدث خطأ أثناء التحديث التلقائي. يمكنك التحميل يدوياً.');
        fallbackToBrowserDownload(_updateDownloadUrl);
    });
}

// ============ ACTIVITY LOGS ============
function logActivity(type, description, details) {
    var logEntry = {
        type: type,
        description: description,
        user: currentUser ? (currentUser.displayName || currentUser.username) : 'system',
        timestamp: serverTimestamp(),
        details: details || null
    };
    db.collection('pos_logs').add(logEntry).catch(function () {});
}

// ============ INIT ============
function initApp() {
    setupNetworkListeners();
    setupEventListeners();
    applyRoleVisibility();
    loadShortcuts();
    renderShortcutsEditor();
    initShortcutsUI();
    initGeneralNotes();
    loadHeldSales();
    updatePaymentUI();
    // Load first batch of products fast, then subscribe to rest
    loadProductsBatch();
    subscribeBills();
    subscribeDamage();
}

// ============ THEMED CONFIRM / ALERT ============
var _confirmCb = null;
function showConfirm(message, onYes, opts) {
    opts = opts || {};
    _confirmCb = onYes || null;
    document.getElementById('confirmIcon').textContent = opts.icon || '⚠️';
    document.getElementById('confirmTitle').textContent = opts.title || 'تأكيد';
    document.getElementById('confirmMessage').textContent = message || '';
    var yes = document.getElementById('confirmYesBtn');
    var no = document.getElementById('confirmNoBtn');
    yes.textContent = opts.yesText || 'نعم';
    no.style.display = opts.alert ? 'none' : 'inline-flex';
    no.textContent = opts.noText || 'إلغاء';
    document.getElementById('confirmModal').style.display = 'flex';
}
function showAlert(message, opts) {
    opts = opts || {};
    opts.alert = true;
    opts.yesText = opts.yesText || 'حسناً';
    if (opts.icon === undefined) opts.icon = '✅';
    if (opts.title === undefined) opts.title = 'تم';
    showConfirm(message, null, opts);
}
function _closeConfirm() { document.getElementById('confirmModal').style.display = 'none'; _confirmCb = null; }

// ============ ROLE-BASED VISIBILITY ============
function isAdmin() {
    return !!(currentUser && currentUser.role === 'admin');
}
function applyRoleVisibility() {
    var btn = document.getElementById('closeDayBtn');
    if (btn) btn.style.display = isAdmin() ? 'inline-flex' : 'none';
}

// ============ WORK DAY / SHIFT (per terminal) ============
function dayStartKey() { return 'ada_pos_day_start_' + (getProjectId() || ''); }
function getDayStart() {
    var v = null;
    try { v = localStorage.getItem(dayStartKey()); } catch (e) {}
    if (v) return parseInt(v, 10);
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var ms = d.getTime();
    try { localStorage.setItem(dayStartKey(), String(ms)); } catch (e) {}
    return ms;
}
function setDayStart(ms) { try { localStorage.setItem(dayStartKey(), String(ms)); } catch (e) {} }

function billTimeMs(b) {
    if (b.createdAt && b.createdAt.toDate) return b.createdAt.toDate().getTime();
    if (b.createdAtIso) return new Date(b.createdAtIso).getTime();
    return 0;
}

// POS (register) activity since the last day-close on this terminal.
function computeShiftSummary() {
    var start = getDayStart();
    var cash = 0, card = 0, debtNew = 0, count = 0;
    for (var i = 0; i < bills.length; i++) {
        var b = bills[i];
        if (b.source !== 'pos') continue;
        if (billTimeMs(b) < start) continue;
        var t = b.total || 0;
        if (b.paymentMethod === 'card') card += t;
        else if (b.paymentMethod === 'debt') debtNew += t;
        else cash += t;
        count++;
    }
    for (var i = 0; i < debtManual.length; i++) {
        if (billTimeMs(debtManual[i]) < start) continue;
        debtNew += debtManual[i].amount || 0;
    }
    var withdrawn = 0, wCount = 0;
    for (var i = 0; i < withdrawals.length; i++) {
        if (billTimeMs(withdrawals[i]) < start) continue;
        withdrawn += withdrawals[i].amount || 0; wCount++;
    }
    var debtPaidCash = 0;
    for (var i = 0; i < debtPayments.length; i++) {
        if (billTimeMs(debtPayments[i]) < start) continue;
        if (debtPayments[i].paymentMethod === 'card') card += debtPayments[i].amount || 0;
        else debtPaidCash += debtPayments[i].amount || 0;
    }
    var returnsCash = 0;
    for (var i = 0; i < returnRecords.length; i++) {
        if (billTimeMs(returnRecords[i]) < start) continue;
        // net < 0 means money refunded to customer (cash out); net > 0 means customer paid extra
        var net = returnRecords[i].net || 0;
        if ((returnRecords[i].paymentMethod || 'cash') !== 'card') returnsCash += net;
    }
    cash += debtPaidCash;
    var opening = registerBalance || 0;
    var drawer = opening + cash - withdrawn + returnsCash;
    return {
        cash: cash, card: card, debtNew: debtNew, total: cash + card,
        count: count, withdrawn: withdrawn, wCount: wCount,
        debtPaidCash: debtPaidCash, returnsCash: returnsCash,
        opening: opening, drawer: drawer, since: start
    };
}

function openCloseDayModal() {
    if (!isAdmin()) { showAlert('هذه الميزة متاحة للمدير فقط', { icon: '🔒', title: 'غير مصرّح' }); return; }
    var s = computeShiftSummary();
    var sinceStr = new Date(s.since).toLocaleString('ar-EG');
    var html = '';
    html += '<p class="cd-since">منذ آخر إغلاق: ' + sinceStr + '</p>';
    html += '<div class="cd-row"><span>رصيد الصندوق الافتتاحي 🏦</span><span>\u20AA' + s.opening.toFixed(2) + '</span></div>';
    html += '<div class="cd-row"><span>مبيعات نقدي 💵</span><span>\u20AA' + s.cash.toFixed(2) + '</span></div>';
    html += '<div class="cd-row"><span>مبيعات بطاقة 💳</span><span>\u20AA' + s.card.toFixed(2) + '</span></div>';
    html += '<div class="cd-row cd-total"><span>إجمالي المبيعات</span><span>\u20AA' + s.total.toFixed(2) + '</span></div>';
    html += '<div class="cd-row"><span>عدد الفواتير</span><span>' + s.count + '</span></div>';
    if (s.debtNew) html += '<div class="cd-row"><span>مبيعات آجلة (ذمم جديدة) 📒</span><span>\u20AA' + s.debtNew.toFixed(2) + '</span></div>';
    if (s.debtPaidCash) html += '<div class="cd-row"><span>تسديد ذمم (نقدي) 💰</span><span>\u20AA' + s.debtPaidCash.toFixed(2) + '</span></div>';
    if (s.returnsCash) html += '<div class="cd-row"><span>صافي المرتجعات (نقدي) ↩️</span><span>\u20AA' + s.returnsCash.toFixed(2) + '</span></div>';
    if (s.withdrawn) html += '<div class="cd-row"><span>سحوبات شخصية (' + s.wCount + ') 💸</span><span>-\u20AA' + s.withdrawn.toFixed(2) + '</span></div>';
    html += '<div class="cd-row cd-total"><span>الصندوق المتوقع (نقدي)</span><span>\u20AA' + s.drawer.toFixed(2) + '</span></div>';
    html += '<div class="cd-left-row"><label>المبلغ المتروك في الصندوق (رصيد الغد) 🏦</label>' +
        '<input type="number" id="closeLeftAmount" min="0" step="0.01" value="' + s.drawer.toFixed(2) + '">' +
        '<span class="cd-removed" id="closeRemovedHint"></span></div>';
    html += '<div class="cd-left-row"><label>سبب/وجهة المبلغ المسحوب (اختياري)</label>' +
        '<input type="text" id="closeRemovedNote" placeholder="مثال: إيداع بنكي، تسليم للمالك..."></div>';
    html += '<p class="cd-note">⚠️ قارن المبلغ النقدي المتوقع (\u20AA' + s.drawer.toFixed(2) + ') مع ما في الصندوق قبل التأكيد. المبلغ الذي تتركه يصبح رصيد الصندوق الافتتاحي لليوم التالي.</p>';
    document.getElementById('closeDaySummary').innerHTML = html;
    var leftInput = document.getElementById('closeLeftAmount');
    var removedHint = document.getElementById('closeRemovedHint');
    function updRemoved() {
        var left = parseFloat(leftInput.value) || 0;
        var removed = s.drawer - left;
        removedHint.textContent = removed > 0.001 ? ('المسحوب من الصندوق: \u20AA' + removed.toFixed(2)) :
            (removed < -0.001 ? ('المضاف للصندوق: \u20AA' + Math.abs(removed).toFixed(2)) : 'لم يُسحب شيء');
    }
    leftInput.addEventListener('input', updRemoved);
    updRemoved();
    document.getElementById('closeDayModal').style.display = 'flex';
}

// First confirm button -> ask a second themed confirmation before resetting.
function confirmCloseDay() {
    if (!isAdmin()) return;
    var s = computeShiftSummary();
    showConfirm(
        'سيتم تصفير إجمالي الوردية (\u20AA' + s.total.toFixed(2) + ') ولا يمكن التراجع عن العملية. هل أنت متأكد من إغلاق اليوم؟',
        doCloseDay,
        { icon: '🔒', title: 'تأكيد إغلاق اليوم', yesText: 'نعم، أغلق اليوم', noText: 'تراجع' }
    );
}

function doCloseDay() {
    if (!isAdmin()) return;
    var s = computeShiftSummary();
    var leftEl = document.getElementById('closeLeftAmount');
    var leftAmount = leftEl ? (parseFloat(leftEl.value) || 0) : s.drawer;
    var removedNoteEl = document.getElementById('closeRemovedNote');
    var removedNote = removedNoteEl ? removedNoteEl.value.trim() : '';
    s.left = leftAmount;
    s.removed = s.drawer - leftAmount;
    setDayStart(Date.now());
    // Persist the amount left in the drawer as the opening float for the next shift (store-shared).
    savePosRecord({ recordType: 'register', kind: 'close', balance: leftAmount, removed: s.removed, removedNote: removedNote, total: 0 }, 'REG');
    registerBalance = leftAmount;
    logActivity('day_close', 'إغلاق اليوم — نقدي: \u20AA' + s.cash.toFixed(2) + ' | بطاقة: \u20AA' + s.card.toFixed(2) + ' | الإجمالي: \u20AA' + s.total.toFixed(2) + ' | المتروك بالصندوق: \u20AA' + leftAmount.toFixed(2) + ' | المسحوب: \u20AA' + s.removed.toFixed(2) + (removedNote ? ' (' + removedNote + ')' : ''), {
        cash: s.cash, card: s.card, total: s.total, count: s.count, opening: s.opening, leftInDrawer: leftAmount, removed: s.removed, removedNote: removedNote
    });
    document.getElementById('closeDayModal').style.display = 'none';
    printDayClose(s);
    updateReports();
    showAlert('تم إغلاق اليوم وتصفير الإجمالي بنجاح ✅\nرصيد الصندوق لليوم التالي: \u20AA' + leftAmount.toFixed(2), { icon: '✅', title: 'تم الإغلاق' });
}

// Build & silently print the day-close (shift) report on the thermal printer.
function buildDayCloseInnerHTML(s) {
    var nowStr = new Date().toLocaleString('ar-EG');
    var sinceStr = new Date(s.since).toLocaleString('ar-EG');
    var html = '';
    html += '<div class="r-title">تقرير إغلاق اليوم</div>';
    html += '<div class="r-meta">عقاد كيدز</div>';
    html += '<div class="r-meta">تاريخ الطباعة: ' + nowStr + '</div>';
    html += '<div class="r-meta">منذ: ' + sinceStr + '</div>';
    if (currentUser && currentUser.username) html += '<div class="r-meta">المدير: ' + currentUser.username + '</div>';
    html += '<table class="r-totals">';
    html += '<tr><td>رصيد الصندوق الافتتاحي</td><td>\u20AA' + (s.opening || 0).toFixed(2) + '</td></tr>';
    html += '<tr><td>مبيعات نقدي</td><td>\u20AA' + s.cash.toFixed(2) + '</td></tr>';
    html += '<tr><td>مبيعات بطاقة</td><td>\u20AA' + s.card.toFixed(2) + '</td></tr>';
    html += '<tr><td>عدد الفواتير</td><td>' + s.count + '</td></tr>';
    if (s.debtNew) html += '<tr><td>ذمم جديدة (آجل)</td><td>\u20AA' + s.debtNew.toFixed(2) + '</td></tr>';
    if (s.debtPaidCash) html += '<tr><td>تسديد ذمم نقدي</td><td>\u20AA' + s.debtPaidCash.toFixed(2) + '</td></tr>';
    if (s.returnsCash) html += '<tr><td>صافي المرتجعات</td><td>\u20AA' + s.returnsCash.toFixed(2) + '</td></tr>';
    if (s.withdrawn) html += '<tr><td>سحوبات شخصية</td><td>-\u20AA' + s.withdrawn.toFixed(2) + '</td></tr>';
    html += '<tr class="r-grand"><td>الصندوق المتوقع</td><td>\u20AA' + s.drawer.toFixed(2) + '</td></tr>';
    if (typeof s.left === 'number') {
        html += '<tr><td>المتروك بالصندوق</td><td>\u20AA' + s.left.toFixed(2) + '</td></tr>';
        html += '<tr><td>المسحوب من الصندوق</td><td>\u20AA' + (s.removed || 0).toFixed(2) + '</td></tr>';
    }
    html += '</table>';
    html += '<div class="r-thanks">المبلغ النقدي يجب أن يطابق الصندوق</div>';
    return html;
}
function printDayClose(s) {
    try {
        var inner = buildDayCloseInnerHTML(s);
        var doc = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>' +
            RECEIPT_PRINT_CSS + '</style></head><body><div class="receipt">' + inner + '</div></body></html>';
        if (ipcRenderer && ipcRenderer.invoke) {
            ipcRenderer.invoke('print-html', doc).catch(function () {});
        }
    } catch (e) {}
}

// ============ FIREBASE SUBSCRIPTIONS ============
var productsLoaded = false;

function loadProductsBatch() {
    // Load first 20 products immediately for fast display
    db.collection('products').limit(20).get().then(function (snapshot) {
        products = [];
        snapshot.forEach(function (doc) {
            var p = doc.data();
            p.id = doc.id;
            products.push(p);
        });
        renderProducts();
        renderInventory();
        updateReports();
        updateSyncStatus(true);
        // Then subscribe to ALL products in background for real-time updates
        subscribeAllProducts();
    }).catch(function () {
        updateSyncStatus(false);
        // Fallback: subscribe directly
        subscribeAllProducts();
    });
}

function subscribeAllProducts() {
    db.collection('products').onSnapshot(function (snapshot) {
        products = [];
        snapshot.forEach(function (doc) {
            var p = doc.data();
            p.id = doc.id;
            products.push(p);
        });
        renderProducts();
        renderInventory();
        updateReports();
        updateSyncStatus(true);
        productsLoaded = true;
    }, function () {
        updateSyncStatus(false);
    });
}

function subscribeBills() {
    db.collection('orders').onSnapshot(function (snapshot) {
        bills = [];
        withdrawals = [];
        debtPayments = [];
        debtManual = [];
        returnRecords = [];
        registerRecords = [];
        snapshot.forEach(function (doc) {
            var b = doc.data();
            b.id = doc.id;
            var rt = b.recordType;
            if (rt === 'withdrawal') withdrawals.push(b);
            else if (rt === 'debt-payment') debtPayments.push(b);
            else if (rt === 'debt-manual') debtManual.push(b);
            else if (rt === 'return') returnRecords.push(b);
            else if (rt === 'register') registerRecords.push(b);
            else bills.push(b); // normal or debt sale
        });
        bills.sort(billSortDesc);
        withdrawals.sort(billSortDesc);
        debtPayments.sort(billSortDesc);
        debtManual.sort(billSortDesc);
        returnRecords.sort(billSortDesc);
        registerRecords.sort(billSortDesc);
        registerBalance = registerRecords.length ? (registerRecords[0].balance || 0) : 0;
        renderBills();
        updateReports();
        renderReturnsHistory();
        renderDebts();
        renderRegisterSettings();
    }, function (err) {
        console.error('Bills subscription error:', err);
    });
}

function billSortDesc(a, b) {
    return billTimeMs(b) - billTimeMs(a);
}

function subscribeDamage() {
    db.collection('pos_damage').orderBy('createdAt', 'desc').limit(100).onSnapshot(function (snapshot) {
        damageRecords = [];
        snapshot.forEach(function (doc) {
            var d = doc.data();
            d.id = doc.id;
            damageRecords.push(d);
        });
        renderDamageHistory();
        updateReports();
    });
}

function updateSyncStatus(online) {
    var dot = document.querySelector('.sync-dot');
    var label = document.querySelector('.sync-status span:last-child');
    var banner = document.getElementById('offlineBanner');
    if (online) {
        dot.classList.add('online');
        label.textContent = 'متصل';
        if (banner) banner.style.display = 'none';
    } else {
        dot.classList.remove('online');
        label.textContent = 'غير متصل';
        if (banner) banner.style.display = 'flex';
    }
}

// Network detection
function setupNetworkListeners() {
    window.addEventListener('online', function () { updateSyncStatus(true); });
    window.addEventListener('offline', function () { updateSyncStatus(false); });
    if (!navigator.onLine) updateSyncStatus(false);
}

// ============ RENDER PRODUCTS ============
function renderProducts() {
    var grid = document.getElementById('productsGrid');
    var searchVal = (document.getElementById('productSearch').value || '').toLowerCase();
    var catFilter = document.getElementById('categoryFilter').value;

    renderCategoryBoxes();
    var boxesTitle = document.getElementById('categoryBoxesTitle');
    var boxesEl = document.getElementById('categoryBoxes');
    var showBoxes = !searchVal && !catFilter;
    if (boxesTitle) boxesTitle.style.display = showBoxes ? 'block' : 'none';
    if (boxesEl) boxesEl.style.display = showBoxes ? 'grid' : 'none';

    // Main page shows category boxes only by default. The full product list appears
    // only when the user searches or picks a category filter (keeps the page clean).
    if (!searchVal && !catFilter) {
        grid.innerHTML = '<div class="grid-hint">اختر تصنيفاً من الأعلى، أو ابحث بالاسم/الباركود لعرض المنتجات</div>';
        return;
    }

    var filtered = products.filter(function (p) {
        if (p.status === 'disabled') return false;
        var matchSearch = !searchVal || (p.name || '').toLowerCase().indexOf(searchVal) >= 0 || (p.id + '').indexOf(searchVal) >= 0;
        var matchCat = !catFilter || p.type === catFilter;
        return matchSearch && matchCat;
    });

    // Cap how many cards we render at once. With thousands of products a broad
    // search (e.g. a single letter) could match everything; rendering them all
    // bloats the DOM and hurts scrolling. We show the first RENDER_CAP and prompt
    // the user to refine — they can always narrow by name/code/category.
    var RENDER_CAP = 300;
    var totalMatches = filtered.length;
    var capped = totalMatches > RENDER_CAP;
    if (capped) filtered = filtered.slice(0, RENDER_CAP);

    // Group products into sections by category/type for easier manual browsing.
    var groups = {}, order = [];
    for (var i = 0; i < filtered.length; i++) {
        var t = filtered[i].type || 'أخرى';
        if (!groups[t]) { groups[t] = []; order.push(t); }
        groups[t].push(filtered[i]);
    }

    var html = '';
    if (capped) {
        html += '<div class="grid-hint" style="grid-column:1/-1;">عدد النتائج كبير (' + totalMatches + '). يتم عرض أول ' + RENDER_CAP + ' — حدّد البحث أكثر للوصول لمنتج معيّن.</div>';
    }
    for (var g = 0; g < order.length; g++) {
        var sec = order[g];
        var list = groups[sec];
        html += '<div class="section-header">' + escapeHtml(sec) + ' <span class="section-count">' + list.length + '</span></div>';
        for (var k = 0; k < list.length; k++) {
            var p = list[k];
            var totalStock = getTotalStock(p);
            var outClass = totalStock <= 0 ? ' out-of-stock' : '';
            var img = p.image || '';
            html += '<div class="product-card' + outClass + '" data-id="' + escapeHtml(p.id) + '">';
            if (img) html += '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(p.name || '') + '" onerror="this.style.display=\'none\'" loading="lazy">';
            html += '<div class="p-name">' + escapeHtml(p.name || '') + '</div>';
            html += '<div class="p-code">#' + escapeHtml(p.id) + '</div>';
            html += '<div class="p-price">\u20AA' + getMinPrice(p) + '</div>';
            html += '<div class="p-stock">' + totalStock + ' قطعة</div>';
            html += '</div>';
        }
    }

    grid.innerHTML = html || '<div style="text-align:center;color:var(--text-dim);padding:40px;grid-column:1/-1;">لا توجد منتجات</div>';
}

// ============ CATEGORY BOXES + BRAND/FILTER POPUP ============
var CATEGORY_ICONS = { 'ملابس': '👕', 'أحذية': '👟', 'إكسسوارات': '🎀', 'كريمات وعطور': '🧴', 'أخرى': '📦' };

function renderCategoryBoxes() {
    var box = document.getElementById('categoryBoxes');
    if (!box) return;
    var counts = {}, order = [];
    for (var i = 0; i < products.length; i++) {
        var p = products[i];
        if (p.status === 'disabled') continue;
        var t = p.type || 'أخرى';
        if (!(t in counts)) { counts[t] = 0; order.push(t); }
        counts[t]++;
    }
    var html = '';
    for (var g = 0; g < order.length; g++) {
        var t = order[g];
        var ic = CATEGORY_ICONS[t] || '📦';
        html += '<div class="category-box" data-type="' + escapeHtml(t) + '">' +
            '<span class="cat-ic">' + ic + '</span>' +
            '<span class="cat-name">' + escapeHtml(t) + '</span>' +
            '<span class="cat-count">' + counts[t] + '</span></div>';
    }
    box.innerHTML = html;
}

function openCategoryModal(type, target, showCats) {
    catModalType = type || null;
    catModalBrand = null;
    catModalSize = null;
    catModalTarget = target || 'sale';
    catModalShowCats = !!showCats;
    var title = catModalType ? ((CATEGORY_ICONS[catModalType] || '📦') + ' ' + catModalType)
        : (catModalTarget === 'return' ? '🔁 اختر الصنف البديل' : 'اختر منتجاً');
    document.getElementById('categoryModalTitle').textContent = title;
    document.getElementById('categorySearch').value = '';
    document.getElementById('categoryCats').style.display = catModalShowCats ? 'flex' : 'none';
    document.getElementById('categoryCatsLabel').style.display = catModalShowCats ? 'block' : 'none';
    renderCategoryModal();
    document.getElementById('categoryModal').style.display = 'flex';
    setTimeout(function () { var s = document.getElementById('categorySearch'); if (s) s.focus(); }, 50);
}

function categoryProductMatches(p) {
    if (p.status === 'disabled') return false;
    if (catModalType && (p.type || 'أخرى') !== catModalType) return false;
    if (catModalBrand && (p.brand || 'غير محدد') !== catModalBrand) return false;
    if (catModalSize) {
        var has = (p.variants || []).some(function (v) { return v.size === catModalSize && (v.stock || 0) > 0; });
        if (!has) return false;
    }
    return true;
}

function renderCategoryModal() {
    var term = (document.getElementById('categorySearch').value || '').trim().toLowerCase();
    // Category chips (picker mode only)
    if (catModalShowCats) {
        var typeOrder = [], typeSeen = {};
        for (var ti = 0; ti < products.length; ti++) {
            var tp = products[ti];
            if (tp.status === 'disabled') continue;
            var tt = tp.type || 'أخرى';
            if (!(tt in typeSeen)) { typeSeen[tt] = 1; typeOrder.push(tt); }
        }
        var chtml = '<div class="cat-chip' + (catModalType === null ? ' active' : '') + '" data-cat="">الكل</div>';
        for (var t = 0; t < typeOrder.length; t++) {
            chtml += '<div class="cat-chip' + (catModalType === typeOrder[t] ? ' active' : '') + '" data-cat="' + escapeHtml(typeOrder[t]) + '">' + (CATEGORY_ICONS[typeOrder[t]] || '📦') + ' ' + escapeHtml(typeOrder[t]) + '</div>';
        }
        document.getElementById('categoryCats').innerHTML = chtml;
    }
    var brandOrder = [], brandSeen = {}, sizeOrder = [], sizeSeen = {};
    for (var i = 0; i < products.length; i++) {
        var p = products[i];
        if (p.status === 'disabled') continue;
        if (catModalType && (p.type || 'أخرى') !== catModalType) continue;
        var br = p.brand || 'غير محدد';
        if (!(br in brandSeen)) { brandSeen[br] = 1; brandOrder.push(br); }
        var vs = p.variants || [];
        for (var j = 0; j < vs.length; j++) {
            if ((vs[j].stock || 0) > 0 && vs[j].size && !(vs[j].size in sizeSeen)) {
                sizeSeen[vs[j].size] = 1; sizeOrder.push(vs[j].size);
            }
        }
    }
    var bhtml = '<div class="cat-chip' + (catModalBrand === null ? ' active' : '') + '" data-brand="">الكل</div>';
    for (var b = 0; b < brandOrder.length; b++) {
        bhtml += '<div class="cat-chip' + (catModalBrand === brandOrder[b] ? ' active' : '') + '" data-brand="' + escapeHtml(brandOrder[b]) + '">' + escapeHtml(brandOrder[b]) + '</div>';
    }
    document.getElementById('categoryBrands').innerHTML = bhtml;

    sizeOrder.sort(function (a, b) {
        var na = parseFloat(a), nb = parseFloat(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(a).localeCompare(String(b));
    });
    var shtml = '<div class="cat-chip' + (catModalSize === null ? ' active' : '') + '" data-size="">الكل</div>';
    for (var s = 0; s < sizeOrder.length; s++) {
        shtml += '<div class="cat-chip' + (catModalSize === sizeOrder[s] ? ' active' : '') + '" data-size="' + escapeHtml(sizeOrder[s]) + '">' + escapeHtml(sizeOrder[s]) + '</div>';
    }
    document.getElementById('categorySizes').innerHTML = shtml;

    var grid = document.getElementById('categoryProducts');
    var html = '';
    for (var k = 0; k < products.length; k++) {
        var pr = products[k];
        if (!categoryProductMatches(pr)) continue;
        if (term && (pr.name || '').toLowerCase().indexOf(term) < 0 && (pr.id + '').indexOf(term) < 0) continue;
        var totalStock = getTotalStock(pr);
        var outClass = totalStock <= 0 ? ' out-of-stock' : '';
        var img = pr.image || '';
        html += '<div class="product-card' + outClass + '" data-id="' + escapeHtml(pr.id) + '">';
        if (img) html += '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(pr.name || '') + '" onerror="this.style.display=\'none\'" loading="lazy">';
        html += '<div class="p-name">' + escapeHtml(pr.name || '') + '</div>';
        html += '<div class="p-code">#' + escapeHtml(pr.id) + '</div>';
        html += '<div class="p-price">\u20AA' + getMinPrice(pr) + '</div>';
        html += '<div class="p-stock">' + totalStock + ' قطعة</div>';
        html += '</div>';
    }
    grid.innerHTML = html || '<div style="text-align:center;color:var(--text-dim);padding:30px;grid-column:1/-1;">لا توجد منتجات مطابقة</div>';
}

function getTotalStock(product) {
    var total = 0;
    var variants = product.variants || [];
    for (var i = 0; i < variants.length; i++) {
        total += (variants[i].stock || 0);
    }
    return total;
}

function getMinPrice(product) {
    var min = Infinity;
    var variants = product.variants || [];
    for (var i = 0; i < variants.length; i++) {
        var price = variants[i].price || 0;
        if (price > 0 && price < min) min = price;
    }
    return min === Infinity ? 0 : min;
}

// ============ VARIANT MODAL ============
function openVariantModal(productId, target) {
    var product = products.find(function (p) { return p.id === productId; });
    if (!product) return;
    varModalTarget = target || 'sale';
    varModalProduct = product;
    varModalColor = null;
    varModalSize = null;
    document.getElementById('variantModalTitle').textContent = product.name;
    document.getElementById('varQtyInput').value = 1;
    // Auto-select the only in-stock color, if there is exactly one.
    var stockColors = (product.colors || []).filter(function (c) { return hasColorStock(product, c.name); });
    if (stockColors.length === 1) varModalColor = stockColors[0].name;
    renderVariantColors();
    renderVariantSizes();
    autoSelectSingleSize();
    document.getElementById('varStockInfo').textContent = '';
    document.getElementById('variantModal').style.display = 'flex';
}

// If the selected color has exactly one in-stock size, select it automatically.
function autoSelectSingleSize() {
    if (!varModalColor || varModalSize) { updateVariantAddBtn(); return; }
    var variants = varModalProduct.variants || [];
    var inStock = [];
    for (var i = 0; i < variants.length; i++) {
        if (variants[i].color === varModalColor && (variants[i].stock || 0) > 0) inStock.push(variants[i]);
    }
    if (inStock.length === 1) {
        varModalSize = inStock[0].size;
        renderVariantSizes();
    }
    updateVariantAddBtn();
}

// Disable the "add to cart" button until both a color and a size are chosen.
function updateVariantAddBtn() {
    var btn = document.getElementById('addToCartFromModal');
    if (!btn) return;
    btn.disabled = !(varModalColor && varModalSize);
}

function renderVariantColors() {
    var colors = varModalProduct.colors || [];
    var html = '';
    for (var i = 0; i < colors.length; i++) {
        var c = colors[i];
        var hasStock = hasColorStock(varModalProduct, c.name);
        var selClass = varModalColor === c.name ? ' selected' : '';
        var disClass = !hasStock ? ' disabled' : '';
        html += '<div class="color-option' + selClass + disClass + '" data-color="' + escapeHtml(c.name) + '" style="background:' + escapeHtml(c.hex || '#ccc') + '" title="' + escapeHtml(c.name) + '"></div>';
    }
    document.getElementById('variantColors').innerHTML = html;
}

function renderVariantSizes() {
    if (!varModalColor) {
        document.getElementById('variantSizes').innerHTML = '<span style="color:var(--text-dim)">اختر اللون أولاً</span>';
        updateVariantAddBtn();
        return;
    }
    var variants = varModalProduct.variants || [];
    var sizes = [];
    for (var i = 0; i < variants.length; i++) {
        if (variants[i].color === varModalColor) sizes.push(variants[i]);
    }
    var html = '';
    for (var i = 0; i < sizes.length; i++) {
        var v = sizes[i];
        var selClass = varModalSize === v.size ? ' selected' : '';
        var disClass = (v.stock || 0) <= 0 ? ' disabled' : '';
        html += '<div class="size-option' + selClass + disClass + '" data-size="' + escapeHtml(v.size) + '">' + escapeHtml(v.size) + '</div>';
    }
    document.getElementById('variantSizes').innerHTML = html || '<span style="color:var(--text-dim)">لا توجد مقاسات</span>';
    updateStockInfo();
    updateVariantAddBtn();
}

function hasColorStock(product, colorName) {
    var variants = product.variants || [];
    for (var i = 0; i < variants.length; i++) {
        if (variants[i].color === colorName && (variants[i].stock || 0) > 0) return true;
    }
    return false;
}

function updateStockInfo() {
    if (!varModalColor || !varModalSize) {
        document.getElementById('varStockInfo').textContent = '';
        return;
    }
    var variant = findVariant(varModalProduct, varModalColor, varModalSize);
    if (variant) {
        document.getElementById('varStockInfo').textContent = 'المتوفر: ' + (variant.stock || 0);
    }
}

function findVariant(product, color, size) {
    var variants = product.variants || [];
    for (var i = 0; i < variants.length; i++) {
        if (variants[i].color === color && variants[i].size === size) return variants[i];
    }
    return null;
}

function addVariantToCart(product, color, size, qty) {
    var variant = findVariant(product, color, size);
    if (!variant || (variant.stock || 0) <= 0) return false;
    qty = parseInt(qty) || 1;
    if (qty > variant.stock) qty = variant.stock;

    var cartKey = product.id + '_' + color + '_' + size;

    if (varModalTarget === 'return') {
        var ex = returnReplaceCart.find(function (item) { return item.key === cartKey; });
        if (ex) { ex.qty = Math.min(ex.qty + qty, variant.stock); }
        else {
            returnReplaceCart.push({
                key: cartKey, productId: product.id, name: product.name,
                color: color, size: size, price: variant.price || 0, qty: qty, maxStock: variant.stock
            });
        }
        renderReturnReplaceCart();
        return true;
    }

    var existing = cart.find(function (item) { return item.key === cartKey; });
    if (existing) {
        var newQty = existing.qty + qty;
        if (newQty > variant.stock) newQty = variant.stock;
        existing.qty = newQty;
    } else {
        cart.push({
            key: cartKey,
            productId: product.id,
            name: product.name,
            color: color,
            size: size,
            price: variant.price || 0,
            qty: qty,
            maxStock: variant.stock
        });
    }
    renderCart();
    return true;
}

function addToCartFromModal() {
    if (!varModalProduct || !varModalColor || !varModalSize) return;
    var qty = parseInt(document.getElementById('varQtyInput').value) || 1;
    if (addVariantToCart(varModalProduct, varModalColor, varModalSize, qty)) {
        document.getElementById('variantModal').style.display = 'none';
    }
}

// Add a product to the bill by its code/id (for when the barcode can't be scanned).
// Auto-adds when exactly one variant is in stock; otherwise opens the variant picker.
function addByCode(code) {
    code = (code || '').trim();
    if (!code) return;
    varModalTarget = 'sale';
    var p = products.find(function (x) { return String(x.id) === code; });
    if (!p) { alert('لم يتم العثور على منتج بهذا الرقم'); return; }
    if (getTotalStock(p) <= 0) { alert('المنتج غير متوفر في المخزون'); return; }
    var inStock = (p.variants || []).filter(function (v) { return (v.stock || 0) > 0; });
    if (inStock.length === 1) {
        addVariantToCart(p, inStock[0].color, inStock[0].size, 1);
    } else {
        openVariantModal(p.id);
    }
}

// ============ CART ============
function renderCart() {
    var container = document.getElementById('cartItems');
    var checkoutBtn = document.getElementById('checkoutBtn');

    if (cart.length === 0) {
        container.innerHTML = '<div class="cart-empty"><span>\uD83D\uDED2</span><p>السلة فارغة</p></div>';
        checkoutBtn.disabled = true;
        updateTotals();
        return;
    }

    var html = '';
    for (var i = 0; i < cart.length; i++) {
        var item = cart[i];
        var ek = escapeHtml(item.key);
        html += '<div class="cart-item" data-key="' + ek + '">';
        html += '<div class="cart-item-info">';
        html += '<div class="cart-item-name">' + escapeHtml(item.name) + '</div>';
        html += '<div class="cart-item-variant">' + escapeHtml(item.color) + ' - ' + escapeHtml(item.size) + '</div>';
        html += '<div class="cart-item-price">\u20AA' + item.price + '</div>';
        html += '</div>';
        html += '<div class="cart-item-qty">';
        html += '<button aria-label="إنقاص" onclick="changeCartQty(\'' + ek + '\', -1)">-</button>';
        html += '<span>' + item.qty + '</span>';
        html += '<button aria-label="زيادة" onclick="changeCartQty(\'' + ek + '\', 1)">+</button>';
        html += '</div>';
        html += '<button class="cart-item-remove" aria-label="حذف" onclick="removeCartItem(\'' + ek + '\')">\u2715</button>';
        html += '</div>';
    }

    container.innerHTML = html;
    checkoutBtn.disabled = false;
    updateTotals();
}

function changeCartQty(key, delta) {
    var item = cart.find(function (c) { return c.key === key; });
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
        cart = cart.filter(function (c) { return c.key !== key; });
    } else if (item.qty > item.maxStock) {
        item.qty = item.maxStock;
    }
    renderCart();
}

function removeCartItem(key) {
    cart = cart.filter(function (c) { return c.key !== key; });
    renderCart();
}

function updateTotals() {
    var subtotal = 0;
    for (var i = 0; i < cart.length; i++) {
        subtotal += cart[i].price * cart[i].qty;
    }
    var discountVal = parseFloat(document.getElementById('discountInput').value) || 0;
    var discountType = document.getElementById('discountType').value;
    var discount = discountType === 'percent' ? subtotal * (discountVal / 100) : discountVal;
    var total = Math.max(0, subtotal - discount);

    document.getElementById('subtotal').textContent = '\u20AA' + subtotal.toFixed(2);
    document.getElementById('totalAmount').textContent = '\u20AA' + total.toFixed(2);
}

// ============ CHECKOUT (ATOMIC BATCH) ============
// Entry point: show a themed confirmation with the total before finishing the sale.
function checkout() {
    if (cart.length === 0) return;
    if (!licenseValid) { showAlert('الترخيص منتهي', { icon: '⛔', title: 'تنبيه' }); return; }

    var subtotal = 0;
    for (var i = 0; i < cart.length; i++) {
        subtotal += cart[i].price * cart[i].qty;
    }
    var discountVal = parseFloat(document.getElementById('discountInput').value) || 0;
    var discountType = document.getElementById('discountType').value;
    var discount = discountType === 'percent' ? subtotal * (discountVal / 100) : discountVal;
    var total = Math.max(0, subtotal - discount);

    // Pay-later (debt) requires a customer first.
    if (selectedPayment === 'debt' && !pendingCustomer) {
        openCustomerModal('بيانات العميل (بيع آجل)', function (cust) {
            pendingCustomer = cust;
            checkout();
        });
        return;
    }

    var msg = 'الإجمالي المطلوب: \u20AA' + total.toFixed(2) + '\n';
    if (discount > 0) { msg += 'الخصم: \u20AA' + discount.toFixed(2) + '\n'; }
    msg += 'طريقة الدفع: ' + paymentLabel(selectedPayment) + '\n';

    if (selectedPayment === 'cash') {
        var tenderEl = document.getElementById('tenderInput');
        var tendered = tenderEl ? parseFloat(tenderEl.value) : NaN;
        if (!isNaN(tendered) && tendered > 0) {
            if (tendered < total) { showAlert('المبلغ المدفوع أقل من الإجمالي', { icon: '⚠️', title: 'تنبيه' }); return; }
            msg += 'المدفوع: \u20AA' + tendered.toFixed(2) + '\nالباقي للزبون: \u20AA' + (tendered - total).toFixed(2) + '\n';
        }
    }
    if (selectedPayment === 'debt' && pendingCustomer) {
        msg += 'العميل: ' + pendingCustomer.name + '\n⚠️ سيُسجَّل المبلغ كذمة على العميل.\n';
    }
    msg += '\nسيتم إتمام البيع وطباعة الفاتورة وفتح الدرج.';

    showConfirm(msg, function () { doCheckout(); }, {
        icon: '🧾',
        title: 'تأكيد البيع',
        yesText: 'إتمام وطباعة',
        noText: 'إلغاء'
    });
}

function doCheckout() {
    if (cart.length === 0) return;
    if (!licenseValid) { alert('الترخيص منتهي'); return; }

    var subtotal = 0;
    for (var i = 0; i < cart.length; i++) {
        subtotal += cart[i].price * cart[i].qty;
    }
    var discountVal = parseFloat(document.getElementById('discountInput').value) || 0;
    var discountType = document.getElementById('discountType').value;
    var discount = discountType === 'percent' ? subtotal * (discountVal / 100) : discountVal;
    var total = Math.max(0, subtotal - discount);

    var billNumber = 'POS-' + Date.now();
    var billNoteEl = document.getElementById('billNote');
    var billNote = billNoteEl ? billNoteEl.value.trim() : '';
    var items = [];
    for (var i = 0; i < cart.length; i++) {
        items.push({
            productId: cart[i].productId,
            name: cart[i].name,
            color: cart[i].color,
            size: cart[i].size,
            price: cart[i].price,
            qty: cart[i].qty,
            total: cart[i].price * cart[i].qty
        });
    }

    var billData = {
        billNumber: billNumber,
        orderNumber: billNumber,
        items: items,
        subtotal: subtotal,
        discount: discount,
        discountType: discountType,
        discountValue: discountVal,
        total: total,
        totalBase: total,
        paymentMethod: selectedPayment,
        note: billNote,
        cashier: currentUser ? (currentUser.displayName || currentUser.username) : 'unknown',
        source: 'pos',
        status: selectedPayment === 'debt' ? 'unpaid' : 'completed',
        createdAt: serverTimestamp(),
        createdAtIso: new Date().toISOString()
    };

    if (selectedPayment === 'debt' && pendingCustomer) {
        billData.customer = pendingCustomer;
        billData.paidAmount = 0;
    }
    if (selectedPayment === 'cash') {
        var tEl = document.getElementById('tenderInput');
        var tv = tEl ? parseFloat(tEl.value) : NaN;
        if (!isNaN(tv) && tv > 0) {
            billData.tendered = tv;
            billData.change = Math.max(0, tv - total);
        }
    }

    var checkoutBtn = document.getElementById('checkoutBtn');
    checkoutBtn.textContent = 'جاري الحفظ...';
    checkoutBtn.disabled = true;

    function onCheckoutSuccess() {
        logActivity('sale', 'فاتورة ' + billNumber + ' - المجموع: \u20AA' + total.toFixed(2), {
            billNumber: billNumber, total: total, items: items.length, payment: selectedPayment
        });
        showReceipt(billData);
        printReceipt(billData);
        cart = [];
        renderCart();
        document.getElementById('discountInput').value = 0;
        if (billNoteEl) billNoteEl.value = '';
        var tenderEl2 = document.getElementById('tenderInput');
        if (tenderEl2) tenderEl2.value = '';
        var changeEl = document.getElementById('changeDue');
        if (changeEl) changeEl.textContent = '';
        pendingCustomer = null;
        setPaymentMethod('cash');
        updatePaymentUI();
        checkoutBtn.textContent = 'إتمام البيع';
        checkoutBtn.disabled = false;
    }
    function onCheckoutError(err) {
        alert('خطأ في حفظ الفاتورة: ' + err.message);
        checkoutBtn.textContent = 'إتمام البيع';
        checkoutBtn.disabled = false;
    }

    // D1 tenants: just post the order; the server deducts variant stock atomically.
    if (isD1()) {
        db.collection('orders').doc(billNumber).set(billData)
            .then(onCheckoutSuccess)
            .catch(onCheckoutError);
        return;
    }

    // Atomic batch: save bill + deduct stock together
    var batch = rawDb.batch();
    var billRef = rawDb.collection('projects').doc(getProjectId()).collection('orders').doc(billNumber);
    batch.set(billRef, billData);

    // Deduct stock
    var productUpdates = {};
    for (var i = 0; i < cart.length; i++) {
        var cartItem = cart[i];
        if (!productUpdates[cartItem.productId]) {
            var prod = products.find(function (p) { return p.id === cartItem.productId; });
            if (prod) {
                productUpdates[cartItem.productId] = {
                    ref: rawDb.collection('projects').doc(getProjectId()).collection('products').doc(cartItem.productId),
                    variants: JSON.parse(JSON.stringify(prod.variants || []))
                };
            }
        }
        if (productUpdates[cartItem.productId]) {
            var vars = productUpdates[cartItem.productId].variants;
            for (var j = 0; j < vars.length; j++) {
                if (vars[j].color === cartItem.color && vars[j].size === cartItem.size) {
                    vars[j].stock = Math.max(0, (vars[j].stock || 0) - cartItem.qty);
                }
            }
        }
    }

    var prodKeys = Object.keys(productUpdates);
    for (var i = 0; i < prodKeys.length; i++) {
        var pu = productUpdates[prodKeys[i]];
        batch.update(pu.ref, { variants: pu.variants });
    }

    batch.commit().then(onCheckoutSuccess).catch(onCheckoutError);
}

// ============ RECEIPT ============
var RECEIPT_PRINT_CSS =
    '@page { size: 58mm auto; margin: 0; }' +
    '* { margin:0; padding:0; box-sizing:border-box; }' +
    'html,body { width:58mm; }' +
    'body { font-family:"Courier New",monospace; color:#000; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }' +
    '.receipt { width:58mm; padding:3mm 2mm; color:#000; font-weight:bold; }' +
    '.r-title { text-align:center; font-size:22px; font-weight:bold; margin-bottom:4px; }' +
    '.r-meta { text-align:center; font-size:13px; font-weight:bold; margin-bottom:2px; }' +
    '.r-items { width:100%; border-collapse:collapse; margin:8px 0; }' +
    '.r-items th { background:#000; color:#fff; font-weight:bold; padding:5px 3px; border:1px solid #000; font-size:13px; }' +
    '.r-items td { padding:5px 3px; border:1px solid #000; font-weight:bold; font-size:13px; text-align:center; }' +
    '.r-items td.r-name { text-align:right; }' +
    '.r-totals { width:100%; border-collapse:collapse; margin-top:6px; }' +
    '.r-totals td { padding:3px 3px; font-weight:bold; font-size:14px; }' +
    '.r-totals td:last-child { text-align:left; }' +
    '.r-totals tr.r-grand td { border-top:2px solid #000; border-bottom:2px solid #000; font-size:17px; padding:6px 3px; }' +
    '.r-thanks { text-align:center; font-weight:bold; margin-top:10px; font-size:14px; }' +
    '.r-note { margin-top:6px; font-size:12px; font-weight:bold; text-align:right; border-top:1px dashed #000; padding-top:4px; }' +
    '.r-barcode { text-align:center; margin-top:8px; }' +
    '.r-barcode svg { width:90%; height:48px; }';

function buildReceiptInnerHTML(bill) {
    var dateStr = (bill.createdAt && bill.createdAt.toDate)
        ? bill.createdAt.toDate().toLocaleString('ar-EG')
        : (bill.createdAtIso ? new Date(bill.createdAtIso).toLocaleString('ar-EG') : new Date().toLocaleString('ar-EG'));
    var html = '';
    html += '<div class="r-title">عقاد كيدز</div>';
    html += '<div class="r-meta">' + dateStr + '</div>';
    html += '<div class="r-meta">الكاشير: ' + escapeHtml(bill.cashier || '') + '</div>';

    html += '<table class="r-items"><thead><tr><th>الصنف</th><th>كمية</th><th>السعر</th></tr></thead><tbody>';
    var items = bill.items || [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var variant = (it.color || it.size) ? ' (' + escapeHtml(it.color || '') + '/' + escapeHtml(it.size || '') + ')' : '';
        var lineTotal = (it.total != null ? it.total : (it.price || 0) * (it.qty || 0));
        html += '<tr>';
        html += '<td class="r-name">' + escapeHtml(it.name || '') + variant + '</td>';
        html += '<td>' + (it.qty || 0) + '</td>';
        html += '<td>\u20AA' + Number(lineTotal).toFixed(2) + '</td>';
        html += '</tr>';
    }
    html += '</tbody></table>';

    html += '<table class="r-totals">';
    html += '<tr><td>المجموع</td><td>\u20AA' + (bill.subtotal || 0).toFixed(2) + '</td></tr>';
    if (bill.discount > 0) {
        html += '<tr><td>الخصم</td><td>-\u20AA' + bill.discount.toFixed(2) + '</td></tr>';
    }
    html += '<tr class="r-grand"><td>الإجمالي</td><td>\u20AA' + (bill.total || 0).toFixed(2) + '</td></tr>';
    html += '<tr><td>الدفع</td><td>' + paymentLabel(bill.paymentMethod) + '</td></tr>';
    if (bill.paymentMethod === 'cash' && bill.tendered != null) {
        html += '<tr><td>المدفوع</td><td>\u20AA' + Number(bill.tendered).toFixed(2) + '</td></tr>';
        html += '<tr><td>الباقي</td><td>\u20AA' + Number(bill.change || 0).toFixed(2) + '</td></tr>';
    }
    if (bill.paymentMethod === 'debt') {
        if (bill.customer && bill.customer.name) html += '<tr><td>العميل</td><td>' + escapeHtml(bill.customer.name) + '</td></tr>';
        html += '<tr><td>المتبقي (آجل)</td><td>\u20AA' + (bill.total || 0).toFixed(2) + '</td></tr>';
    }
    html += '</table>';
    if (bill.note) {
        html += '<div class="r-note">ملاحظة: ' + escapeHtml(bill.note) + '</div>';
    }
    var bcSvg = code128cSVG(billDigits(bill));
    if (bcSvg) {
        html += '<div class="r-barcode">' + bcSvg + '</div>';
    }
    html += '<div class="r-thanks">شكراً لتسوقكم</div>';
    return html;
}

function showReceipt(bill) {
    currentReceiptBill = bill;
    document.getElementById('receiptContent').innerHTML = buildReceiptInnerHTML(bill) + buildBillModificationsHTML(bill);
    document.getElementById('receiptModal').style.display = 'flex';
}

function buildPrintableReceipt(bill) {
    return '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>' +
        RECEIPT_PRINT_CSS + '</style></head><body><div class="receipt">' +
        buildReceiptInnerHTML(bill) + '</div></body></html>';
}

// Silent print to the default (thermal) printer; falls back to the browser dialog.
function printReceipt(bill) {
    try {
        var html = buildPrintableReceipt(bill);
        if (ipcRenderer && ipcRenderer.invoke) {
            ipcRenderer.invoke('print-html', html).catch(function () { window.print(); });
        } else {
            window.print();
        }
    } catch (e) {
        try { window.print(); } catch (e2) {}
    }
}

// ============ INVENTORY ============
function renderInventory() {
    var body = document.getElementById('inventoryBody');
    var searchVal = (document.getElementById('inventorySearch') ? document.getElementById('inventorySearch').value : '').toLowerCase();
    var html = '';

    for (var i = 0; i < products.length; i++) {
        var p = products[i];
        if (p.status === 'disabled') continue;
        var variants = p.variants || [];

        // Match search against product name/id or any of its variants.
        var matches = !searchVal || (p.name + ' ' + p.id).toLowerCase().indexOf(searchVal) >= 0;
        if (!matches) {
            for (var j = 0; j < variants.length; j++) {
                if ((p.name + ' ' + variants[j].color + ' ' + variants[j].size).toLowerCase().indexOf(searchVal) >= 0) { matches = true; break; }
            }
        }
        if (!matches) continue;

        var totalStock = getTotalStock(p);
        var minP = Infinity, maxP = 0;
        for (var j = 0; j < variants.length; j++) {
            var pr = variants[j].price || 0;
            if (pr > 0 && pr < minP) minP = pr;
            if (pr > maxP) maxP = pr;
        }
        var priceLabel = (minP === Infinity) ? '\u20AA0' : (minP === maxP ? '\u20AA' + minP : '\u20AA' + minP + ' - \u20AA' + maxP);

        var statusBadge;
        if (totalStock <= 0) statusBadge = '<span class="badge badge-danger">نفذ</span>';
        else if (totalStock <= 5) statusBadge = '<span class="badge badge-warning">منخفض</span>';
        else statusBadge = '<span class="badge badge-success">متوفر</span>';

        var rowId = 'inv_' + p.id;
        var isOpen = !!openInvRows[rowId];
        html += '<tr class="inv-master' + (isOpen ? ' open' : '') + '" onclick="toggleInvRow(\'' + escapeHtml(rowId) + '\')">';
        html += '<td><span class="inv-caret" id="caret_' + escapeHtml(rowId) + '">' + (isOpen ? '\u25BE' : '\u25B8') + '</span> ' + escapeHtml(p.id) + '</td>';
        html += '<td>' + escapeHtml(p.name || '') + '</td>';
        html += '<td>' + variants.length + ' خيار</td>';
        html += '<td>' + totalStock + ' قطعة</td>';
        html += '<td>' + priceLabel + '</td>';
        html += '<td>' + statusBadge + '</td>';
        html += '</tr>';

        // The variant detail row is built LAZILY (only when expanded) — pre-building
        // every product's variant sub-table makes the DOM huge with thousands of
        // products (e.g. 3000 products = 36k rows). We store the product id on the
        // row and fill the sub-table on first expand in toggleInvRow().
        html += '<tr class="inv-detail" id="' + escapeHtml(rowId) + '" data-pid="' + escapeHtml(p.id) + '" style="display:' + (isOpen ? 'table-row' : 'none') + ';"><td colspan="6">';
        if (isOpen) html += buildInvDetailHTML(p);
        html += '</td></tr>';
    }

    body.innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:20px;">لا توجد بيانات</td></tr>';
}

// Build the variant sub-table HTML for one product (used lazily on row expand).
function buildInvDetailHTML(p) {
    var variants = p.variants || [];
    var html = '<table class="inv-sub"><thead><tr><th>اللون</th><th>المقاس</th><th>الكمية</th><th>السعر</th><th>الحالة</th></tr></thead><tbody>';
    for (var j = 0; j < variants.length; j++) {
        var v = variants[j];
        var vBadge;
        if ((v.stock || 0) <= 0) vBadge = '<span class="badge badge-danger">نفذ</span>';
        else if ((v.stock || 0) <= 5) vBadge = '<span class="badge badge-warning">منخفض</span>';
        else vBadge = '<span class="badge badge-success">متوفر</span>';
        html += '<tr>';
        html += '<td>' + escapeHtml(v.color || '') + '</td>';
        html += '<td>' + escapeHtml(v.size || '') + '</td>';
        html += '<td>' + (v.stock || 0) + '</td>';
        html += '<td>\u20AA' + (v.price || 0) + '</td>';
        html += '<td>' + vBadge + '</td>';
        html += '</tr>';
    }
    if (!variants.length) html += '<tr><td colspan="5" style="text-align:center;">لا توجد خيارات</td></tr>';
    html += '</tbody></table>';
    return html;
}

function toggleInvRow(rowId) {
    var detail = document.getElementById(rowId);
    var caret = document.getElementById('caret_' + rowId);
    if (!detail) return;
    var open = detail.style.display !== 'none';
    if (!open) {
        // Expanding: build the variant sub-table on first open.
        var cell = detail.firstElementChild;
        if (cell && !cell.firstChild) {
            var pid = detail.getAttribute('data-pid');
            var prod = products.find(function (p) { return String(p.id) === String(pid); });
            if (prod) cell.innerHTML = buildInvDetailHTML(prod);
        }
    }
    detail.style.display = open ? 'none' : 'table-row';
    if (open) { delete openInvRows[rowId]; } else { openInvRows[rowId] = true; }
    if (caret) caret.textContent = open ? '\u25B8' : '\u25BE';
    var master = detail.previousElementSibling;
    if (master) { if (open) master.classList.remove('open'); else master.classList.add('open'); }
}

function exportInventory() {
    var csv = '\uFEFF' + 'الرقم,المنتج,اللون,المقاس,الكمية,السعر\n';
    for (var i = 0; i < products.length; i++) {
        var p = products[i];
        var variants = p.variants || [];
        for (var j = 0; j < variants.length; j++) {
            var v = variants[j];
            csv += p.id + ',' + (p.name || '') + ',' + (v.color || '') + ',' + (v.size || '') + ',' + (v.stock || 0) + ',' + (v.price || 0) + '\n';
        }
    }
    ipcRenderer.invoke('show-save-dialog', {
        defaultPath: 'inventory_' + new Date().toISOString().slice(0, 10) + '.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }]
    }).then(function (result) {
        if (!result.canceled && result.filePath) {
            fs.writeFileSync(result.filePath, csv, 'utf8');
            logActivity('export', 'تصدير المخزون CSV');
        }
    });
}

// ============ ADD STOCK ============
function openAddStockForm() {
    document.getElementById('addStockForm').style.display = 'block';
    var select = document.getElementById('stockProduct');
    var html = '<option value="">اختر المنتج</option>';
    for (var i = 0; i < products.length; i++) {
        html += '<option value="' + escapeHtml(products[i].id) + '">' + escapeHtml(products[i].name) + ' (' + escapeHtml(products[i].id) + ')</option>';
    }
    select.innerHTML = html;
    document.getElementById('stockColor').innerHTML = '<option value="">اختر اللون</option>';
    document.getElementById('stockSize').innerHTML = '<option value="">اختر المقاس</option>';
    document.getElementById('stockQty').value = 1;
    document.getElementById('stockBarcode').value = '';
    document.getElementById('stockBarcode').focus();
}

function handleStockBarcode(e) {
    if (e.key !== 'Enter') return;
    var barcode = document.getElementById('stockBarcode').value.trim();
    if (!barcode) return;

    var match = products.find(function (p) { return p.id === barcode || p.id === String(barcode); });
    if (!match) {
        alert('لم يتم العثور على منتج برقم: ' + barcode);
        document.getElementById('stockBarcode').value = '';
        return;
    }

    // Auto-select the product in the dropdown
    document.getElementById('stockProduct').value = match.id;
    populateStockColors();

    // If product has only one color, auto-select it
    var colors = match.colors || [];
    if (colors.length === 1) {
        document.getElementById('stockColor').value = colors[0].name;
        populateStockSizes();
    }

    document.getElementById('stockBarcode').value = '';
}

function populateStockColors() {
    var productId = document.getElementById('stockProduct').value;
    var product = products.find(function (p) { return p.id === productId; });
    var select = document.getElementById('stockColor');
    if (!product) { select.innerHTML = '<option value="">اختر اللون</option>'; return; }
    var colors = product.colors || [];
    var html = '<option value="">اختر اللون</option>';
    for (var i = 0; i < colors.length; i++) {
        html += '<option value="' + escapeHtml(colors[i].name) + '">' + escapeHtml(colors[i].name) + '</option>';
    }
    select.innerHTML = html;
    document.getElementById('stockSize').innerHTML = '<option value="">اختر المقاس</option>';
}

function populateStockSizes() {
    var productId = document.getElementById('stockProduct').value;
    var color = document.getElementById('stockColor').value;
    var product = products.find(function (p) { return p.id === productId; });
    var select = document.getElementById('stockSize');
    if (!product || !color) { select.innerHTML = '<option value="">اختر المقاس</option>'; return; }
    var variants = product.variants || [];
    var html = '<option value="">اختر المقاس</option>';
    for (var i = 0; i < variants.length; i++) {
        if (variants[i].color === color) {
            html += '<option value="' + escapeHtml(variants[i].size) + '">' + escapeHtml(variants[i].size) + ' (حالي: ' + (variants[i].stock || 0) + ')</option>';
        }
    }
    select.innerHTML = html;
}

function saveAddStock() {
    var productId = document.getElementById('stockProduct').value;
    var color = document.getElementById('stockColor').value;
    var size = document.getElementById('stockSize').value;
    var qty = parseInt(document.getElementById('stockQty').value) || 0;

    if (!productId || !color || !size || qty <= 0) {
        alert('يرجى ملء جميع الحقول');
        return;
    }

    var product = products.find(function (p) { return p.id === productId; });
    if (!product) return;

    var variants = JSON.parse(JSON.stringify(product.variants || []));
    for (var i = 0; i < variants.length; i++) {
        if (variants[i].color === color && variants[i].size === size) {
            variants[i].stock = (variants[i].stock || 0) + qty;
        }
    }

    var savBtn = document.getElementById('saveStockBtn');
    savBtn.textContent = 'جاري الحفظ...';
    savBtn.disabled = true;

    var doUpdate = isD1()
        ? db.collection('products').doc(productId).update({ variants: variants })
        : rawDb.collection('projects').doc(getProjectId()).collection('products').doc(productId).update({ variants: variants });

    doUpdate.then(function () {
        logActivity('stock_add', 'إضافة ' + qty + ' قطعة من ' + product.name + ' (' + color + '/' + size + ')', {
            productId: productId, color: color, size: size, qty: qty
        });
        document.getElementById('addStockForm').style.display = 'none';
        savBtn.textContent = 'إضافة';
        savBtn.disabled = false;
    }).catch(function (err) {
        alert('خطأ: ' + err.message);
        savBtn.textContent = 'إضافة';
        savBtn.disabled = false;
    });
}

// ============ DAMAGE ============
function renderDamageHistory() {
    var body = document.getElementById('damageBody');
    var html = '';
    for (var i = 0; i < damageRecords.length; i++) {
        var d = damageRecords[i];
        var date = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toLocaleDateString('ar-EG') : '';
        html += '<tr>';
        html += '<td>' + date + '</td>';
        html += '<td>' + escapeHtml(d.productName || '') + '</td>';
        html += '<td>' + escapeHtml(d.color || '') + '</td>';
        html += '<td>' + escapeHtml(d.size || '') + '</td>';
        html += '<td>' + (d.qty || 0) + '</td>';
        html += '<td>' + escapeHtml(d.reason || '') + '</td>';
        html += '</tr>';
    }
    body.innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:20px;">لا يوجد سجل إتلاف</td></tr>';
}

function openDamageForm() {
    document.getElementById('damageForm').style.display = 'block';
    populateDamageProducts();
}

function populateDamageProducts() {
    var select = document.getElementById('damageProduct');
    var html = '<option value="">اختر المنتج</option>';
    for (var i = 0; i < products.length; i++) {
        html += '<option value="' + escapeHtml(products[i].id) + '">' + escapeHtml(products[i].name) + ' (' + escapeHtml(products[i].id) + ')</option>';
    }
    select.innerHTML = html;
}

function populateDamageColors() {
    var productId = document.getElementById('damageProduct').value;
    var product = products.find(function (p) { return p.id === productId; });
    var select = document.getElementById('damageColor');
    if (!product) { select.innerHTML = '<option value="">اختر اللون</option>'; return; }
    var colors = product.colors || [];
    var html = '<option value="">اختر اللون</option>';
    for (var i = 0; i < colors.length; i++) {
        html += '<option value="' + escapeHtml(colors[i].name) + '">' + escapeHtml(colors[i].name) + '</option>';
    }
    select.innerHTML = html;
}

function populateDamageSizes() {
    var productId = document.getElementById('damageProduct').value;
    var color = document.getElementById('damageColor').value;
    var product = products.find(function (p) { return p.id === productId; });
    var select = document.getElementById('damageSize');
    if (!product || !color) { select.innerHTML = '<option value="">اختر المقاس</option>'; return; }
    var variants = product.variants || [];
    var html = '<option value="">اختر المقاس</option>';
    for (var i = 0; i < variants.length; i++) {
        if (variants[i].color === color) {
            html += '<option value="' + escapeHtml(variants[i].size) + '">' + escapeHtml(variants[i].size) + ' (متوفر: ' + (variants[i].stock || 0) + ')</option>';
        }
    }
    select.innerHTML = html;
}

function saveDamage() {
    var productId = document.getElementById('damageProduct').value;
    var color = document.getElementById('damageColor').value;
    var size = document.getElementById('damageSize').value;
    var qty = parseInt(document.getElementById('damageQty').value) || 0;
    var reason = document.getElementById('damageReason').value;

    if (!productId || !color || !size || qty <= 0) {
        alert('يرجى ملء جميع الحقول');
        return;
    }

    var product = products.find(function (p) { return p.id === productId; });
    if (!product) return;

    var variants = JSON.parse(JSON.stringify(product.variants || []));
    for (var i = 0; i < variants.length; i++) {
        if (variants[i].color === color && variants[i].size === size) {
            variants[i].stock = Math.max(0, (variants[i].stock || 0) - qty);
        }
    }

    var ref = rawDb.collection('projects').doc(getProjectId()).collection('products').doc(productId);
    var damageData = {
        productId: productId,
        productName: product.name,
        color: color,
        size: size,
        qty: qty,
        reason: reason,
        user: currentUser ? (currentUser.displayName || currentUser.username) : '',
        createdAt: serverTimestamp()
    };

    var savBtn = document.getElementById('saveDamageBtn');
    savBtn.textContent = 'جاري الحفظ...';
    savBtn.disabled = true;

    function onDamageSuccess() {
        logActivity('damage', 'إتلاف ' + qty + ' من ' + product.name + ' (' + color + '/' + size + ')', { reason: reason });
        document.getElementById('damageForm').style.display = 'none';
        document.getElementById('damageQty').value = 1;
        document.getElementById('damageReason').value = '';
        savBtn.textContent = 'حفظ';
        savBtn.disabled = false;
    }
    function onDamageError(err) {
        alert('خطأ: ' + err.message);
        savBtn.textContent = 'حفظ';
        savBtn.disabled = false;
    }

    // D1 tenants: adjust stock via /api/pos-stock then record the damage entry.
    if (isD1()) {
        db.collection('products').doc(productId).update({ variants: variants })
            .then(function () { return db.collection('pos_damage').add(damageData); })
            .then(onDamageSuccess)
            .catch(onDamageError);
        return;
    }

    var batch = rawDb.batch();
    batch.update(ref, { variants: variants });
    var dmgRef = rawDb.collection('projects').doc(getProjectId()).collection('pos_damage').doc();
    batch.set(dmgRef, damageData);

    batch.commit().then(onDamageSuccess).catch(onDamageError);
}

// ============ BILLS ============
function renderBills() {
    var body = document.getElementById('billsBody');
    var fromDate = document.getElementById('billsDateFrom').value;
    var toDate = document.getElementById('billsDateTo').value;
    var searchEl = document.getElementById('billsSearch');
    var term = searchEl ? searchEl.value.trim() : '';

    var filtered = bills;
    if (fromDate) {
        var from = new Date(fromDate);
        filtered = filtered.filter(function (b) {
            var d = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : null;
            return d && d >= from;
        });
    }
    if (toDate) {
        var to = new Date(toDate + 'T23:59:59');
        filtered = filtered.filter(function (b) {
            var d = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : null;
            return d && d <= to;
        });
    }
    if (term) {
        var digits = term.replace(/\D/g, '').replace(/^0+/, '');
        var low = term.toLowerCase();
        filtered = filtered.filter(function (b) {
            // Match by scanned/typed bill code (digits) or by the full number text
            if (digits && billDigits(b).indexOf(digits) >= 0) return true;
            var num = (b.billNumber || b.orderNumber || b.id || '').toString().toLowerCase();
            if (num.indexOf(low) >= 0) return true;
            // Match by a product name inside the bill
            var items = b.items || [];
            for (var k = 0; k < items.length; k++) {
                if ((items[k].name || '').toLowerCase().indexOf(low) >= 0) return true;
            }
            return false;
        });
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var b = filtered[i];
        var date = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().toLocaleString('ar-EG') : (b.createdAtIso ? new Date(b.createdAtIso).toLocaleString('ar-EG') : '');
        var itemCount = (b.items || []).length;
        var sourceLabel = b.source === 'pos' ? 'المتجر' : 'الموقع';
        html += '<tr>';
        html += '<td>' + escapeHtml(b.billNumber || b.orderNumber || '') + '</td>';
        html += '<td>' + date + '</td>';
        html += '<td>' + sourceLabel + '</td>';
        html += '<td>' + itemCount + '</td>';
        html += '<td>\u20AA' + (b.total || b.totalBase || 0).toFixed(2) + '</td>';
        var payCell = paymentLabel(b.paymentMethod);
        if (b.paymentMethod === 'debt') {
            payCell += b.status === 'paid'
                ? ' <span class="badge badge-paid">مسدّدة</span>'
                : ' <span class="badge badge-unpaid">آجل</span>';
        }
        html += '<td>' + payCell + '</td>';
        var who = b.cashier || (b.customer && b.customer.name) || b.customerName || '-';
        html += '<td>' + escapeHtml(who) + '</td>';
        html += '<td><button class="btn-secondary" onclick="viewBill(\'' + escapeHtml(b.billNumber || b.orderNumber || b.id) + '\')">عرض</button></td>';
        html += '</tr>';
    }

    body.innerHTML = html || '<tr><td colspan="8" style="text-align:center;padding:20px;">لا توجد فواتير</td></tr>';
}

function viewBill(billNumber) {
    var bill = bills.find(function (b) { return (b.billNumber || b.orderNumber || b.id) === billNumber; });
    if (bill) showReceipt(bill);
}

// All return/exchange events that reference this bill, oldest first.
function getBillReturns(bill) {
    var key = bill.billNumber || bill.id;
    var list = returnRecords.filter(function (r) { return r.originalBill === key; });
    list.sort(function (a, b) { return billTimeMs(a) - billTimeMs(b); });
    return list;
}

// Current state of a bill after applying every return/exchange (supports multiple).
function computeCurrentBillState(bill, rets) {
    var map = {}, order = [];
    function k(it) { return (it.productId || it.name) + '|' + (it.color || '') + '|' + (it.size || ''); }
    var items = bill.items || [];
    for (var i = 0; i < items.length; i++) {
        var key = k(items[i]);
        if (!(key in map)) { map[key] = { name: items[i].name, color: items[i].color, size: items[i].size, price: items[i].price || 0, qty: 0 }; order.push(key); }
        map[key].qty += items[i].qty || 0;
    }
    for (var e = 0; e < rets.length; e++) {
        var rd = rets[e].returnedItems || [];
        for (var r = 0; r < rd.length; r++) {
            var rk = k(rd[r]);
            if (map[rk]) map[rk].qty -= rd[r].qty || 0;
        }
        var ad = rets[e].addedItems || [];
        for (var a = 0; a < ad.length; a++) {
            var ak = k(ad[a]);
            if (!(ak in map)) { map[ak] = { name: ad[a].name, color: ad[a].color, size: ad[a].size, price: ad[a].price || 0, qty: 0 }; order.push(ak); }
            map[ak].qty += ad[a].qty || 0;
        }
    }
    var out = [], total = 0;
    for (var o = 0; o < order.length; o++) {
        var line = map[order[o]];
        if (line.qty > 0) { out.push(line); total += line.price * line.qty; }
    }
    return { items: out, total: total };
}

function itemLabel(it) {
    var variant = (it.color || it.size) ? ' (' + (it.color || '') + '/' + (it.size || '') + ')' : '';
    return escapeHtml((it.name || '') + variant);
}

// On-screen modifications panel appended below the receipt when a bill has returns/exchanges.
function buildBillModificationsHTML(bill) {
    var rets = getBillReturns(bill);
    if (!rets.length) return '';
    var html = '<div class="bill-mods">';
    html += '<div class="bm-title">🔁 تعديلات على الفاتورة (مرتجعات / استبدالات)</div>';
    for (var e = 0; e < rets.length; e++) {
        var r = rets[e];
        var t = billTimeMs(r) ? new Date(billTimeMs(r)).toLocaleString('ar-EG') : '';
        html += '<div class="bm-event"><div class="bm-event-date">' + t + ' — الكاشير: ' + escapeHtml(r.cashier || '-') + '</div>';
        for (var i = 0; i < (r.returnedItems || []).length; i++) {
            var ri = r.returnedItems[i];
            html += '<div class="bm-line refund-customer">↩️ مرتجع: ' + itemLabel(ri) + ' × ' + (ri.qty || 0) + ' (-\u20AA' + (ri.total || 0).toFixed(2) + ')</div>';
        }
        for (var j = 0; j < (r.addedItems || []).length; j++) {
            var ai = r.addedItems[j];
            html += '<div class="bm-line pay-customer">➕ بديل: ' + itemLabel(ai) + ' × ' + (ai.qty || 0) + ' (\u20AA' + (ai.total || 0).toFixed(2) + ')</div>';
        }
        var methodTxt = r.paymentMethod === 'card' ? ' (فيزا)' : (r.paymentMethod === 'delayed' ? ' (مؤجل)' : (r.paymentMethod === 'cash' ? ' (نقدي)' : ''));
        if (r.net >= 0) html += '<div class="bm-net">دفع العميل: <span class="pay-customer">\u20AA' + (r.net || 0).toFixed(2) + '</span>' + methodTxt + '</div>';
        else html += '<div class="bm-net">رُدّ للعميل: <span class="refund-customer">\u20AA' + Math.abs(r.net || 0).toFixed(2) + '</span>' + methodTxt + '</div>';
        html += '</div>';
    }
    var cur = computeCurrentBillState(bill, rets);
    html += '<div class="bm-title">📋 الحالة الحالية للفاتورة</div>';
    html += '<table class="bm-current"><thead><tr><th>الصنف</th><th>كمية</th><th>السعر</th></tr></thead><tbody>';
    if (!cur.items.length) {
        html += '<tr><td colspan="3" style="text-align:center;">لا توجد أصناف متبقية (أُرجعت بالكامل)</td></tr>';
    } else {
        for (var c = 0; c < cur.items.length; c++) {
            var ci = cur.items[c];
            html += '<tr><td>' + itemLabel(ci) + '</td><td>' + ci.qty + '</td><td>\u20AA' + (ci.price * ci.qty).toFixed(2) + '</td></tr>';
        }
    }
    html += '</tbody></table>';
    html += '<div class="bm-current-total">الإجمالي الحالي للفاتورة: \u20AA' + cur.total.toFixed(2) + ' <span class="bm-orig">(الأصلي: \u20AA' + (bill.total || 0).toFixed(2) + ')</span></div>';
    html += '</div>';
    return html;
}

// ============ REPORTS ============
function updateReports() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    var todaySales = 0, todayCount = 0, monthSales = 0, monthCount = 0;
    for (var i = 0; i < bills.length; i++) {
        var b = bills[i];
        var d = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate() : null;
        if (!d) continue;
        if (d >= today) { todaySales += b.total || 0; todayCount++; }
        if (d >= monthStart) { monthSales += b.total || 0; monthCount++; }
    }

    document.getElementById('todaySales').textContent = '\u20AA' + todaySales.toFixed(2);
    document.getElementById('todayCount').textContent = todayCount + ' فاتورة';
    document.getElementById('monthSales').textContent = '\u20AA' + monthSales.toFixed(2);
    document.getElementById('monthCount').textContent = monthCount + ' فاتورة';

    var totalStock = 0;
    for (var i = 0; i < products.length; i++) { totalStock += getTotalStock(products[i]); }
    document.getElementById('totalProducts').textContent = products.length;
    document.getElementById('totalStock').textContent = totalStock + ' قطعة في المخزون';

    var monthDamage = 0;
    for (var i = 0; i < damageRecords.length; i++) {
        var dr = damageRecords[i];
        var dd = dr.createdAt && dr.createdAt.toDate ? dr.createdAt.toDate() : null;
        if (dd && dd >= monthStart) monthDamage += dr.qty || 0;
    }
    document.getElementById('monthDamage').textContent = monthDamage + ' قطعة';

    var shift = computeShiftSummary();
    var st = document.getElementById('shiftTotal');
    if (st) st.textContent = '\u20AA' + shift.total.toFixed(2);
    var scount = document.getElementById('shiftCount');
    if (scount) scount.textContent = shift.count + ' فاتورة';
    var scash = document.getElementById('shiftCash');
    if (scash) scash.textContent = 'نقدي \u20AA' + shift.cash.toFixed(2) + ' • بطاقة \u20AA' + shift.card.toFixed(2);
    var sdraw = document.getElementById('shiftDrawer');
    if (sdraw) sdraw.textContent = 'الصندوق المتوقع \u20AA' + shift.drawer.toFixed(2) + (shift.withdrawn ? ' • سحوبات \u20AA' + shift.withdrawn.toFixed(2) : '');
    renderWithdrawals(shift.since);

    var productSales = {};
    for (var i = 0; i < bills.length; i++) {
        var items = bills[i].items || [];
        for (var j = 0; j < items.length; j++) {
            var key = items[j].name || items[j].productId;
            if (!productSales[key]) productSales[key] = { qty: 0, revenue: 0 };
            productSales[key].qty += items[j].qty || 0;
            productSales[key].revenue += items[j].total || 0;
        }
    }
    var sorted = Object.keys(productSales).sort(function (a, b) { return productSales[b].qty - productSales[a].qty; }).slice(0, 10);
    var topHtml = '';
    for (var i = 0; i < sorted.length; i++) {
        var name = sorted[i];
        topHtml += '<tr><td>' + escapeHtml(name) + '</td><td>' + productSales[name].qty + '</td><td>\u20AA' + productSales[name].revenue.toFixed(2) + '</td></tr>';
    }
    document.getElementById('topProductsBody').innerHTML = topHtml || '<tr><td colspan="3" style="text-align:center;">لا توجد بيانات</td></tr>';
}

// ============ STATISTICS (date range) ============
function billDateObj(b) {
    if (b.createdAt && b.createdAt.toDate) return b.createdAt.toDate();
    if (b.createdAtIso) return new Date(b.createdAtIso);
    return null;
}
function productById(id) {
    for (var i = 0; i < products.length; i++) { if (products[i].id === id) return products[i]; }
    return null;
}
function lookupBrand(item) {
    var p = item.productId ? productById(item.productId) : null;
    if (!p) {
        for (var i = 0; i < products.length; i++) { if (products[i].name === item.name) { p = products[i]; break; } }
    }
    return (p && p.brand) ? p.brand : 'غير محدد';
}

var lastStatsData = null;
function runStats() {
    var fromVal = document.getElementById('statsFrom').value;
    var toVal = document.getElementById('statsTo').value;
    if (!fromVal || !toVal) { showAlert('يرجى اختيار تاريخ البداية والنهاية', { icon: '⚠️', title: 'تنبيه' }); return; }
    var from = new Date(fromVal); from.setHours(0, 0, 0, 0);
    var to = new Date(toVal); to.setHours(23, 59, 59, 999);

    var byProduct = {}, byBrand = {}, totalRevenue = 0, totalQty = 0, billCount = 0;
    for (var i = 0; i < bills.length; i++) {
        var d = billDateObj(bills[i]);
        if (!d || d < from || d > to) continue;
        billCount++;
        var items = bills[i].items || [];
        for (var j = 0; j < items.length; j++) {
            var it = items[j];
            var q = it.qty || 0;
            var rev = (it.total != null ? it.total : (it.price || 0) * q);
            var pname = it.name || it.productId || 'غير معروف';
            if (!byProduct[pname]) byProduct[pname] = { qty: 0, revenue: 0 };
            byProduct[pname].qty += q; byProduct[pname].revenue += rev;
            var brand = lookupBrand(it);
            if (!byBrand[brand]) byBrand[brand] = { qty: 0, revenue: 0 };
            byBrand[brand].qty += q; byBrand[brand].revenue += rev;
            totalQty += q; totalRevenue += rev;
        }
    }
    lastStatsData = { from: fromVal, to: toVal, byProduct: byProduct, byBrand: byBrand, totalQty: totalQty, totalRevenue: totalRevenue, billCount: billCount };
    renderStatsResults(lastStatsData);
}

function sortedEntries(map) {
    return Object.keys(map).sort(function (a, b) { return map[b].qty - map[a].qty; });
}

function renderStatsResults(data) {
    var html = '';
    html += '<div class="stats-summary">';
    html += '<div class="stats-kpi"><span>الفواتير</span><strong>' + data.billCount + '</strong></div>';
    html += '<div class="stats-kpi"><span>القطع المباعة</span><strong>' + data.totalQty + '</strong></div>';
    html += '<div class="stats-kpi"><span>الإيرادات</span><strong>\u20AA' + data.totalRevenue.toFixed(2) + '</strong></div>';
    html += '</div>';

    var prods = sortedEntries(data.byProduct);
    html += '<h4>حسب المنتج</h4><table class="data-table"><thead><tr><th>المنتج</th><th>الكمية</th><th>الإيرادات</th></tr></thead><tbody>';
    for (var i = 0; i < prods.length; i++) {
        html += '<tr><td>' + escapeHtml(prods[i]) + '</td><td>' + data.byProduct[prods[i]].qty + '</td><td>\u20AA' + data.byProduct[prods[i]].revenue.toFixed(2) + '</td></tr>';
    }
    if (!prods.length) html += '<tr><td colspan="3" style="text-align:center;">لا توجد مبيعات في هذه الفترة</td></tr>';
    html += '</tbody></table>';

    var brands = sortedEntries(data.byBrand);
    html += '<h4>حسب البراند</h4><table class="data-table"><thead><tr><th>البراند</th><th>الكمية</th><th>الإيرادات</th></tr></thead><tbody>';
    for (var b = 0; b < brands.length; b++) {
        html += '<tr><td>' + escapeHtml(brands[b]) + '</td><td>' + data.byBrand[brands[b]].qty + '</td><td>\u20AA' + data.byBrand[brands[b]].revenue.toFixed(2) + '</td></tr>';
    }
    if (!brands.length) html += '<tr><td colspan="3" style="text-align:center;">لا توجد بيانات</td></tr>';
    html += '</tbody></table>';

    document.getElementById('statsResults').innerHTML = html;
}

function printStats() {
    if (!lastStatsData) { showAlert('اعرض الإحصائيات أولاً قبل الطباعة', { icon: '⚠️', title: 'تنبيه' }); return; }
    var d = lastStatsData;
    var inner = '';
    inner += '<div class="r-title">تقرير المبيعات</div>';
    inner += '<div class="r-meta">من ' + d.from + ' إلى ' + d.to + '</div>';
    inner += '<table class="r-totals">';
    inner += '<tr><td>عدد الفواتير</td><td>' + d.billCount + '</td></tr>';
    inner += '<tr><td>القطع المباعة</td><td>' + d.totalQty + '</td></tr>';
    inner += '<tr class="r-grand"><td>الإيرادات</td><td>\u20AA' + d.totalRevenue.toFixed(2) + '</td></tr>';
    inner += '</table>';
    var prods = sortedEntries(d.byProduct);
    inner += '<table class="r-items"><thead><tr><th>المنتج</th><th>كمية</th><th>إيراد</th></tr></thead><tbody>';
    for (var i = 0; i < prods.length; i++) {
        inner += '<tr><td class="r-name">' + prods[i] + '</td><td>' + d.byProduct[prods[i]].qty + '</td><td>\u20AA' + d.byProduct[prods[i]].revenue.toFixed(0) + '</td></tr>';
    }
    inner += '</tbody></table>';
    sendToPrinter(inner);
}

// ============ MONTHLY CHECK (bought vs sold) ============
function logTimeMs(entry) {
    if (entry.timestamp && entry.timestamp.toDate) return entry.timestamp.toDate().getTime();
    if (typeof entry.timestamp === 'number') return entry.timestamp;
    if (entry.timestamp && entry.timestamp.seconds) return entry.timestamp.seconds * 1000;
    return 0;
}

var lastMonthlyData = null;
function runMonthlyCheck() {
    var mVal = document.getElementById('monthlyMonth').value; // yyyy-mm
    if (!mVal) { showAlert('يرجى اختيار الشهر', { icon: '⚠️', title: 'تنبيه' }); return; }
    var parts = mVal.split('-');
    var year = parseInt(parts[0], 10), mon = parseInt(parts[1], 10) - 1;
    var start = new Date(year, mon, 1, 0, 0, 0, 0).getTime();
    var end = new Date(year, mon + 1, 1, 0, 0, 0, 0).getTime();

    var btn = document.getElementById('monthlyRunBtn');
    btn.disabled = true; btn.textContent = 'جاري التحميل...';

    // Sold per product (by id, fallback name) from bills within month.
    var sold = {};
    for (var i = 0; i < bills.length; i++) {
        var d = billDateObj(bills[i]); if (!d) continue;
        var ms = d.getTime(); if (ms < start || ms >= end) continue;
        var items = bills[i].items || [];
        for (var j = 0; j < items.length; j++) {
            var it = items[j];
            var pid = it.productId || null;
            if (!pid) { var pp = null; for (var k = 0; k < products.length; k++) { if (products[k].name === it.name) { pp = products[k]; break; } } pid = pp ? pp.id : ('name:' + (it.name || '')); }
            sold[pid] = (sold[pid] || 0) + (it.qty || 0);
        }
    }

    // Bought (restock) per product from pos_logs (type stock_add) within month.
    db.collection('pos_logs').get().then(function (snap) {
        var bought = {};
        snap.forEach(function (doc) {
            var e = doc.data();
            if (e.type !== 'stock_add') return;
            var ms = logTimeMs(e); if (ms < start || ms >= end) return;
            var det = e.details || {};
            var pid = det.productId; if (!pid) return;
            bought[pid] = (bought[pid] || 0) + (det.qty || 0);
        });
        buildMonthlyResults(mVal, sold, bought);
    }).catch(function () {
        buildMonthlyResults(mVal, sold, {});
    }).then(function () {
        btn.disabled = false; btn.textContent = 'إنشاء الجرد';
    });
}

function buildMonthlyResults(mVal, sold, bought) {
    var rows = [];
    var seen = {};
    for (var i = 0; i < products.length; i++) {
        var p = products[i];
        seen[p.id] = true;
        var b = bought[p.id] || 0;
        var s = sold[p.id] || 0;
        var stock = getTotalStock(p);
        // Exclude: not bought AND not sold AND currently out of stock.
        if (b === 0 && s === 0 && stock <= 0) continue;
        rows.push({ id: p.id, name: p.name || '', brand: p.brand || 'غير محدد', bought: b, sold: s, stock: stock });
    }
    // Include any sold/bought items whose product no longer exists.
    var extra = {};
    var key;
    for (key in sold) { if (sold.hasOwnProperty(key) && !seen[key]) extra[key] = true; }
    for (key in bought) { if (bought.hasOwnProperty(key) && !seen[key]) extra[key] = true; }
    for (key in extra) {
        if (!extra.hasOwnProperty(key)) continue;
        rows.push({ id: key, name: '(محذوف) ' + key, brand: 'غير محدد', bought: bought[key] || 0, sold: sold[key] || 0, stock: 0 });
    }
    rows.sort(function (a, b) { return b.sold - a.sold; });
    lastMonthlyData = { month: mVal, rows: rows };
    renderMonthlyResults(lastMonthlyData);
}

function renderMonthlyResults(data) {
    var totBought = 0, totSold = 0;
    var html = '';
    html += '<table class="data-table"><thead><tr><th>الرقم</th><th>المنتج</th><th>البراند</th><th>المشتراة</th><th>المباعة</th><th>المخزون الحالي</th></tr></thead><tbody>';
    for (var i = 0; i < data.rows.length; i++) {
        var r = data.rows[i];
        totBought += r.bought; totSold += r.sold;
        html += '<tr><td>' + escapeHtml(r.id) + '</td><td>' + escapeHtml(r.name) + '</td><td>' + escapeHtml(r.brand) + '</td><td>' + r.bought + '</td><td>' + r.sold + '</td><td>' + r.stock + '</td></tr>';
    }
    if (!data.rows.length) html += '<tr><td colspan="6" style="text-align:center;">لا توجد حركة في هذا الشهر</td></tr>';
    html += '</tbody></table>';
    html = '<div class="stats-summary"><div class="stats-kpi"><span>إجمالي المشتريات</span><strong>' + totBought + '</strong></div>' +
        '<div class="stats-kpi"><span>إجمالي المبيعات</span><strong>' + totSold + '</strong></div>' +
        '<div class="stats-kpi"><span>عدد الأصناف</span><strong>' + data.rows.length + '</strong></div></div>' + html;
    document.getElementById('monthlyResults').innerHTML = html;
}

function printMonthly() {
    if (!lastMonthlyData) { showAlert('أنشئ الجرد أولاً قبل الطباعة', { icon: '⚠️', title: 'تنبيه' }); return; }
    var d = lastMonthlyData;
    var totBought = 0, totSold = 0;
    var inner = '';
    inner += '<div class="r-title">الجرد الشهري</div>';
    inner += '<div class="r-meta">شهر: ' + d.month + '</div>';
    inner += '<table class="r-items"><thead><tr><th>المنتج</th><th>شراء</th><th>بيع</th></tr></thead><tbody>';
    for (var i = 0; i < d.rows.length; i++) {
        var r = d.rows[i];
        totBought += r.bought; totSold += r.sold;
        inner += '<tr><td class="r-name">' + r.name + '</td><td>' + r.bought + '</td><td>' + r.sold + '</td></tr>';
    }
    inner += '</tbody></table>';
    inner += '<table class="r-totals"><tr><td>إجمالي الشراء</td><td>' + totBought + '</td></tr>' +
        '<tr class="r-grand"><td>إجمالي البيع</td><td>' + totSold + '</td></tr></table>';
    sendToPrinter(inner);
}

// Shared silent print for report-style documents.
function sendToPrinter(innerHtml) {
    try {
        var doc = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>' +
            RECEIPT_PRINT_CSS + '</style></head><body><div class="receipt">' + innerHtml + '</div></body></html>';
        if (ipcRenderer && ipcRenderer.invoke) {
            ipcRenderer.invoke('print-html', doc).catch(function () {});
        }
    } catch (e) {}
}

function setStatsQuickRange(range) {
    var to = new Date();
    var from = new Date();
    if (range === 'week') from.setDate(from.getDate() - 7);
    else if (range === 'month') from.setMonth(from.getMonth() - 1);
    function fmt(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
    document.getElementById('statsFrom').value = fmt(from);
    document.getElementById('statsTo').value = fmt(to);
    runStats();
}

// ============ NAVIGATION ============
function switchPage(page) {
    currentPage = page;
    var pages = document.querySelectorAll('.page');
    var btns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < pages.length; i++) pages[i].classList.remove('active');
    for (var i = 0; i < btns.length; i++) btns[i].classList.remove('active');
    document.getElementById('page-' + page).classList.add('active');
    var btn = document.querySelector('[data-page="' + page + '"]');
    if (btn) btn.classList.add('active');
    if (page === 'debts') renderDebts();
    else if (page === 'returns') renderReturnsHistory();
    else if (page === 'reports') updateReports();
}

// ============ EVENT LISTENERS ============
// Debounce: delays running `fn` until `wait` ms after the last call. Used to keep
// search boxes responsive — re-rendering large lists on every keystroke is wasteful,
// and barcode scanners "type" a whole code in a burst before the Enter key.
function debounce(fn, wait) {
    var timer = null;
    return function () {
        var ctx = this, args = arguments;
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () { timer = null; fn.apply(ctx, args); }, wait || 120);
    };
}

function setupEventListeners() {
    var navBtns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < navBtns.length; i++) {
        navBtns[i].addEventListener('click', function () {
            switchPage(this.getAttribute('data-page'));
        });
    }

    document.getElementById('productSearch').addEventListener('input', debounce(renderProducts, 120));
    document.getElementById('categoryFilter').addEventListener('change', renderProducts);

    document.getElementById('productsGrid').addEventListener('click', function (e) {
        var card = e.target.closest('.product-card');
        if (card) openVariantModal(card.getAttribute('data-id'));
    });

    document.getElementById('variantColors').addEventListener('click', function (e) {
        var opt = e.target.closest('.color-option');
        if (opt && !opt.classList.contains('disabled')) {
            varModalColor = opt.getAttribute('data-color');
            varModalSize = null;
            renderVariantColors();
            renderVariantSizes();
            autoSelectSingleSize();
        }
    });

    document.getElementById('variantSizes').addEventListener('click', function (e) {
        var opt = e.target.closest('.size-option');
        if (opt && !opt.classList.contains('disabled')) {
            varModalSize = opt.getAttribute('data-size');
            renderVariantSizes();
            updateStockInfo();
        }
    });

    document.getElementById('varQtyMinus').addEventListener('click', function () {
        var inp = document.getElementById('varQtyInput');
        var val = parseInt(inp.value) || 1;
        if (val > 1) inp.value = val - 1;
    });
    document.getElementById('varQtyPlus').addEventListener('click', function () {
        var inp = document.getElementById('varQtyInput');
        inp.value = (parseInt(inp.value) || 1) + 1;
    });

    document.getElementById('addToCartFromModal').addEventListener('click', addToCartFromModal);
    document.getElementById('closeVariantModal').addEventListener('click', function () {
        document.getElementById('variantModal').style.display = 'none';
    });

    document.getElementById('clearCartBtn').addEventListener('click', function () { cart = []; renderCart(); });
    document.getElementById('discountInput').addEventListener('input', function () { updateTotals(); recomputeChange(); });
    document.getElementById('discountType').addEventListener('change', function () { updateTotals(); recomputeChange(); });

    var payBtns = document.querySelectorAll('.pay-btn');
    for (var i = 0; i < payBtns.length; i++) {
        payBtns[i].addEventListener('click', function () {
            for (var j = 0; j < payBtns.length; j++) payBtns[j].classList.remove('active');
            this.classList.add('active');
            selectedPayment = this.getAttribute('data-method');
            updatePaymentUI();
        });
    }
    var tenderInput = document.getElementById('tenderInput');
    if (tenderInput) tenderInput.addEventListener('input', recomputeChange);

    document.getElementById('checkoutBtn').addEventListener('click', checkout);
    document.getElementById('printReceiptBtn').addEventListener('click', function () {
        if (currentReceiptBill) printReceipt(currentReceiptBill); else window.print();
    });
    document.getElementById('closeReceiptBtn').addEventListener('click', function () {
        document.getElementById('receiptModal').style.display = 'none';
    });

    if (document.getElementById('inventorySearch')) {
        document.getElementById('inventorySearch').addEventListener('input', debounce(renderInventory, 120));
    }
    document.getElementById('exportInventoryBtn').addEventListener('click', exportInventory);

    // Add Stock
    document.getElementById('addStockBtn').addEventListener('click', openAddStockForm);
    document.getElementById('cancelStockBtn').addEventListener('click', function () {
        document.getElementById('addStockForm').style.display = 'none';
    });
    document.getElementById('stockBarcode').addEventListener('keydown', handleStockBarcode);
    document.getElementById('stockProduct').addEventListener('change', populateStockColors);
    document.getElementById('stockColor').addEventListener('change', populateStockSizes);
    document.getElementById('saveStockBtn').addEventListener('click', saveAddStock);

    document.getElementById('newDamageBtn').addEventListener('click', openDamageForm);
    document.getElementById('cancelDamageBtn').addEventListener('click', function () {
        document.getElementById('damageForm').style.display = 'none';
    });
    document.getElementById('damageProduct').addEventListener('change', populateDamageColors);
    document.getElementById('damageColor').addEventListener('change', populateDamageSizes);
    document.getElementById('saveDamageBtn').addEventListener('click', saveDamage);

    document.getElementById('filterBillsBtn').addEventListener('click', renderBills);
    var billsSearch = document.getElementById('billsSearch');
    if (billsSearch) {
        billsSearch.addEventListener('input', debounce(renderBills, 150));
        billsSearch.addEventListener('keydown', function (e) {
            // Barcode scanners send the code followed by Enter.
            if (e.key === 'Enter') { e.preventDefault(); renderBills(); }
        });
    }

    // Add product to bill by code/id
    var codeAddBtn = document.getElementById('codeAddBtn');
    var codeAddInput = document.getElementById('codeAddInput');
    if (codeAddBtn && codeAddInput) {
        codeAddBtn.addEventListener('click', function () { addByCode(codeAddInput.value); codeAddInput.value = ''; codeAddInput.focus(); });
        codeAddInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { addByCode(this.value); this.value = ''; }
        });
    }

    // Close work day (admin)
    var closeDayBtn = document.getElementById('closeDayBtn');
    if (closeDayBtn) closeDayBtn.addEventListener('click', openCloseDayModal);
    var confirmCloseDayBtn = document.getElementById('confirmCloseDayBtn');
    if (confirmCloseDayBtn) confirmCloseDayBtn.addEventListener('click', confirmCloseDay);
    var cancelCloseDayBtn = document.getElementById('cancelCloseDayBtn');
    if (cancelCloseDayBtn) cancelCloseDayBtn.addEventListener('click', function () {
        document.getElementById('closeDayModal').style.display = 'none';
    });
    var closeDayX = document.getElementById('closeDayX');
    if (closeDayX) closeDayX.addEventListener('click', function () {
        document.getElementById('closeDayModal').style.display = 'none';
    });
    var closeDayModal = document.getElementById('closeDayModal');
    if (closeDayModal) closeDayModal.addEventListener('click', function (e) {
        if (e.target === this) this.style.display = 'none';
    });
    var printDayCloseBtn = document.getElementById('printDayCloseBtn');
    if (printDayCloseBtn) printDayCloseBtn.addEventListener('click', function () { printDayClose(computeShiftSummary()); });

    // Themed confirm/alert modal buttons
    var confirmYesBtn = document.getElementById('confirmYesBtn');
    if (confirmYesBtn) confirmYesBtn.addEventListener('click', function () {
        var cb = _confirmCb;
        _closeConfirm();
        if (cb) cb();
    });
    var confirmNoBtn = document.getElementById('confirmNoBtn');
    if (confirmNoBtn) confirmNoBtn.addEventListener('click', _closeConfirm);
    var confirmModal = document.getElementById('confirmModal');
    if (confirmModal) confirmModal.addEventListener('click', function (e) {
        if (e.target === this) _closeConfirm();
    });

    // Statistics page
    var statsRunBtn = document.getElementById('statsRunBtn');
    if (statsRunBtn) statsRunBtn.addEventListener('click', runStats);
    var statsPrintBtn = document.getElementById('statsPrintBtn');
    if (statsPrintBtn) statsPrintBtn.addEventListener('click', printStats);
    var quickBtns = document.querySelectorAll('.stats-quick');
    for (var qi = 0; qi < quickBtns.length; qi++) {
        quickBtns[qi].addEventListener('click', function () { setStatsQuickRange(this.getAttribute('data-range')); });
    }
    var monthlyRunBtn = document.getElementById('monthlyRunBtn');
    if (monthlyRunBtn) monthlyRunBtn.addEventListener('click', runMonthlyCheck);
    var monthlyPrintBtn = document.getElementById('monthlyPrintBtn');
    if (monthlyPrintBtn) monthlyPrintBtn.addEventListener('click', printMonthly);
    var monthlyMonth = document.getElementById('monthlyMonth');
    if (monthlyMonth && !monthlyMonth.value) {
        var now = new Date();
        monthlyMonth.value = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
    }

    document.getElementById('productSearch').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            var val = this.value.trim();
            if (val) {
                var match = products.find(function (p) { return p.id === val; });
                if (match && getTotalStock(match) > 0) {
                    openVariantModal(match.id);
                    this.value = '';
                }
            }
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', logout);

    document.getElementById('variantModal').addEventListener('click', function (e) {
        if (e.target === this) this.style.display = 'none';
    });
    document.getElementById('receiptModal').addEventListener('click', function (e) {
        if (e.target === this) this.style.display = 'none';
    });

    // ---- Phase 2-5 wiring ----
    // Generic modal close buttons (data-close) + overlay click
    var closeBtns = document.querySelectorAll('[data-close]');
    for (var ci = 0; ci < closeBtns.length; ci++) {
        closeBtns[ci].addEventListener('click', function () { closeModal(this.getAttribute('data-close')); });
    }
    var overlayIds = ['withdrawModal', 'customerModal', 'addDebtModal', 'settleDebtModal', 'heldModal', 'categoryModal'];
    for (var oi = 0; oi < overlayIds.length; oi++) {
        (function (id) {
            var m = document.getElementById(id);
            if (m) m.addEventListener('click', function (e) { if (e.target === this) closeModal(id); });
        })(overlayIds[oi]);
    }

    // Withdrawals
    var withdrawBtn = document.getElementById('withdrawBtn');
    if (withdrawBtn) withdrawBtn.addEventListener('click', openWithdrawModal);
    var saveWithdrawBtn = document.getElementById('saveWithdrawBtn');
    if (saveWithdrawBtn) saveWithdrawBtn.addEventListener('click', saveWithdrawal);

    // Customer picker (debt sale)
    var customerConfirmBtn = document.getElementById('customerConfirmBtn');
    if (customerConfirmBtn) customerConfirmBtn.addEventListener('click', function () {
        var name = document.getElementById('customerName').value.trim();
        var phone = document.getElementById('customerPhone').value.trim();
        if (!name && !phone) { showAlert('أدخل اسم العميل أو رقم هاتفه', { icon: '⚠️', title: 'تنبيه' }); return; }
        closeModal('customerModal');
        if (_customerCb) _customerCb({ name: name, phone: normalizePhone(phone) });
    });
    var customerPhone = document.getElementById('customerPhone');
    if (customerPhone) customerPhone.addEventListener('input', function () {
        renderCustomerMatches(this.value, document.getElementById('customerMatches'));
    });
    var customerMatches = document.getElementById('customerMatches');
    if (customerMatches) customerMatches.addEventListener('click', function (e) {
        var row = e.target.closest('.customer-match');
        if (!row) return;
        var key = row.getAttribute('data-key');
        var list = customerList();
        for (var i = 0; i < list.length; i++) {
            if (list[i].key === key) {
                document.getElementById('customerName').value = list[i].name || '';
                document.getElementById('customerPhone').value = list[i].phone || '';
                break;
            }
        }
        this.innerHTML = '';
    });

    // Debts page
    var addDebtBtn = document.getElementById('addDebtBtn');
    if (addDebtBtn) addDebtBtn.addEventListener('click', openAddDebtModal);
    var saveDebtBtn = document.getElementById('saveDebtBtn');
    if (saveDebtBtn) saveDebtBtn.addEventListener('click', saveAddDebt);
    var debtsSearch = document.getElementById('debtsSearch');
    if (debtsSearch) debtsSearch.addEventListener('input', debounce(renderDebts, 150));
    var debtPhone = document.getElementById('debtPhone');
    if (debtPhone) debtPhone.addEventListener('input', function () {
        renderCustomerMatches(this.value, document.getElementById('debtMatches'));
    });
    var debtMatches = document.getElementById('debtMatches');
    if (debtMatches) debtMatches.addEventListener('click', function (e) {
        var row = e.target.closest('.customer-match');
        if (!row) return;
        var key = row.getAttribute('data-key');
        var list = customerList();
        for (var i = 0; i < list.length; i++) {
            if (list[i].key === key) {
                document.getElementById('debtName').value = list[i].name || '';
                document.getElementById('debtPhone').value = list[i].phone || '';
                break;
            }
        }
        this.innerHTML = '';
    });
    var saveSettleBtn = document.getElementById('saveSettleBtn');
    if (saveSettleBtn) saveSettleBtn.addEventListener('click', saveSettleDebt);

    // Returns page
    var returnBillLoadBtn = document.getElementById('returnBillLoadBtn');
    if (returnBillLoadBtn) returnBillLoadBtn.addEventListener('click', loadReturnBill);
    var returnBillSearch = document.getElementById('returnBillSearch');
    if (returnBillSearch) returnBillSearch.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); loadReturnBill(); }
    });

    // Register balance (settings)
    var regSetBtn = document.getElementById('regSetBtn');
    if (regSetBtn) regSetBtn.addEventListener('click', saveRegisterBalance);

    // Category boxes + brand/filter popup
    var categoryBoxes = document.getElementById('categoryBoxes');
    if (categoryBoxes) categoryBoxes.addEventListener('click', function (e) {
        var bx = e.target.closest('.category-box');
        if (bx) openCategoryModal(bx.getAttribute('data-type'));
    });
    var categorySearch = document.getElementById('categorySearch');
    if (categorySearch) {
        categorySearch.addEventListener('input', debounce(renderCategoryModal, 120));
        categorySearch.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            var code = this.value.trim();
            var p = products.find(function (x) { return String(x.id) === code; });
            if (p) { openVariantModal(String(p.id), catModalTarget); this.value = ''; renderCategoryModal(); }
        });
    }
    var categoryCats = document.getElementById('categoryCats');
    if (categoryCats) categoryCats.addEventListener('click', function (e) {
        var chip = e.target.closest('.cat-chip');
        if (!chip) return;
        var v = chip.getAttribute('data-cat');
        catModalType = v ? v : null;
        catModalBrand = null;
        catModalSize = null;
        renderCategoryModal();
    });
    var categoryBrands = document.getElementById('categoryBrands');
    if (categoryBrands) categoryBrands.addEventListener('click', function (e) {
        var chip = e.target.closest('.cat-chip');
        if (!chip) return;
        var v = chip.getAttribute('data-brand');
        catModalBrand = v ? v : null;
        renderCategoryModal();
    });
    var categorySizes = document.getElementById('categorySizes');
    if (categorySizes) categorySizes.addEventListener('click', function (e) {
        var chip = e.target.closest('.cat-chip');
        if (!chip) return;
        var v = chip.getAttribute('data-size');
        catModalSize = v ? v : null;
        renderCategoryModal();
    });
    var categoryProducts = document.getElementById('categoryProducts');
    if (categoryProducts) categoryProducts.addEventListener('click', function (e) {
        var card = e.target.closest('.product-card');
        if (card) openVariantModal(card.getAttribute('data-id'), catModalTarget);
    });

    // Held / parked sales
    var holdSaleBtn = document.getElementById('holdSaleBtn');
    if (holdSaleBtn) holdSaleBtn.addEventListener('click', holdSale);
    var resumeSaleBtn = document.getElementById('resumeSaleBtn');
    if (resumeSaleBtn) resumeSaleBtn.addEventListener('click', openHeldModal);
}

// ============ HELPERS: HTML ESCAPE + BILL DIGITS ============
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function billDigits(bill) {
    return (bill.billNumber || bill.orderNumber || bill.id || '').toString().replace(/\D/g, '');
}

// ============ CODE 128-C BARCODE (self-contained SVG, no deps) ============
// Encodes a numeric string (the bill's digits) as a scannable Code 128-C barcode.
var C128_PATTERNS = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
function code128cSVG(digits) {
    var s = String(digits || '').replace(/\D/g, '');
    if (!s) return '';
    if (s.length % 2) s = '0' + s; // Code-C encodes digit pairs
    var values = [105]; // Start C
    for (var i = 0; i < s.length; i += 2) values.push(parseInt(s.substr(i, 2), 10));
    var sum = 105;
    for (var i = 1; i < values.length; i++) sum += values[i] * i;
    values.push(sum % 103); // checksum
    values.push(106);       // Stop
    var pat = '';
    for (var i = 0; i < values.length; i++) pat += C128_PATTERNS[values[i]];
    var quiet = 10, x = quiet, height = 42, rects = '', bar = true;
    for (var i = 0; i < pat.length; i++) {
        var w = parseInt(pat.charAt(i), 10);
        if (bar) rects += '<rect x="' + x + '" y="0" width="' + w + '" height="' + height + '"/>';
        x += w; bar = !bar;
    }
    var totalW = x + quiet;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + totalW + ' ' + height +
        '" preserveAspectRatio="none" shape-rendering="crispEdges">' +
        '<rect x="0" y="0" width="' + totalW + '" height="' + height + '" fill="#fff"/>' +
        '<g fill="#000">' + rects + '</g></svg>';
}

// ============ KEYBOARD SHORTCUTS (F1–F12, configurable) ============
var SHORTCUT_ACTIONS = [
    { id: 'none', label: 'بدون' },
    { id: 'focus-search', label: 'بحث عن منتج' },
    { id: 'focus-code', label: 'إضافة بالكود/الباركود' },
    { id: 'checkout', label: 'إتمام البيع' },
    { id: 'clear-cart', label: 'مسح السلة' },
    { id: 'toggle-payment', label: 'تبديل طريقة الدفع' },
    { id: 'page-sales', label: 'صفحة المبيعات' },
    { id: 'page-inventory', label: 'صفحة المخزون' },
    { id: 'page-damage', label: 'صفحة الإتلاف' },
    { id: 'page-bills', label: 'صفحة الفواتير' },
    { id: 'page-reports', label: 'صفحة التقارير' },
    { id: 'page-stats', label: 'صفحة الإحصائيات' },
    { id: 'page-settings', label: 'صفحة الإعدادات' },
    { id: 'focus-bill-search', label: 'بحث الفواتير' },
    { id: 'close-day', label: 'إغلاق اليوم (مدير)' }
];
var DEFAULT_SHORTCUTS = {
    F1: 'focus-search', F2: 'focus-code', F3: 'page-bills', F4: 'checkout',
    F5: 'clear-cart', F6: 'toggle-payment', F7: 'page-sales', F8: 'page-inventory',
    F9: 'page-damage', F10: 'page-reports', F11: 'page-stats', F12: 'page-settings'
};
var shortcuts = {};
function shortcutsKey() { return 'ada_pos_shortcuts_' + (getProjectId() || ''); }
function loadShortcuts() {
    shortcuts = {};
    for (var k in DEFAULT_SHORTCUTS) shortcuts[k] = DEFAULT_SHORTCUTS[k];
    try {
        var raw = localStorage.getItem(shortcutsKey());
        if (raw) {
            var saved = JSON.parse(raw);
            for (var k in saved) { if (saved.hasOwnProperty(k)) shortcuts[k] = saved[k]; }
        }
    } catch (e) {}
}
function saveShortcuts() {
    try { localStorage.setItem(shortcutsKey(), JSON.stringify(shortcuts)); } catch (e) {}
}
function setPaymentMethod(method) {
    selectedPayment = method;
    var payBtns = document.querySelectorAll('.pay-btn');
    for (var i = 0; i < payBtns.length; i++) {
        payBtns[i].classList.toggle('active', payBtns[i].getAttribute('data-method') === method);
    }
}
function runShortcutAction(action) {
    switch (action) {
        case 'focus-search': switchPage('sales'); var s = document.getElementById('productSearch'); if (s) { s.focus(); s.select(); } break;
        case 'focus-code': switchPage('sales'); var c = document.getElementById('codeAddInput'); if (c) c.focus(); break;
        case 'checkout': switchPage('sales'); checkout(); break;
        case 'clear-cart': cart = []; renderCart(); break;
        case 'toggle-payment': setPaymentMethod(selectedPayment === 'cash' ? 'card' : 'cash'); break;
        case 'page-sales': switchPage('sales'); break;
        case 'page-inventory': switchPage('inventory'); break;
        case 'page-damage': switchPage('damage'); break;
        case 'page-bills': switchPage('bills'); break;
        case 'page-reports': switchPage('reports'); break;
        case 'page-stats': switchPage('stats'); break;
        case 'page-settings': switchPage('settings'); break;
        case 'focus-bill-search': switchPage('bills'); var bs = document.getElementById('billsSearch'); if (bs) { bs.focus(); bs.select(); } break;
        case 'close-day': if (isAdmin()) openCloseDayModal(); break;
    }
}
function handleShortcutKey(e) {
    // Escape closes the top-most open modal (accessibility / quick dismiss).
    if (e.key === 'Escape') {
        if (closeTopModal()) e.preventDefault();
        return;
    }
    if (!/^F([1-9]|1[0-2])$/.test(e.key)) return;
    var action = shortcuts[e.key];
    if (!action || action === 'none') return;
    e.preventDefault();
    runShortcutAction(action);
}
function renderShortcutsEditor() {
    var grid = document.getElementById('shortcutsGrid');
    if (!grid) return;
    var html = '';
    for (var n = 1; n <= 12; n++) {
        var key = 'F' + n;
        var cur = shortcuts[key] || 'none';
        html += '<div class="shortcut-row"><span class="shortcut-key">' + key + '</span>';
        html += '<select data-key="' + key + '" class="shortcut-select">';
        for (var a = 0; a < SHORTCUT_ACTIONS.length; a++) {
            var act = SHORTCUT_ACTIONS[a];
            html += '<option value="' + act.id + '"' + (act.id === cur ? ' selected' : '') + '>' + act.label + '</option>';
        }
        html += '</select></div>';
    }
    grid.innerHTML = html;
}
function initShortcutsUI() {
    var grid = document.getElementById('shortcutsGrid');
    if (grid) {
        grid.addEventListener('change', function (e) {
            var sel = e.target.closest('.shortcut-select');
            if (!sel) return;
            shortcuts[sel.getAttribute('data-key')] = sel.value;
            saveShortcuts();
        });
    }
    var reset = document.getElementById('resetShortcutsBtn');
    if (reset) reset.addEventListener('click', function () {
        shortcuts = {};
        for (var k in DEFAULT_SHORTCUTS) shortcuts[k] = DEFAULT_SHORTCUTS[k];
        saveShortcuts();
        renderShortcutsEditor();
    });
    document.addEventListener('keydown', handleShortcutKey);
}

// ============ GENERAL NOTES (per-terminal notepad) ============
function generalNotesKey() { return 'ada_pos_general_notes_' + (getProjectId() || ''); }
function initGeneralNotes() {
    var ta = document.getElementById('generalNotes');
    if (!ta) return;
    try { ta.value = localStorage.getItem(generalNotesKey()) || ''; } catch (e) {}
    var hint = document.getElementById('notesSavedHint');
    var t = null;
    ta.addEventListener('input', function () {
        try { localStorage.setItem(generalNotesKey(), ta.value); } catch (e) {}
        if (hint) {
            hint.textContent = '✔ تم الحفظ';
            if (t) clearTimeout(t);
            t = setTimeout(function () { hint.textContent = ''; }, 1500);
        }
    });
}

// ============ POS RECORD PERSISTENCE (shared by withdrawals, debts, returns) ============
// All auxiliary records live in the `orders` collection with a recordType tag,
// so they persist on both the Cloudflare D1 backend and Firestore without any
// new endpoints. Sales reporting filters by recordType, so they never mix in.
function newRecordId(prefix) {
    return (prefix || 'REC') + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}
function savePosRecord(record, idPrefix, onOk, onErr) {
    var id = record.id || newRecordId(idPrefix);
    record.id = id;
    record.source = 'pos';
    record.createdAt = serverTimestamp();
    record.createdAtIso = new Date().toISOString();
    db.collection('orders').doc(id).set(record)
        .then(function () { if (onOk) onOk(id); })
        .catch(function (e) { if (onErr) onErr(e); else showAlert('خطأ في الحفظ: ' + (e && e.message), { icon: '⚠️', title: 'خطأ' }); });
}

// Apply mixed signed deltas in a SINGLE write per product (avoids stale-read clobber
// when the same product is both returned and taken as a replacement in one exchange).
// deltas: [{productId,color,size,delta}] where delta may be + (restock) or - (deduct).
function applyCombinedStockDeltas(deltas) {
    var byProduct = {};
    for (var i = 0; i < deltas.length; i++) {
        var d = deltas[i];
        if (!d.productId || !d.delta) continue;
        if (!byProduct[d.productId]) {
            var prod = products.find(function (p) { return p.id === d.productId; });
            if (!prod) continue;
            byProduct[d.productId] = JSON.parse(JSON.stringify(prod.variants || []));
        }
        var vars = byProduct[d.productId];
        for (var j = 0; j < vars.length; j++) {
            if (vars[j].color === d.color && vars[j].size === d.size) {
                vars[j].stock = Math.max(0, (vars[j].stock || 0) + d.delta);
            }
        }
    }
    var promises = [];
    var keys = Object.keys(byProduct);
    for (var k = 0; k < keys.length; k++) {
        promises.push(db.collection('products').doc(keys[k]).update({ variants: byProduct[keys[k]] }));
    }
    return Promise.all(promises);
}
function getRegisterBalance() { return registerBalance || 0; }

function renderRegisterSettings() {
    var el = document.getElementById('regCurrentBalance');
    if (el) el.textContent = '\u20AA' + getRegisterBalance().toFixed(2);
}

function saveRegisterBalance() {
    var inp = document.getElementById('regSetInput');
    if (!inp) return;
    var amount = parseFloat(inp.value);
    if (isNaN(amount) || amount < 0) { showAlert('أدخل مبلغاً صحيحاً', { icon: '⚠️', title: 'تنبيه' }); return; }
    savePosRecord({ recordType: 'register', kind: 'set', balance: amount, total: 0 }, 'REG', function () {
        registerBalance = amount;
        renderRegisterSettings();
        inp.value = '';
        logActivity('register_set', 'تعيين رصيد الصندوق إلى \u20AA' + amount.toFixed(2), { balance: amount });
        var hint = document.getElementById('regSavedHint');
        if (hint) { hint.textContent = 'تم حفظ رصيد الصندوق ✅'; setTimeout(function () { hint.textContent = ''; }, 2500); }
    });
}

function paymentLabel(method) {
    if (method === 'cash') return 'نقدي';
    if (method === 'card') return 'بطاقة';
    if (method === 'debt') return 'آجل';
    return method || '-';
}

// ============ PAYMENT UI (tender / change) ============
function updatePaymentUI() {
    var tenderRow = document.getElementById('tenderRow');
    if (tenderRow) tenderRow.style.display = (selectedPayment === 'cash') ? 'flex' : 'none';
    recomputeChange();
}
function recomputeChange() {
    var changeEl = document.getElementById('changeDue');
    var tenderEl = document.getElementById('tenderInput');
    if (!changeEl || !tenderEl) return;
    var total = 0;
    for (var i = 0; i < cart.length; i++) total += cart[i].price * cart[i].qty;
    var discountVal = parseFloat(document.getElementById('discountInput').value) || 0;
    var discountType = document.getElementById('discountType').value;
    var discount = discountType === 'percent' ? total * (discountVal / 100) : discountVal;
    total = Math.max(0, total - discount);
    var t = parseFloat(tenderEl.value);
    if (isNaN(t) || t <= 0) { changeEl.textContent = ''; return; }
    var ch = t - total;
    changeEl.textContent = ch >= 0 ? ('الباقي: \u20AA' + ch.toFixed(2)) : ('ناقص: \u20AA' + Math.abs(ch).toFixed(2));
    changeEl.className = 'change-due ' + (ch >= 0 ? 'ok' : 'short');
}

// ============ MODAL HELPERS ============
// openModal also moves keyboard focus to the first usable field for accessibility.
function openModal(id) {
    var m = document.getElementById(id);
    if (!m) return;
    m.style.display = 'flex';
    var focusable = m.querySelector('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
    if (focusable) { try { focusable.focus(); } catch (e) {} }
}
function closeModal(id) { var m = document.getElementById(id); if (m) m.style.display = 'none'; }
// Close the top-most currently open modal (used by the global Escape handler).
function closeTopModal() {
    var open = document.querySelectorAll('.modal-overlay');
    for (var i = open.length - 1; i >= 0; i--) {
        var style = window.getComputedStyle(open[i]);
        if (style.display !== 'none') { open[i].style.display = 'none'; return true; }
    }
    return false;
}

// ============ CUSTOMERS / DEBTS INDEX ============
function normalizePhone(p) { return (p || '').toString().replace(/\D/g, ''); }
function customerKey(c) {
    var ph = normalizePhone(c && c.phone);
    return ph || ('name:' + ((c && c.name) || '').trim());
}
// Build outstanding-balance index keyed by customer.
function buildCustomerIndex() {
    var idx = {};
    function ensure(c) {
        var key = customerKey(c);
        if (!idx[key]) idx[key] = { key: key, name: (c && c.name) || '', phone: normalizePhone(c && c.phone), debt: 0, paid: 0 };
        if (c && c.name && !idx[key].name) idx[key].name = c.name;
        return idx[key];
    }
    for (var i = 0; i < bills.length; i++) {
        var b = bills[i];
        if (b.paymentMethod === 'debt' && b.customer) ensure(b.customer).debt += b.total || 0;
    }
    for (var i = 0; i < debtManual.length; i++) {
        var d = debtManual[i];
        if (d.customer) ensure(d.customer).debt += d.amount || 0;
    }
    for (var i = 0; i < debtPayments.length; i++) {
        var p = debtPayments[i];
        if (p.customer) ensure(p.customer).paid += p.amount || 0;
    }
    return idx;
}
function customerList() {
    var idx = buildCustomerIndex();
    var arr = [];
    for (var k in idx) {
        if (!idx.hasOwnProperty(k)) continue;
        idx[k].balance = (idx[k].debt || 0) - (idx[k].paid || 0);
        arr.push(idx[k]);
    }
    arr.sort(function (a, b) { return b.balance - a.balance; });
    return arr;
}

// Customer picker modal (used by debt sales)
var _customerCb = null;
function openCustomerModal(title, onConfirm) {
    _customerCb = onConfirm || null;
    document.getElementById('customerModalTitle').textContent = title || 'بيانات العميل';
    document.getElementById('customerPhone').value = '';
    document.getElementById('customerName').value = '';
    document.getElementById('customerMatches').innerHTML = '';
    openModal('customerModal');
    setTimeout(function () { var el = document.getElementById('customerPhone'); if (el) el.focus(); }, 50);
}
function renderCustomerMatches(term, container) {
    var n = normalizePhone(term);
    var name = (term || '').toLowerCase();
    var list = customerList();
    var html = '';
    for (var i = 0; i < list.length && i < 6; i++) {
        var c = list[i];
        if (n && c.phone.indexOf(n) < 0) {
            if (!name || c.name.toLowerCase().indexOf(name) < 0) continue;
        } else if (!n && name && c.name.toLowerCase().indexOf(name) < 0) continue;
        html += '<div class="customer-match" data-key="' + escapeHtml(c.key) + '">' + escapeHtml(c.name || '(بدون اسم)') +
            ' — ' + escapeHtml(c.phone || '') + ' <span class="cm-bal">متبقي \u20AA' + c.balance.toFixed(2) + '</span></div>';
    }
    container.innerHTML = html;
}

// ============ PERSONAL WITHDRAWALS ============
function openWithdrawModal() {
    document.getElementById('withdrawAmount').value = '';
    document.getElementById('withdrawReason').value = '';
    document.getElementById('withdrawWho').value = currentUser ? (currentUser.displayName || currentUser.username || '') : '';
    openModal('withdrawModal');
}
function saveWithdrawal() {
    var amount = parseFloat(document.getElementById('withdrawAmount').value) || 0;
    if (amount <= 0) { showAlert('أدخل مبلغاً صحيحاً', { icon: '⚠️', title: 'تنبيه' }); return; }
    var who = document.getElementById('withdrawWho').value.trim() || (currentUser ? currentUser.username : '');
    var reason = document.getElementById('withdrawReason').value.trim();
    var btn = document.getElementById('saveWithdrawBtn');
    btn.disabled = true; btn.textContent = 'جاري الحفظ...';
    savePosRecord({
        recordType: 'withdrawal', amount: amount, who: who, reason: reason,
        cashier: currentUser ? currentUser.username : '', total: 0, status: 'withdrawal'
    }, 'WD', function () {
        btn.disabled = false; btn.textContent = 'تأكيد السحب';
        closeModal('withdrawModal');
        logActivity('withdrawal', 'سحب شخصي \u20AA' + amount.toFixed(2) + ' - ' + who, { amount: amount, who: who, reason: reason });
        showAlert('تم تسجيل السحب \u20AA' + amount.toFixed(2), { icon: '✅', title: 'تم' });
    }, function (e) {
        btn.disabled = false; btn.textContent = 'تأكيد السحب';
        showAlert('تعذر حفظ السحب: ' + (e && e.message), { icon: '⚠️', title: 'خطأ' });
    });
}
function renderWithdrawals(since) {
    var body = document.getElementById('withdrawalsBody');
    if (!body) return;
    var html = '';
    for (var i = 0; i < withdrawals.length; i++) {
        var w = withdrawals[i];
        if (since && billTimeMs(w) < since) continue;
        var t = billTimeMs(w) ? new Date(billTimeMs(w)).toLocaleString('ar-EG') : '';
        html += '<tr><td>' + t + '</td><td>' + escapeHtml(w.who || w.cashier || '-') + '</td><td>\u20AA' +
            (w.amount || 0).toFixed(2) + '</td><td>' + escapeHtml(w.reason || '-') + '</td></tr>';
    }
    body.innerHTML = html || '<tr><td colspan="4" style="text-align:center;padding:16px;">لا توجد سحوبات في الوردية الحالية</td></tr>';
}

// ============ DEBTS (ذمم) ============
function renderDebts() {
    var body = document.getElementById('debtsBody');
    if (!body) return;
    var term = (document.getElementById('debtsSearch') ? document.getElementById('debtsSearch').value : '').trim();
    var n = normalizePhone(term), low = term.toLowerCase();
    var list = customerList();
    var totalOut = 0, custCount = 0;
    var html = '';
    for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.balance > 0.0001) { totalOut += c.balance; custCount++; }
        if (term) {
            var match = (n && c.phone.indexOf(n) >= 0) || (c.name && c.name.toLowerCase().indexOf(low) >= 0);
            if (!match) continue;
        }
        var actions = '';
        if (c.balance > 0.0001) {
            actions = '<button class="btn-primary" onclick="openSettleDebt(\'' + encodeURIComponent(c.key) + '\')">تسديد</button>';
        } else {
            actions = '<span class="badge badge-paid">مسدّدة</span>';
        }
        html += '<tr><td>' + escapeHtml(c.name || '(بدون اسم)') + '</td><td>' + (c.phone || '-') + '</td><td>\u20AA' +
            c.debt.toFixed(2) + '</td><td>\u20AA' + c.paid.toFixed(2) + '</td><td>\u20AA' + c.balance.toFixed(2) +
            '</td><td>' + actions + '</td></tr>';
    }
    body.innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:16px;">لا توجد ذمم</td></tr>';
    var to = document.getElementById('debtsTotalOutstanding');
    if (to) to.textContent = '\u20AA' + totalOut.toFixed(2);
    var cc = document.getElementById('debtsCustomersCount');
    if (cc) cc.textContent = custCount + ' عميل';
}
function openAddDebtModal() {
    document.getElementById('debtPhone').value = '';
    document.getElementById('debtName').value = '';
    document.getElementById('debtAmount').value = '';
    document.getElementById('debtNote').value = '';
    document.getElementById('debtMatches').innerHTML = '';
    openModal('addDebtModal');
}
function saveAddDebt() {
    var name = document.getElementById('debtName').value.trim();
    var phone = normalizePhone(document.getElementById('debtPhone').value);
    var amount = parseFloat(document.getElementById('debtAmount').value) || 0;
    var note = document.getElementById('debtNote').value.trim();
    if (!name && !phone) { showAlert('أدخل اسم العميل أو رقم هاتفه', { icon: '⚠️', title: 'تنبيه' }); return; }
    if (amount <= 0) { showAlert('أدخل قيمة ذمة صحيحة', { icon: '⚠️', title: 'تنبيه' }); return; }
    var btn = document.getElementById('saveDebtBtn');
    btn.disabled = true; btn.textContent = 'جاري الحفظ...';
    savePosRecord({
        recordType: 'debt-manual', amount: amount, note: note,
        customer: { name: name, phone: phone }, cashier: currentUser ? currentUser.username : '', total: 0
    }, 'DM', function () {
        btn.disabled = false; btn.textContent = 'حفظ الذمة';
        closeModal('addDebtModal');
        logActivity('debt-add', 'ذمة \u20AA' + amount.toFixed(2) + ' على ' + name, { amount: amount, customer: name });
        showAlert('تم تسجيل الذمة', { icon: '✅', title: 'تم' });
    }, function (e) {
        btn.disabled = false; btn.textContent = 'حفظ الذمة';
        showAlert('تعذر حفظ الذمة: ' + (e && e.message), { icon: '⚠️', title: 'خطأ' });
    });
}
var _settleCustomer = null;
function openSettleDebt(encKey) {
    var key = decodeURIComponent(encKey);
    var list = customerList();
    var c = null;
    for (var i = 0; i < list.length; i++) { if (list[i].key === key) { c = list[i]; break; } }
    if (!c) return;
    _settleCustomer = c;
    var html = '';
    html += '<div class="cd-row"><span>العميل</span><span>' + escapeHtml(c.name || '-') + '</span></div>';
    html += '<div class="cd-row"><span>الهاتف</span><span>' + (c.phone || '-') + '</span></div>';
    html += '<div class="cd-row cd-total"><span>المتبقي</span><span>\u20AA' + c.balance.toFixed(2) + '</span></div>';
    html += '<div class="form-group full-width"><label>مبلغ التسديد (₪)</label><input type="number" id="settleAmount" min="0" value="' + c.balance.toFixed(2) + '"></div>';
    html += '<div class="form-group full-width"><label>طريقة الدفع</label><select id="settleMethod"><option value="cash">نقدي</option><option value="card">بطاقة</option></select></div>';
    document.getElementById('settleDebtBody').innerHTML = html;
    openModal('settleDebtModal');
}
function saveSettleDebt() {
    if (!_settleCustomer) return;
    var amount = parseFloat(document.getElementById('settleAmount').value) || 0;
    var method = document.getElementById('settleMethod').value;
    if (amount <= 0) { showAlert('أدخل مبلغاً صحيحاً', { icon: '⚠️', title: 'تنبيه' }); return; }
    var btn = document.getElementById('saveSettleBtn');
    btn.disabled = true; btn.textContent = 'جاري الحفظ...';
    var c = _settleCustomer;
    savePosRecord({
        recordType: 'debt-payment', amount: amount, paymentMethod: method,
        customer: { name: c.name, phone: c.phone }, cashier: currentUser ? currentUser.username : '', total: 0
    }, 'DP', function () {
        btn.disabled = false; btn.textContent = 'تأكيد التسديد';
        closeModal('settleDebtModal');
        logActivity('debt-pay', 'تسديد ذمة \u20AA' + amount.toFixed(2) + ' من ' + c.name, { amount: amount, customer: c.name, method: method });
        showAlert('تم تسجيل التسديد \u20AA' + amount.toFixed(2), { icon: '✅', title: 'تم' });
    }, function (e) {
        btn.disabled = false; btn.textContent = 'تأكيد التسديد';
        showAlert('تعذر حفظ التسديد: ' + (e && e.message), { icon: '⚠️', title: 'خطأ' });
    });
}

// ============ RETURNS / EXCHANGES ============
function loadReturnBill() {
    var term = document.getElementById('returnBillSearch').value.trim();
    if (!term) return;
    var digits = term.replace(/\D/g, '').replace(/^0+/, '');
    var low = term.toLowerCase();
    var bill = null;
    for (var i = 0; i < bills.length; i++) {
        var b = bills[i];
        if (digits && billDigits(b).indexOf(digits) >= 0) { bill = b; break; }
        if ((b.billNumber || b.orderNumber || '').toString().toLowerCase() === low) { bill = b; break; }
    }
    if (!bill) { showAlert('لم يتم العثور على فاتورة مطابقة', { icon: '⚠️', title: 'غير موجودة' }); return; }
    returnSourceBill = bill;
    returnReplaceCart = [];
    buildReturnEditor(bill);
}
function buildReturnEditor(bill) {
    var editor = document.getElementById('returnEditor');
    var dateStr = billTimeMs(bill) ? new Date(billTimeMs(bill)).toLocaleString('ar-EG') : '';
    var html = '';
    html += '<div class="return-head">فاتورة بتاريخ ' + dateStr + ' — الإجمالي الأصلي \u20AA' + (bill.total || 0).toFixed(2) + '</div>';
    html += '<h4>الأصناف المرتجعة (اختر الكمية)</h4>';
    html += '<table class="data-table"><thead><tr><th>الصنف</th><th>السعر</th><th>المُباع</th><th>المرتجع</th></tr></thead><tbody>';
    var items = bill.items || [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var variant = (it.color || it.size) ? ' (' + (it.color || '') + '/' + (it.size || '') + ')' : '';
        html += '<tr><td>' + escapeHtml((it.name || '') + variant) + '</td><td>\u20AA' + (it.price || 0).toFixed(2) +
            '</td><td>' + (it.qty || 0) + '</td><td><input type="number" class="ret-qty" data-idx="' + i +
            '" min="0" max="' + (it.qty || 0) + '" value="0" style="width:70px;"></td></tr>';
    }
    html += '</tbody></table>';
    html += '<h4>أصناف بديلة (استبدال) — اختياري</h4>';
    html += '<div class="form-actions"><button class="btn-secondary" id="returnReplaceAddBtn">➕ إضافة صنف بديل (تصنيفات / بحث / باركود)</button></div>';
    html += '<div id="returnReplaceList"></div>';
    html += '<div class="return-summary" id="returnSummary"></div>';
    html += '<div class="form-group full-width" id="returnMethodGroup"><label id="returnMethodLabel">طريقة التسوية</label><select id="returnMethod"></select></div>';
    html += '<div class="form-actions"><button class="btn-primary" id="saveReturnBtn">تنفيذ المرتجع/الاستبدال</button><button class="btn-secondary" id="cancelReturnBtn">إلغاء</button></div>';
    editor.innerHTML = html;
    editor.style.display = 'block';
    _returnPayMode = null;
    renderReturnReplaceCart();

    var qtyInputs = editor.querySelectorAll('.ret-qty');
    for (var q = 0; q < qtyInputs.length; q++) qtyInputs[q].addEventListener('input', recomputeReturnSummary);
    document.getElementById('returnReplaceAddBtn').addEventListener('click', function () {
        openCategoryModal(null, 'return', true);
    });
    document.getElementById('saveReturnBtn').addEventListener('click', saveReturn);
    document.getElementById('cancelReturnBtn').addEventListener('click', function () {
        editor.style.display = 'none'; editor.innerHTML = ''; returnSourceBill = null; returnReplaceCart = [];
    });
    recomputeReturnSummary();
}
function renderReturnReplaceCart() {
    var el = document.getElementById('returnReplaceList');
    if (!el) return;
    var html = '';
    for (var i = 0; i < returnReplaceCart.length; i++) {
        var it = returnReplaceCart[i];
        html += '<div class="ret-replace-row"><span>' + escapeHtml(it.name + ' (' + it.color + '/' + it.size + ')') +
            '</span><span>\u20AA' + it.price.toFixed(2) + ' × ' + it.qty + '</span>' +
            '<button class="cart-item-remove" aria-label="حذف" onclick="removeReplacement(\'' + escapeHtml(it.key) + '\')">\u2715</button></div>';
    }
    el.innerHTML = html;
    recomputeReturnSummary();
}
function removeReplacement(key) {
    returnReplaceCart = returnReplaceCart.filter(function (c) { return c.key !== key; });
    renderReturnReplaceCart();
}
function computeReturnNumbers() {
    var refund = 0, returned = [];
    var editor = document.getElementById('returnEditor');
    if (editor && returnSourceBill) {
        var qtyInputs = editor.querySelectorAll('.ret-qty');
        var items = returnSourceBill.items || [];
        for (var q = 0; q < qtyInputs.length; q++) {
            var idx = parseInt(qtyInputs[q].getAttribute('data-idx'), 10);
            var rq = parseInt(qtyInputs[q].value, 10) || 0;
            if (rq > 0 && items[idx]) {
                var it = items[idx];
                rq = Math.min(rq, it.qty || 0);
                refund += (it.price || 0) * rq;
                returned.push({ productId: it.productId, name: it.name, color: it.color, size: it.size, price: it.price, qty: rq, total: (it.price || 0) * rq });
            }
        }
    }
    var added = 0;
    for (var i = 0; i < returnReplaceCart.length; i++) added += returnReplaceCart[i].price * returnReplaceCart[i].qty;
    return { refund: refund, added: added, net: added - refund, returned: returned };
}
var _returnPayMode = null;
// Settlement options depend on direction: customer pays (cash/visa/delayed) vs refund (cash/delayed).
function updateReturnMethodOptions(net) {
    var mode = net > 0.0001 ? 'pay' : (net < -0.0001 ? 'refund' : 'none');
    if (mode === _returnPayMode) return;
    _returnPayMode = mode;
    var grp = document.getElementById('returnMethodGroup');
    var sel = document.getElementById('returnMethod');
    var lbl = document.getElementById('returnMethodLabel');
    if (!grp || !sel) return;
    if (mode === 'none') { grp.style.display = 'none'; sel.innerHTML = '<option value="cash">نقدي</option>'; return; }
    grp.style.display = 'block';
    if (mode === 'pay') {
        lbl.textContent = 'طريقة دفع العميل للفرق';
        sel.innerHTML = '<option value="cash">نقدي</option><option value="card">فيزا / بطاقة</option><option value="delayed">مؤجل (ذمة على العميل)</option>';
    } else {
        lbl.textContent = 'طريقة إرجاع المبلغ للعميل';
        sel.innerHTML = '<option value="cash">نقدي</option><option value="delayed">مؤجل (رصيد للعميل)</option>';
    }
}
function recomputeReturnSummary() {
    var el = document.getElementById('returnSummary');
    if (!el) return;
    var n = computeReturnNumbers();
    var html = '';
    html += '<div class="cd-row"><span>قيمة المرتجع</span><span>\u20AA' + n.refund.toFixed(2) + '</span></div>';
    html += '<div class="cd-row"><span>قيمة البديل</span><span>\u20AA' + n.added.toFixed(2) + '</span></div>';
    if (n.net >= 0) html += '<div class="cd-row cd-total"><span>يدفع العميل</span><span class="pay-customer">\u20AA' + n.net.toFixed(2) + '</span></div>';
    else html += '<div class="cd-row cd-total"><span>يُرد للعميل</span><span class="refund-customer">\u20AA' + Math.abs(n.net).toFixed(2) + '</span></div>';
    el.innerHTML = html;
    updateReturnMethodOptions(n.net);
}
function saveReturn() {
    var n = computeReturnNumbers();
    if (n.returned.length === 0 && returnReplaceCart.length === 0) {
        showAlert('اختر صنفاً مرتجعاً واحداً على الأقل', { icon: '⚠️', title: 'تنبيه' }); return;
    }
    var method = document.getElementById('returnMethod').value;
    var direction = n.net > 0.0001 ? 'pay' : (n.net < -0.0001 ? 'refund' : 'none');

    // Delayed settlement must be tied to a customer (debt on the customer, or a
    // deferred refund/credit owed to them). Ask the cashier to pick/add a client.
    if (method === 'delayed' && direction !== 'none') {
        var title = direction === 'pay' ? 'العميل صاحب الذمة (مؤجل)' : 'العميل صاحب الرصيد المؤجل';
        openCustomerModal(title, function (cust) {
            performReturn(n, method, direction, cust);
        });
        // Prefill with the bill's customer when available (cashier can still change it).
        var bc = returnSourceBill && returnSourceBill.customer;
        if (bc) {
            var nameEl = document.getElementById('customerName');
            var phoneEl = document.getElementById('customerPhone');
            if (nameEl) nameEl.value = bc.name || '';
            if (phoneEl) phoneEl.value = bc.phone || '';
        }
        return;
    }
    performReturn(n, method, direction, null);
}
function performReturn(n, method, direction, debtCustomer) {
    var btn = document.getElementById('saveReturnBtn');
    btn.disabled = true; btn.textContent = 'جاري التنفيذ...';

    var addedItems = returnReplaceCart.map(function (it) {
        return { productId: it.productId, name: it.name, color: it.color, size: it.size, price: it.price, qty: it.qty, total: it.price * it.qty };
    });

    // Build one combined signed-delta list so an exchange of the SAME product/variant
    // (return + replacement) is written atomically without overwriting itself.
    var deltas = [];
    for (var ri = 0; ri < n.returned.length; ri++) {
        deltas.push({ productId: n.returned[ri].productId, color: n.returned[ri].color, size: n.returned[ri].size, delta: +(n.returned[ri].qty || 0) });
    }
    for (var ai = 0; ai < addedItems.length; ai++) {
        deltas.push({ productId: addedItems[ai].productId, color: addedItems[ai].color, size: addedItems[ai].size, delta: -(addedItems[ai].qty || 0) });
    }

    var settleCustomer = debtCustomer || (returnSourceBill && returnSourceBill.customer ? returnSourceBill.customer : null);

    applyCombinedStockDeltas(deltas)
        .then(function () {
            var rec = {
                recordType: 'return',
                originalBill: returnSourceBill ? (returnSourceBill.billNumber || returnSourceBill.id) : null,
                returnedItems: n.returned, addedItems: addedItems,
                refund: n.refund, added: n.added, net: n.net,
                paymentMethod: method, settlementDirection: direction, total: n.net,
                customer: settleCustomer || null,
                cashier: currentUser ? currentUser.username : ''
            };
            savePosRecord(rec, 'RT', function () {
                btn.disabled = false; btn.textContent = 'تنفيذ المرتجع/الاستبدال';
                logActivity('return', 'مرتجع للفاتورة ' + (rec.originalBill || '') + ' صافي \u20AA' + n.net.toFixed(2) + ' (' + method + ')', { net: n.net, refund: n.refund, added: n.added, originalBill: rec.originalBill, method: method, direction: direction, customer: settleCustomer ? settleCustomer.name : '' });
                // Delayed settlement: customer owes the difference (debt) or is owed a
                // deferred refund (credit = negative debt). Tracked on the chosen client.
                if (method === 'delayed' && settleCustomer && (settleCustomer.name || settleCustomer.phone)) {
                    var amt = direction === 'pay' ? n.net : n.net; // n.net is negative for refunds -> credit
                    var noteTxt = (direction === 'pay' ? 'فرق استبدال (ذمة) للفاتورة ' : 'رصيد مرتجع مؤجل للفاتورة ') + (rec.originalBill || '');
                    savePosRecord({
                        recordType: 'debt-manual', amount: amt, note: noteTxt,
                        customer: { name: settleCustomer.name || '', phone: settleCustomer.phone || '' },
                        cashier: currentUser ? currentUser.username : '', total: 0
                    }, 'DM', function () {}, function () {});
                }
                printReturnReceipt(rec);
                document.getElementById('returnEditor').style.display = 'none';
                document.getElementById('returnEditor').innerHTML = '';
                document.getElementById('returnBillSearch').value = '';
                returnSourceBill = null; returnReplaceCart = [];
                showAlert('تم تنفيذ المرتجع بنجاح', { icon: '✅', title: 'تم' });
            }, function (e) {
                btn.disabled = false; btn.textContent = 'تنفيذ المرتجع/الاستبدال';
                showAlert('تعذر حفظ المرتجع: ' + (e && e.message), { icon: '⚠️', title: 'خطأ' });
            });
        })
        .catch(function (e) {
            btn.disabled = false; btn.textContent = 'تنفيذ المرتجع/الاستبدال';
            showAlert('تعذر تعديل المخزون: ' + (e && e.message), { icon: '⚠️', title: 'خطأ' });
        });
}
function renderReturnsHistory() {
    var body = document.getElementById('returnsBody');
    if (!body) return;
    var html = '';
    for (var i = 0; i < returnRecords.length; i++) {
        var r = returnRecords[i];
        var t = billTimeMs(r) ? new Date(billTimeMs(r)).toLocaleString('ar-EG') : '';
        var netLabel = (r.net >= 0 ? '\u20AA' + (r.net || 0).toFixed(2) : '-\u20AA' + Math.abs(r.net || 0).toFixed(2));
        html += '<tr><td>' + t + '</td><td>' + escapeHtml(r.originalBill || '-') + '</td><td>\u20AA' + (r.refund || 0).toFixed(2) +
            '</td><td>\u20AA' + (r.added || 0).toFixed(2) + '</td><td>' + netLabel + '</td><td>' + escapeHtml(r.cashier || '-') + '</td></tr>';
    }
    body.innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:16px;">لا توجد مرتجعات</td></tr>';
}
function printReturnReceipt(rec) {
    var html = '';
    html += '<div class="r-title">عقاد كيدز</div>';
    html += '<div class="r-meta">إيصال مرتجع / استبدال</div>';
    html += '<div class="r-meta">' + new Date().toLocaleString('ar-EG') + '</div>';
    if (rec.originalBill) html += '<div class="r-meta">الفاتورة الأصلية مرفقة بالباركود</div>';
    html += '<table class="r-items"><thead><tr><th>الصنف</th><th>كمية</th><th>السعر</th></tr></thead><tbody>';
    for (var i = 0; i < (rec.returnedItems || []).length; i++) {
        var it = rec.returnedItems[i];
        html += '<tr><td class="r-name">مرتجع: ' + escapeHtml(it.name || '') + '</td><td>' + it.qty + '</td><td>-\u20AA' + (it.total || 0).toFixed(2) + '</td></tr>';
    }
    for (var i = 0; i < (rec.addedItems || []).length; i++) {
        var it2 = rec.addedItems[i];
        html += '<tr><td class="r-name">بديل: ' + escapeHtml(it2.name || '') + '</td><td>' + it2.qty + '</td><td>\u20AA' + (it2.total || 0).toFixed(2) + '</td></tr>';
    }
    html += '</tbody></table>';
    html += '<table class="r-totals">';
    html += '<tr><td>قيمة المرتجع</td><td>-\u20AA' + (rec.refund || 0).toFixed(2) + '</td></tr>';
    html += '<tr><td>قيمة البديل</td><td>\u20AA' + (rec.added || 0).toFixed(2) + '</td></tr>';
    if (rec.net >= 0) html += '<tr class="r-grand"><td>دفع العميل</td><td>\u20AA' + (rec.net || 0).toFixed(2) + '</td></tr>';
    else html += '<tr class="r-grand"><td>المُرد للعميل</td><td>\u20AA' + Math.abs(rec.net || 0).toFixed(2) + '</td></tr>';
    html += '</table>';
    var methodLabel = rec.paymentMethod === 'card' ? 'فيزا / بطاقة' : (rec.paymentMethod === 'delayed' ? 'مؤجل' : 'نقدي');
    if (rec.net !== 0) html += '<div class="r-meta">طريقة التسوية: ' + methodLabel + '</div>';
    if (rec.originalBill) {
        var bc = code128cSVG((rec.originalBill || '').toString().replace(/\D/g, ''));
        if (bc) html += '<div class="r-barcode">' + bc + '</div>';
    }
    html += '<div class="r-thanks">شكراً لتعاملكم معنا</div>';
    var doc = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>' +
        RECEIPT_PRINT_CSS + '</style></head><body><div class="receipt">' + html + '</div></body></html>';
    try { if (ipcRenderer && ipcRenderer.invoke) ipcRenderer.invoke('print-html', doc).catch(function () {}); } catch (e) {}
}

// ============ HELD / PARKED SALES ============
function heldKey() { return 'ada_pos_held_' + (getProjectId() || ''); }
function loadHeldSales() {
    try { heldSales = JSON.parse(localStorage.getItem(heldKey()) || '[]'); } catch (e) { heldSales = []; }
    updateHeldUI();
}
function saveHeldSales() {
    try { localStorage.setItem(heldKey(), JSON.stringify(heldSales)); } catch (e) {}
    updateHeldUI();
}
function updateHeldUI() {
    var resumeBtn = document.getElementById('resumeSaleBtn');
    var countEl = document.getElementById('heldCount');
    if (countEl) countEl.textContent = heldSales.length;
    if (resumeBtn) resumeBtn.style.display = heldSales.length ? 'inline-flex' : 'none';
}
function holdSale() {
    if (cart.length === 0) { showAlert('السلة فارغة', { icon: '⚠️', title: 'تنبيه' }); return; }
    var note = (document.getElementById('billNote') || {}).value || '';
    heldSales.push({ at: Date.now(), cart: JSON.parse(JSON.stringify(cart)), note: note });
    saveHeldSales();
    cart = []; renderCart();
    var bn = document.getElementById('billNote'); if (bn) bn.value = '';
    showAlert('تم تعليق الفاتورة', { icon: '⏸️', title: 'تم' });
}
function openHeldModal() {
    var body = document.getElementById('heldBody');
    var html = '';
    if (!heldSales.length) html = '<p style="text-align:center;padding:16px;">لا توجد فواتير معلقة</p>';
    for (var i = 0; i < heldSales.length; i++) {
        var h = heldSales[i];
        var n = 0, sum = 0;
        for (var j = 0; j < h.cart.length; j++) { n += h.cart[j].qty; sum += h.cart[j].price * h.cart[j].qty; }
        html += '<div class="held-row"><span>' + new Date(h.at).toLocaleString('ar-EG') + ' — ' + n + ' قطعة — \u20AA' + sum.toFixed(2) + '</span>' +
            '<span><button class="btn-primary" onclick="resumeHeld(' + i + ')">استئناف</button> ' +
            '<button class="btn-secondary" onclick="deleteHeld(' + i + ')">حذف</button></span></div>';
    }
    body.innerHTML = html;
    openModal('heldModal');
}
function resumeHeld(i) {
    var h = heldSales[i];
    if (!h) return;
    if (cart.length) { for (var j = 0; j < h.cart.length; j++) cart.push(h.cart[j]); }
    else cart = h.cart;
    var bn = document.getElementById('billNote'); if (bn && h.note) bn.value = h.note;
    heldSales.splice(i, 1);
    saveHeldSales();
    renderCart();
    closeModal('heldModal');
    switchPage('sales');
}
function deleteHeld(i) {
    heldSales.splice(i, 1);
    saveHeldSales();
    openHeldModal();
}

// ============ GLOBAL FUNCTIONS ============
window.changeCartQty = changeCartQty;
window.removeCartItem = removeCartItem;
window.viewBill = viewBill;
window.toggleInvRow = toggleInvRow;
window.openSettleDebt = openSettleDebt;
window.removeReplacement = removeReplacement;
window.resumeHeld = resumeHeld;
window.deleteHeld = deleteHeld;

// ============ START ============
document.addEventListener('DOMContentLoaded', function () {
    checkLicense();
    var loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.addEventListener('click', attemptLogin);
    var passField = document.getElementById('loginPassword');
    if (passField) passField.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') attemptLogin();
    });
});
