const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const root = path.resolve(__dirname, '..', '..');
let win;
const profile = process.env.RTS_FIXTURE_PROFILE;
if (!profile) throw new Error('Run using npm run test:restaurant-ui so the isolated profile is cleaned up.');
app.setPath('userData', profile);
app.disableHardwareAcceleration();
const watchdog = setTimeout(() => { console.error('Restaurant renderer test timed out.'); app.exit(1); }, 75000);
async function evaluate(code) {
    return win.webContents.executeJavaScript(code, true);
}
async function waitFor(code) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await evaluate(code)) return;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Timed out waiting for: ' + code);
}
async function screenshot(name, width, height) {
    if (!process.env.RTS_FIXTURE_ARTIFACTS) return;
    win.setSize(width, height);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    if (name.startsWith('restaurant-pos-')) {
        assert.equal(await evaluate('document.getElementById("checkoutBtn").getBoundingClientRect().bottom <= innerHeight'), true, 'Checkout must remain visible.');
    }
    const image = await win.webContents.capturePage();
    await fs.mkdir(process.env.RTS_FIXTURE_ARTIFACTS, { recursive: true });
    await fs.writeFile(path.join(process.env.RTS_FIXTURE_ARTIFACTS, name + '.png'), image.toPNG());
}
app.whenReady().then(async () => {
    try {
        const isolated = session.fromPartition(`restaurant-fixture-${Date.now()}`);
        isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
        await isolated.protocol.handle('file', async request => {
            const file = fileURLToPath(request.url);
            if (path.basename(file) === 'firebase-config.js') return new Response('// Isolated fixture uses an in-memory adapter.');
            const bytes = await fs.readFile(file);
            const contentType = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' :
                file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'application/octet-stream';
            return new Response(bytes, { headers: { 'Content-Type': contentType } });
        });
        win = new BrowserWindow({
            show: false, width: 1440, height: 1000,
            webPreferences: {
                session: isolated, nodeIntegration: true, contextIsolation: false, sandbox: false,
                webSecurity: true, backgroundThrottling: false,
                preload: path.join(__dirname, 'fixture-preload.cjs'),
            },
        });
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('console-message', event => {
            if (event.level === 'error' || event.level === 3) console.error('Renderer:', event.message);
        });
        await win.loadFile(path.join(root, 'src', 'renderer', 'index.html'));
        await evaluate(`
            resetStoreState();
            currentUser = { username: 'fixture-admin', role: 'admin' };
            licenseValid = true; licensedBusinessType = 'restaurant';
            storeConfig = { features: {}, restaurantMenuSections: [{ id: 'mains', name: 'وجبات', order: 0 }] };
            products = [
                { id: 'burger', name: 'برغر تجريبي', category: 'وجبات', type: 'وجبات', variants: [{ color: 'افتراضي', size: 'قياسية', price: 25, cost: 8, stock: 10 }] },
                { id: 'hummus', name: 'صحن حمص', category: 'وجبات', type: 'وجبات', variants: [
                    { color: 'افتراضي', size: 'صغير', price: 10, cost: 2, stock: 10 },
                    { color: 'افتراضي', size: 'وسط', price: 15, cost: 3, stock: 10 },
                    { color: 'افتراضي', size: 'كبير', price: 20, cost: 4, stock: 10 }
                ] },
                { id: 'grams', name: 'برغر بالوزن', category: 'وجبات', type: 'وجبات', variants: [
                    { color: 'افتراضي', size: '100غ', price: 22, cost: 8, stock: 0 },
                    { color: 'افتراضي', size: '150غ', price: 32, cost: 10, stock: 5 },
                    { color: 'افتراضي', size: '300غ', price: 45, cost: 15, stock: 0 }
                ] }
            ];
            products.forEach(p => __fixture.seed('projects/isolated-restaurant-fixture/products/' + p.id, p));
            localStorage.setItem(tableCountKey(), '6');
            window.fixtureInput = function (id, value, event) {
                var input = document.getElementById(id); input.value = value;
                input.dispatchEvent(new Event(event || 'input', { bubbles: true }));
            };
            window.fixtureDismiss = function () { document.getElementById('confirmYesBtn').click(); };
            ['loadingScreen', 'loginScreen', 'licenseOverlay'].forEach(id => document.getElementById(id).style.display = 'none');
            document.getElementById('appContainer').style.display = 'flex';
            setupEventListeners(); applyBusinessSurface(); renderProducts(); renderCart();
        `);
        assert.equal(await evaluate('document.querySelector(".restaurant-menu-section").open'), false);
        await evaluate(`
            document.querySelector('.restaurant-menu-section summary').click();
            document.querySelector('.restaurant-food-item[data-id="burger"] strong').click();
        `);
        assert.equal(await evaluate('document.querySelector(".restaurant-menu-section").open'), true);
        assert.equal(await evaluate('cart.length'), 1, 'Real food-button click must add an item to the ticket.');
        assert.match(await evaluate('document.getElementById("cartItems").textContent'), /برغر تجريبي/);
        assert.equal(await evaluate('document.getElementById("checkoutBtn").disabled'), false);
        console.log('PASS: section expansion and actual food-button event render a ticket.');

        for (let index = 0; index < 3; index++) {
            await evaluate(`
                document.querySelector('[data-id="hummus"].restaurant-food-item').click();
                document.querySelector('[data-food-choice="${index}"]').click();
                document.getElementById('addToCartFromModal').click();
            `);
        }
        assert.deepEqual(await evaluate('cart.map(item => item.price)'), [25, 10, 15, 20]);
        assert.equal(await evaluate('computeSaleTotals().subtotal'), 70);
        await evaluate(`document.querySelector('[data-cart-action="increase"]').click()`);
        assert.equal(await evaluate('computeSaleTotals().subtotal'), 95);
        await evaluate(`document.querySelector('[data-cart-action="decrease"]').click(); document.querySelector('[data-cart-action="remove"]').click();`);
        assert.equal(await evaluate('computeSaleTotals().subtotal'), 45);
        await evaluate(`document.querySelector('[data-id="grams"].restaurant-food-item').click();`);
        assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-food-choice]")).map(b => b.disabled)'), [true, false, true]);
        assert.equal(await evaluate('document.getElementById("addToCartFromModal").disabled'), true);
        await evaluate(`
            document.querySelector('[data-food-choice="0"]').click();
        `);
        assert.equal(await evaluate('document.getElementById("addToCartFromModal").disabled'), true);
        await evaluate(`
            document.querySelector('[data-food-choice="1"]').click();
            document.getElementById('addToCartFromModal').click();
            var noteInput = document.querySelector('[data-cart-note]');
            noteInput.value = 'بدون بصل <img src=x onerror="window.pwned=1">';
            noteInput.dispatchEvent(new Event('input', { bubbles: true }));
        `);
        assert.equal(await evaluate('computeSaleTotals().subtotal'), 77);
        console.log('PASS: independently priced portions, unavailable sizes, quantities, removals and preparation notes.');

        await evaluate(`
            fixtureInput('restaurantServiceType', 'dinein', 'change');
            document.getElementById('checkoutBtn').click();
        `);
        assert.equal(await evaluate('document.getElementById("restaurantServiceError").hidden'), false);
        await evaluate(`fixtureInput('restaurantServiceType', 'delivery', 'change'); document.getElementById('checkoutBtn').click();`);
        assert.equal(await evaluate('document.getElementById("restaurantServiceError").hidden'), false);
        await evaluate(`
            fixtureInput('restaurantCustomerName', 'عميل تجريبي');
            fixtureInput('restaurantPhone', 'fixture-only');
            fixtureInput('restaurantAddress', 'عنوان تجريبي <b>ليس عنواناً حقيقياً</b>');
            fixtureInput('restaurantDeliveryFee', '-5');
            document.getElementById('checkoutBtn').click();
        `);
        assert.equal(await evaluate('document.getElementById("restaurantServiceError").hidden'), false);
        await evaluate(`
            fixtureInput('restaurantDeliveryFee', '5');
        `);
        for (const service of ['dinein', 'takeaway', 'delivery']) {
            await evaluate(`
                fixtureInput('restaurantServiceType', '${service}', 'change');
                fixtureInput('restaurantTable', '1', 'change');
                fixtureInput('discountType', 'percent', 'change');
                fixtureInput('discountInput', '200');
                document.getElementById('checkoutBtn').click();
            `);
            assert.equal(await evaluate('document.getElementById("restaurantServiceError").hidden'), false, service + ' must reject excessive discounts');
        }
        await evaluate(`
            fixtureInput('discountType', 'fixed', 'change');
            fixtureInput('discountInput', '10');
            storeConfig.features.tax = true; storeConfig.taxPercent = 10;
            fixtureInput('tenderInput', '100');
            fixtureInput('billNote', 'اتصل قبل الوصول');
            updateTotals();
        `);
        assert.equal(await evaluate('computeSaleTotals().total'), 79.2);
        assert.match(await evaluate('document.getElementById("changeDue").textContent'), /20\.80/);
        await evaluate(`document.getElementById('restaurantServiceDetails').open = false; restaurantOrderForSave();`);
        await screenshot('restaurant-pos-desktop', 1440, 1000);
        await screenshot('restaurant-pos-compact', 1024, 700);
        await evaluate(`
            __fixture.delayTransaction = true;
            document.getElementById('checkoutBtn').click();
            fixtureDismiss();
        `);
        await waitFor('typeof __fixture.releaseTransaction === "function"');
        await evaluate(`
            document.querySelector('[data-cart-action="increase"]').click();
            doCheckout();
        `);
        assert.equal(await evaluate('cart[0].qty'), 1);
        await evaluate(`__fixture.delayTransaction = false; __fixture.releaseTransaction();`);
        await waitFor('!checkoutInFlight');
        const sale = await evaluate(`__fixture.writes.find(w => /\\/orders\\/POS-/.test(w.key)).value`);
        assert.equal(sale.total, 79.2);
        assert.equal(sale.deliveryFee, 5);
        assert.equal(sale.restaurantOrder.type, 'delivery');
        assert.equal(sale.change.toFixed(2), '20.80');
        assert.equal(sale.items[0].note, 'بدون بصل <img src=x onerror="window.pwned=1">');
        assert.equal(await evaluate(`__fixture.writes.filter(w => /\\/orders\\/POS-/.test(w.key)).length`), 1);
        assert.equal(await evaluate('cart.length'), 0);
        assert.equal(await evaluate('document.getElementById("checkoutBtn").disabled'), true);
        assert.equal(await evaluate(`__fixture.read('projects/isolated-restaurant-fixture/products/hummus').variants[0].stock`), 9);
        assert.equal(await evaluate(`__fixture.read('projects/isolated-restaurant-fixture/products/grams').variants[1].stock`), 4);
        assert.match(await evaluate('document.getElementById("receiptContent").textContent'), /توصيل.*عميل تجريبي/s);
        assert.equal(await evaluate('document.querySelector("#receiptContent img") === null && !window.pwned'), true);
        assert.match(await evaluate('JSON.stringify(__fixture.prints)'), /اتصل قبل الوصول/);
        assert.match(await evaluate('JSON.stringify(__fixture.prints)'), /التوصيل/);
        console.log('PASS: delivery validation, tax/fee/discount/change agreement, single atomic checkout, escaped receipt and captured print.');

        await evaluate(`
            closeModal('receiptModal');
            storeConfig.features.tax = false;
            document.querySelector('[data-id="burger"].restaurant-food-item').click();
            fixtureInput('restaurantServiceType', 'dinein', 'change');
            fixtureInput('restaurantTable', '2', 'change');
            fixtureInput('discountInput', '3');
            fixtureInput('billNote', 'طلب الطاولة الثاني');
            pendingCustomer = { name: 'عميل الاختبار', phone: 'fixture-customer' };
            pendingRedeem = { points: 2, value: 1 };
            pendingCreditUse = 1;
            document.getElementById('holdSaleBtn').click(); fixtureDismiss();
        `);
        assert.equal(await evaluate('heldSales.length'), 1);
        assert.equal(await evaluate('cart.length'), 0);
        await evaluate(`
            document.querySelector('[data-id="hummus"].restaurant-food-item').click();
            document.querySelector('[data-food-choice="0"]').click();
            document.getElementById('addToCartFromModal').click();
            resumeHeld(0);
        `);
        assert.equal(await evaluate('cart[0].productId'), 'hummus');
        assert.equal(await evaluate('heldSales.length'), 1);
        await evaluate(`
            fixtureDismiss();
            document.getElementById('clearCartBtn').click(); fixtureDismiss();
            document.getElementById('resumeSaleBtn').click();
            document.querySelector('#heldBody .btn-primary').click();
        `);
        assert.equal(await evaluate('cart[0].productId'), 'burger');
        assert.equal(await evaluate('currentTableNo'), 2);
        assert.equal(await evaluate('restaurantDraft().type'), 'dinein');
        assert.equal(await evaluate('pendingCustomer.phone'), 'fixture-customer');
        assert.deepEqual(await evaluate('[pendingRedeem.points, pendingCreditUse, Number(document.getElementById("discountInput").value)]'), [2, 1, 3]);
        await evaluate(`
            openTable(3); fixtureDismiss();
            document.querySelector('[data-cart-action="increase"]').click();
            document.getElementById('holdSaleBtn').click(); fixtureDismiss();
        `);
        assert.equal(await evaluate('heldSales.length'), 1);
        assert.equal(await evaluate('heldSales[0].cart[0].qty'), 2);
        await evaluate(`
            document.querySelector('[data-id="burger"].restaurant-food-item').click();
            var originalSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
                if (key === heldKey()) throw new DOMException('Fixture quota failure', 'QuotaExceededError');
                return originalSetItem.call(this, key, value);
            };
            document.getElementById('holdSaleBtn').click();
            Storage.prototype.setItem = originalSetItem;
            void 0;
        `);
        assert.equal(await evaluate('cart.length'), 1);
        assert.equal(await evaluate('heldSales.length'), 1);
        await evaluate(`
            fixtureDismiss();
            resetRestaurantTicket(); resumeHeld(0);
            document.getElementById('checkoutBtn').click();
        `);
        assert.match(await evaluate('document.getElementById("confirmTitle").textContent'), /الولاء/);
        assert.equal(await evaluate('checkoutInFlight'), false);
        await evaluate(`
            fixtureDismiss();
            pendingRedeem = null; pendingCreditUse = 0;
            __fixture.failNextTransaction = true;
            document.getElementById('checkoutBtn').click(); fixtureDismiss();
        `);
        await waitFor('!checkoutInFlight');
        assert.equal(await evaluate('cart[0].qty'), 2);
        assert.equal(await evaluate('heldSales.length'), 1);
        await evaluate(`
            window.fixturePaidHeld = JSON.parse(JSON.stringify(heldSales));
            fixtureDismiss(); document.getElementById('checkoutBtn').click(); fixtureDismiss();
        `);
        await waitFor('!checkoutInFlight');
        assert.equal(await evaluate('heldSales.length'), 0);
        assert.equal(await evaluate('JSON.parse(localStorage.getItem(heldKey())).length'), 0);
        const dinein = await evaluate(`__fixture.writes.filter(w => /\\/orders\\/POS-/.test(w.key))[1].value`);
        assert.equal(dinein.restaurantOrder.table, 2);
        assert.equal(dinein.items[0].qty, 2);
        assert.equal(dinein.total, 47);
        await evaluate(`
            closeModal('receiptModal');
            heldSales = fixturePaidHeld;
            resumeHeld(0); pendingRedeem = null; pendingCreditUse = 0;
            document.getElementById('checkoutBtn').click(); fixtureDismiss();
        `);
        await waitFor('!checkoutInFlight');
        assert.match(await evaluate('document.getElementById("confirmMessage").textContent'), /محفوظ بالفعل/);
        assert.equal(await evaluate(`__fixture.writes.filter(w => /\\/orders\\/POS-/.test(w.key)).length`), 2);
        await evaluate(`fixtureDismiss(); resetRestaurantTicket(); heldSales = []; saveHeldSales();`);
        console.log('PASS: dine-in save/resume, loyalty/customer/discount restoration, no ticket merging, storage/checkout failure recovery.');

        await evaluate(`
            closeModal('receiptModal'); fixtureDismiss();
            resetRestaurantTicket();
            document.querySelector('[data-id="burger"].restaurant-food-item').click();
            fixtureInput('restaurantCustomerName', 'استلام تجريبي');
            document.getElementById('checkoutBtn').click(); fixtureDismiss();
        `);
        await waitFor('!checkoutInFlight');
        assert.equal(await evaluate(`__fixture.writes.filter(w => /\\/orders\\/POS-/.test(w.key))[2].value.restaurantOrder.type`), 'takeaway');
        console.log('PASS: takeaway checkout persists pickup details.');

        await evaluate(`
            closeModal('receiptModal');
            document.querySelector('.nav-btn[data-page="restaurant"]').click();
            document.querySelector('[data-r-action="menu-edit"][data-id="hummus"]').click();
        `);
        assert.equal(await evaluate('document.querySelectorAll(".restaurant-editor [data-row]").length'), 3);
        await evaluate(`
            var rows = document.querySelectorAll('.restaurant-editor [data-row]');
            rows[1].querySelector('[data-row-field="label"]').value = 'صغير';
            document.querySelector('.restaurant-editor button[type="submit"]').click();
        `);
        assert.match(await evaluate('document.querySelector(".restaurant-inline-error").textContent'), /.+/);
        await evaluate(`
            var rows = document.querySelectorAll('.restaurant-editor [data-row]');
            rows[1].querySelector('[data-row-field="label"]').value = 'وسط';
            rows[1].querySelector('[data-row-field="price"]').value = '18';
            rows[0].querySelector('[data-row-field="label"]').value = 'x" onfocus="window.pwned=1';
            document.querySelector('[data-r-action="portion-add"]').click();
            var added = Array.from(document.querySelectorAll('.restaurant-editor [data-row]')).at(-1);
            added.querySelector('[data-row-field="label"]').value = 'عائلي';
            added.querySelector('[data-row-field="price"]').value = '30';
            added.querySelector('[data-row-field="cost"]').value = '8';
            added.querySelector('[data-row-field="stock"]').value = '5';
            __fixture.failNextWrite = true;
            document.querySelector('.restaurant-editor button[type="submit"]').click();
        `);
        await waitFor('document.querySelector(".restaurant-inline-error")?.textContent.length > 0');
        assert.equal(await evaluate('document.querySelectorAll(".restaurant-editor [data-row]").length'), 4);
        assert.equal(await evaluate('document.querySelector(".restaurant-editor button[type=submit]").disabled'), false);
        await evaluate(`document.querySelector('.restaurant-editor button[type="submit"]').click()`);
        await waitFor('!document.querySelector(".restaurant-editor")');
        assert.deepEqual(await evaluate(`__fixture.read('projects/isolated-restaurant-fixture/products/hummus').variants.map(v => v.price)`), [10, 18, 20, 30]);
        await evaluate(`
            products = products.map(p => p.id === 'hummus' ? __fixture.read('projects/isolated-restaurant-fixture/products/hummus') : p);
            syncRestaurantWorkspace();
            document.querySelector('[data-r-action="menu-edit"][data-id="hummus"]').click();
            document.querySelector('.restaurant-editor [data-row-field="label"]').focus();
        `);
        assert.equal(await evaluate('!!window.pwned'), false);
        assert.equal(await evaluate('document.querySelector(".restaurant-editor [data-row-field=label]").hasAttribute("onfocus")'), false);
        assert.equal(await evaluate('document.querySelector(".restaurant-editor [data-row-field=label]").value'), 'x" onfocus="window.pwned=1');
        await screenshot('restaurant-portions-editor', 1440, 1000);
        await evaluate(`
            document.querySelector('.restaurant-editor [data-r-close]').click();
            currentUser.role = 'cashier'; syncRestaurantWorkspace();
        `);
        assert.equal(await evaluate('document.querySelector("[data-r-action=menu-new]").disabled'), true);
        console.log('PASS: real multi-size editor validates, preserves input after save failure, saves all portions and restricts cashier edits.');

        await evaluate(`
            document.querySelector('.cart-payment-details').open = false;
            currentUser.role = 'admin'; licensedBusinessType = 'shop';
            products = [{ id: 'retail', name: 'Retail fixture', type: 'shirts',
                colors: [{ name: 'red', hex: '#ff0000' }, { name: 'blue', hex: '#0000ff' }],
                variants: [{ color: 'red', size: 'M', price: 20, stock: 5 }, { color: 'blue', size: 'M', price: 20, stock: 5 }] }];
            storeConfig = { features: {} }; resetRestaurantTicket(); applyBusinessSurface(); switchPage('sales');
            fixtureInput('productSearch', 'Retail');
        `);
        await waitFor('!!document.querySelector(".product-card")');
        await evaluate(`document.querySelector('.product-card').click()`);
        assert.equal(await evaluate('cart.length'), 0, 'Retail keeps explicit color selection.');
        assert.equal(await evaluate('document.body.classList.contains("restaurant-mode")'), false);
        assert.equal(await evaluate('getComputedStyle(document.getElementById("restaurantServicePanel")).display'), 'none');
        assert.equal(await evaluate('document.querySelector(".cart-payment-details").open'), true);
        await evaluate(`
            document.querySelector('.color-option').click();
            document.querySelector('.size-option').click();
            document.getElementById('addToCartFromModal').click();
        `);
        assert.equal(await evaluate('cart[0].color'), 'red');
        assert.equal(await evaluate('window.__fixture.error || null'), null);
        console.log('PASS: retail color/size ordering remains intact; no renderer exceptions.');
    } catch (error) {
        if (win) console.error('Renderer exception:', await evaluate('window.__fixture && window.__fixture.error').catch(() => 'unavailable'));
        console.error(error.stack || error);
        process.exitCode = 1;
    } finally {
        clearTimeout(watchdog);
        if (win) win.destroy();
        await session.defaultSession.closeAllConnections();
        app.exit(process.exitCode || 0);
    }
});
