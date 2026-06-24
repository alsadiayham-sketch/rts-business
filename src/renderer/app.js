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
var APP_VERSION = '1.2.0';

// ============ STATE ============
var products = [];
var cart = [];
var bills = [];
var damageRecords = [];
var selectedPayment = 'cash';
var currentPage = 'sales';
var currentUser = null;
var licenseValid = false;

var varModalProduct = null;
var varModalColor = null;
var varModalSize = null;
var currentReceiptBill = null;

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
    document.getElementById('updateDownloadBtn').onclick = function () {
        electron.shell.openExternal(url);
    };
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
    document.getElementById('updateDownloadBtn').onclick = function () {
        electron.shell.openExternal(url);
    };
    document.getElementById('updateDismissBtn').style.display = 'none';
    document.getElementById('updateForceMsg').style.display = 'block';
    overlay.style.display = 'flex';
    // Block the app
    document.getElementById('appContainer').style.display = 'none';
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
    // Load first batch of products fast, then subscribe to rest
    loadProductsBatch();
    subscribeBills();
    subscribeDamage();
}

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

// POS (register) sales since the last day-close on this terminal.
function computeShiftSummary() {
    var start = getDayStart();
    var cash = 0, card = 0, count = 0;
    for (var i = 0; i < bills.length; i++) {
        var b = bills[i];
        if (b.source !== 'pos') continue;
        if (billTimeMs(b) < start) continue;
        var t = b.total || 0;
        if (b.paymentMethod === 'card') card += t; else cash += t;
        count++;
    }
    return { cash: cash, card: card, total: cash + card, count: count, since: start };
}

function openCloseDayModal() {
    if (!isAdmin()) { alert('هذه الميزة متاحة للمدير فقط'); return; }
    var s = computeShiftSummary();
    var sinceStr = new Date(s.since).toLocaleString('ar-EG');
    var html = '';
    html += '<p class="cd-since">منذ آخر إغلاق: ' + sinceStr + '</p>';
    html += '<div class="cd-row"><span>مبيعات نقدي 💵</span><span>\u20AA' + s.cash.toFixed(2) + '</span></div>';
    html += '<div class="cd-row"><span>مبيعات بطاقة 💳</span><span>\u20AA' + s.card.toFixed(2) + '</span></div>';
    html += '<div class="cd-row cd-total"><span>الإجمالي</span><span>\u20AA' + s.total.toFixed(2) + '</span></div>';
    html += '<div class="cd-row"><span>عدد الفواتير</span><span>' + s.count + '</span></div>';
    html += '<p class="cd-note">⚠️ قارن المبلغ النقدي (\u20AA' + s.cash.toFixed(2) + ') مع ما في الصندوق قبل التأكيد.</p>';
    document.getElementById('closeDaySummary').innerHTML = html;
    document.getElementById('closeDayModal').style.display = 'flex';
}

function confirmCloseDay() {
    if (!isAdmin()) return;
    var s = computeShiftSummary();
    setDayStart(Date.now());
    logActivity('day_close', 'إغلاق اليوم — نقدي: \u20AA' + s.cash.toFixed(2) + ' | بطاقة: \u20AA' + s.card.toFixed(2) + ' | الإجمالي: \u20AA' + s.total.toFixed(2), {
        cash: s.cash, card: s.card, total: s.total, count: s.count
    });
    document.getElementById('closeDayModal').style.display = 'none';
    updateReports();
    alert('تم إغلاق اليوم وتصفير الإجمالي ✅');
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
        snapshot.forEach(function (doc) {
            var b = doc.data();
            b.id = doc.id;
            bills.push(b);
        });
        bills.sort(function (a, b) {
            var da = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().getTime() : 0;
            var db2 = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().getTime() : 0;
            return db2 - da;
        });
        renderBills();
        updateReports();
    }, function (err) {
        console.error('Bills subscription error:', err);
    });
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

    var filtered = products.filter(function (p) {
        if (p.status === 'disabled') return false;
        var matchSearch = !searchVal || (p.name || '').toLowerCase().indexOf(searchVal) >= 0 || (p.id + '').indexOf(searchVal) >= 0;
        var matchCat = !catFilter || p.type === catFilter;
        return matchSearch && matchCat;
    });

    // Group products into sections by category/type for easier manual browsing.
    var groups = {}, order = [];
    for (var i = 0; i < filtered.length; i++) {
        var t = filtered[i].type || 'أخرى';
        if (!groups[t]) { groups[t] = []; order.push(t); }
        groups[t].push(filtered[i]);
    }

    var html = '';
    for (var g = 0; g < order.length; g++) {
        var sec = order[g];
        var list = groups[sec];
        html += '<div class="section-header">' + sec + ' <span class="section-count">' + list.length + '</span></div>';
        for (var k = 0; k < list.length; k++) {
            var p = list[k];
            var totalStock = getTotalStock(p);
            var outClass = totalStock <= 0 ? ' out-of-stock' : '';
            var img = p.image || '';
            html += '<div class="product-card' + outClass + '" data-id="' + p.id + '">';
            if (img) html += '<img src="' + img + '" onerror="this.style.display=\'none\'" loading="lazy">';
            html += '<div class="p-name">' + (p.name || '') + '</div>';
            html += '<div class="p-code">#' + p.id + '</div>';
            html += '<div class="p-price">\u20AA' + getMinPrice(p) + '</div>';
            html += '<div class="p-stock">' + totalStock + ' قطعة</div>';
            html += '</div>';
        }
    }

    grid.innerHTML = html || '<div style="text-align:center;color:var(--text-dim);padding:40px;grid-column:1/-1;">لا توجد منتجات</div>';
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
function openVariantModal(productId) {
    var product = products.find(function (p) { return p.id === productId; });
    if (!product) return;
    varModalProduct = product;
    varModalColor = null;
    varModalSize = null;
    document.getElementById('variantModalTitle').textContent = product.name;
    document.getElementById('varQtyInput').value = 1;
    renderVariantColors();
    renderVariantSizes();
    document.getElementById('varStockInfo').textContent = '';
    document.getElementById('variantModal').style.display = 'flex';
}

function renderVariantColors() {
    var colors = varModalProduct.colors || [];
    var html = '';
    for (var i = 0; i < colors.length; i++) {
        var c = colors[i];
        var hasStock = hasColorStock(varModalProduct, c.name);
        var selClass = varModalColor === c.name ? ' selected' : '';
        var disClass = !hasStock ? ' disabled' : '';
        html += '<div class="color-option' + selClass + disClass + '" data-color="' + c.name + '" style="background:' + (c.hex || '#ccc') + '" title="' + c.name + '"></div>';
    }
    document.getElementById('variantColors').innerHTML = html;
}

function renderVariantSizes() {
    if (!varModalColor) {
        document.getElementById('variantSizes').innerHTML = '<span style="color:var(--text-dim)">اختر اللون أولاً</span>';
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
        html += '<div class="size-option' + selClass + disClass + '" data-size="' + v.size + '">' + v.size + '</div>';
    }
    document.getElementById('variantSizes').innerHTML = html || '<span style="color:var(--text-dim)">لا توجد مقاسات</span>';
    updateStockInfo();
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
        html += '<div class="cart-item" data-key="' + item.key + '">';
        html += '<div class="cart-item-info">';
        html += '<div class="cart-item-name">' + item.name + '</div>';
        html += '<div class="cart-item-variant">' + item.color + ' - ' + item.size + '</div>';
        html += '<div class="cart-item-price">\u20AA' + item.price + '</div>';
        html += '</div>';
        html += '<div class="cart-item-qty">';
        html += '<button onclick="changeCartQty(\'' + item.key + '\', -1)">-</button>';
        html += '<span>' + item.qty + '</span>';
        html += '<button onclick="changeCartQty(\'' + item.key + '\', 1)">+</button>';
        html += '</div>';
        html += '<button class="cart-item-remove" onclick="removeCartItem(\'' + item.key + '\')">\u2715</button>';
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
function checkout() {
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
        cashier: currentUser ? (currentUser.displayName || currentUser.username) : 'unknown',
        source: 'pos',
        status: 'completed',
        createdAt: serverTimestamp(),
        createdAtIso: new Date().toISOString()
    };

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
    '* { margin:0; padding:0; box-sizing:border-box; }' +
    'body { font-family:"Courier New",monospace; color:#000; background:#fff; }' +
    '.receipt { width:80mm; padding:4mm 3mm; color:#000; font-weight:bold; }' +
    '.r-title { text-align:center; font-size:20px; font-weight:bold; margin-bottom:4px; }' +
    '.r-meta { text-align:center; font-size:12px; font-weight:bold; margin-bottom:2px; }' +
    '.r-items { width:100%; border-collapse:collapse; margin:8px 0; }' +
    '.r-items th { background:#000; color:#fff; font-weight:bold; padding:5px 4px; border:1px solid #000; font-size:12px; }' +
    '.r-items td { padding:5px 4px; border:1px solid #000; font-weight:bold; font-size:12px; text-align:center; }' +
    '.r-items td.r-name { text-align:right; }' +
    '.r-totals { width:100%; border-collapse:collapse; margin-top:6px; }' +
    '.r-totals td { padding:3px 4px; font-weight:bold; font-size:13px; }' +
    '.r-totals td:last-child { text-align:left; }' +
    '.r-totals tr.r-grand td { border-top:2px solid #000; border-bottom:2px solid #000; font-size:16px; padding:6px 4px; }' +
    '.r-thanks { text-align:center; font-weight:bold; margin-top:10px; font-size:13px; }';

function buildReceiptInnerHTML(bill) {
    var dateStr = (bill.createdAt && bill.createdAt.toDate)
        ? bill.createdAt.toDate().toLocaleString('ar-EG')
        : (bill.createdAtIso ? new Date(bill.createdAtIso).toLocaleString('ar-EG') : new Date().toLocaleString('ar-EG'));
    var html = '';
    html += '<div class="r-title">عقاد كيدز</div>';
    html += '<div class="r-meta">فاتورة رقم: ' + (bill.billNumber || bill.orderNumber || '') + '</div>';
    html += '<div class="r-meta">' + dateStr + '</div>';
    html += '<div class="r-meta">الكاشير: ' + (bill.cashier || '') + '</div>';

    html += '<table class="r-items"><thead><tr><th>الصنف</th><th>كمية</th><th>السعر</th></tr></thead><tbody>';
    var items = bill.items || [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var variant = (it.color || it.size) ? ' (' + (it.color || '') + '/' + (it.size || '') + ')' : '';
        var lineTotal = (it.total != null ? it.total : (it.price || 0) * (it.qty || 0));
        html += '<tr>';
        html += '<td class="r-name">' + (it.name || '') + variant + '</td>';
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
    html += '<tr><td>الدفع</td><td>' + (bill.paymentMethod === 'cash' ? 'نقدي' : 'بطاقة') + '</td></tr>';
    html += '</table>';
    html += '<div class="r-thanks">شكراً لتسوقكم</div>';
    return html;
}

function showReceipt(bill) {
    currentReceiptBill = bill;
    document.getElementById('receiptContent').innerHTML = buildReceiptInnerHTML(bill);
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
        html += '<tr class="inv-master" onclick="toggleInvRow(\'' + rowId + '\')">';
        html += '<td><span class="inv-caret" id="caret_' + rowId + '">\u25B8</span> ' + p.id + '</td>';
        html += '<td>' + (p.name || '') + '</td>';
        html += '<td>' + variants.length + ' خيار</td>';
        html += '<td>' + totalStock + ' قطعة</td>';
        html += '<td>' + priceLabel + '</td>';
        html += '<td>' + statusBadge + '</td>';
        html += '</tr>';

        html += '<tr class="inv-detail" id="' + rowId + '" style="display:none;"><td colspan="6">';
        html += '<table class="inv-sub"><thead><tr><th>اللون</th><th>المقاس</th><th>الكمية</th><th>السعر</th><th>الحالة</th></tr></thead><tbody>';
        for (var j = 0; j < variants.length; j++) {
            var v = variants[j];
            var vBadge;
            if ((v.stock || 0) <= 0) vBadge = '<span class="badge badge-danger">نفذ</span>';
            else if ((v.stock || 0) <= 5) vBadge = '<span class="badge badge-warning">منخفض</span>';
            else vBadge = '<span class="badge badge-success">متوفر</span>';
            html += '<tr>';
            html += '<td>' + (v.color || '') + '</td>';
            html += '<td>' + (v.size || '') + '</td>';
            html += '<td>' + (v.stock || 0) + '</td>';
            html += '<td>\u20AA' + (v.price || 0) + '</td>';
            html += '<td>' + vBadge + '</td>';
            html += '</tr>';
        }
        if (!variants.length) html += '<tr><td colspan="5" style="text-align:center;">لا توجد خيارات</td></tr>';
        html += '</tbody></table></td></tr>';
    }

    body.innerHTML = html || '<tr><td colspan="6" style="text-align:center;padding:20px;">لا توجد بيانات</td></tr>';
}

function toggleInvRow(rowId) {
    var detail = document.getElementById(rowId);
    var caret = document.getElementById('caret_' + rowId);
    if (!detail) return;
    var open = detail.style.display !== 'none';
    detail.style.display = open ? 'none' : 'table-row';
    if (caret) caret.textContent = open ? '\u25B8' : '\u25BE';
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
        html += '<option value="' + products[i].id + '">' + products[i].name + ' (' + products[i].id + ')</option>';
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
        html += '<option value="' + colors[i].name + '">' + colors[i].name + '</option>';
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
            html += '<option value="' + variants[i].size + '">' + variants[i].size + ' (حالي: ' + (variants[i].stock || 0) + ')</option>';
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
        html += '<td>' + (d.productName || '') + '</td>';
        html += '<td>' + (d.color || '') + '</td>';
        html += '<td>' + (d.size || '') + '</td>';
        html += '<td>' + (d.qty || 0) + '</td>';
        html += '<td>' + (d.reason || '') + '</td>';
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
        html += '<option value="' + products[i].id + '">' + products[i].name + ' (' + products[i].id + ')</option>';
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
        html += '<option value="' + colors[i].name + '">' + colors[i].name + '</option>';
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
            html += '<option value="' + variants[i].size + '">' + variants[i].size + ' (متوفر: ' + (variants[i].stock || 0) + ')</option>';
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

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var b = filtered[i];
        var date = b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().toLocaleString('ar-EG') : (b.createdAtIso ? new Date(b.createdAtIso).toLocaleString('ar-EG') : '');
        var itemCount = (b.items || []).length;
        var sourceLabel = b.source === 'pos' ? 'المتجر' : 'الموقع';
        html += '<tr>';
        html += '<td>' + (b.billNumber || b.orderNumber || '') + '</td>';
        html += '<td>' + date + '</td>';
        html += '<td>' + sourceLabel + '</td>';
        html += '<td>' + itemCount + '</td>';
        html += '<td>\u20AA' + (b.total || b.totalBase || 0).toFixed(2) + '</td>';
        html += '<td>' + (b.paymentMethod === 'cash' ? 'نقدي' : b.paymentMethod === 'card' ? 'بطاقة' : (b.paymentLabel || b.paymentMethod || '-')) + '</td>';
        html += '<td>' + (b.cashier || b.customerName || '-') + '</td>';
        html += '<td><button class="btn-secondary" onclick="viewBill(\'' + (b.billNumber || b.orderNumber || b.id) + '\')">عرض</button></td>';
        html += '</tr>';
    }

    body.innerHTML = html || '<tr><td colspan="8" style="text-align:center;padding:20px;">لا توجد فواتير</td></tr>';
}

function viewBill(billNumber) {
    var bill = bills.find(function (b) { return (b.billNumber || b.orderNumber || b.id) === billNumber; });
    if (bill) showReceipt(bill);
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
        topHtml += '<tr><td>' + name + '</td><td>' + productSales[name].qty + '</td><td>\u20AA' + productSales[name].revenue.toFixed(2) + '</td></tr>';
    }
    document.getElementById('topProductsBody').innerHTML = topHtml || '<tr><td colspan="3" style="text-align:center;">لا توجد بيانات</td></tr>';
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
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
    var navBtns = document.querySelectorAll('.nav-btn');
    for (var i = 0; i < navBtns.length; i++) {
        navBtns[i].addEventListener('click', function () {
            switchPage(this.getAttribute('data-page'));
        });
    }

    document.getElementById('productSearch').addEventListener('input', renderProducts);
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
    document.getElementById('discountInput').addEventListener('input', updateTotals);
    document.getElementById('discountType').addEventListener('change', updateTotals);

    var payBtns = document.querySelectorAll('.pay-btn');
    for (var i = 0; i < payBtns.length; i++) {
        payBtns[i].addEventListener('click', function () {
            for (var j = 0; j < payBtns.length; j++) payBtns[j].classList.remove('active');
            this.classList.add('active');
            selectedPayment = this.getAttribute('data-method');
        });
    }

    document.getElementById('checkoutBtn').addEventListener('click', checkout);
    document.getElementById('printReceiptBtn').addEventListener('click', function () {
        if (currentReceiptBill) printReceipt(currentReceiptBill); else window.print();
    });
    document.getElementById('closeReceiptBtn').addEventListener('click', function () {
        document.getElementById('receiptModal').style.display = 'none';
    });

    if (document.getElementById('inventorySearch')) {
        document.getElementById('inventorySearch').addEventListener('input', renderInventory);
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
}

// ============ GLOBAL FUNCTIONS ============
window.changeCartQty = changeCartQty;
window.removeCartItem = removeCartItem;
window.viewBill = viewBill;
window.toggleInvRow = toggleInvRow;

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
