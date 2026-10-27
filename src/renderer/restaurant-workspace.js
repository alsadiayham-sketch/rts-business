(function (root) {
    'use strict';
    var model = root.RestaurantModel;
    var state = { tab: 'menu', query: '', category: 'all', attendanceDate: '', initialized: false };
    var adapters = {};

    function esc(value) { var div = document.createElement('div'); div.textContent = value == null ? '' : String(value); return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function money(value) { return '₪' + Number(value || 0).toFixed(2); }
    function admin() { return !!(adapters.isAdmin && adapters.isAdmin()); }
    function allRecords() { return adapters.records ? adapters.records() : []; }
    function records(type) { return allRecords().filter(function (record) { return record.recordType === type; }); }
    function setMessage(message, type) { var el = document.getElementById('restaurantWorkspaceNotice'); if (el) { el.textContent = message || ''; el.className = 'restaurant-notice ' + (type || ''); } }
    function requireAdmin() { if (admin()) return true; setMessage('هذه العملية متاحة للمدير فقط.', 'error'); return false; }

    function activeOffer(offer) { return model.isOfferActive(offer, new Date().toISOString()); }
    function employeeRecords() { return records('restaurant-employee').sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'ar'); }); }
    function attendanceRecords() { return records('restaurant-attendance'); }
    function openShift(employeeId) {
        var validation = model.validateAttendanceTransition(attendanceRecords(), employeeId, 'out', new Date().toISOString());
        return validation.ok ? validation.shiftId : '';
    }
    function openShiftRecord(employeeId) {
        var closed = {};
        attendanceRecords().forEach(function (record) { if (record.action === 'out') closed[record.shiftId] = true; });
        return attendanceRecords().filter(function (record) { return record.employeeId === employeeId && record.action === 'in' && !closed[record.shiftId]; }).pop();
    }
    function durationLabel(from, until) {
        var minutes = Math.max(0, Math.floor((new Date(until).getTime() - new Date(from).getTime()) / 60000));
        return Math.floor(minutes / 60) + ' س ' + (minutes % 60) + ' د';
    }
    function menuSections() { return adapters.menuSections ? adapters.menuSections() : []; }
    function toNumber(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
    function normalizeLabel(value) { return String(value || '').trim().normalize('NFKC').toLocaleLowerCase('ar'); }
    function menuStatus(product) { return product && product.status === 'disabled' ? 'غير متاح' : 'متاح'; }
    function menuStatusClass(product) { return product && product.status === 'disabled' ? 'muted' : 'success'; }
    function menuVariantSummary(product) {
        var variants = model.foodChoices(product).map(function (choice) { return choice.variant; }).filter(function (variant) { return variant && Number.isFinite(Number(variant.price)); });
        if (!variants.length) return { price: money(0), details: 'لا توجد حصص', totalStock: 0 };
        var prices = variants.map(function (variant) { return Number(variant.price); });
        var min = Math.min.apply(null, prices);
        var max = Math.max.apply(null, prices);
        var totalStock = variants.reduce(function (sum, variant) { return sum + Math.max(0, toNumber(variant.stock)); }, 0);
        var labels = variants.map(function (variant) { return String(variant.size || '').trim(); }).filter(Boolean);
        var unique = [];
        labels.forEach(function (label) { if (unique.indexOf(label) === -1) unique.push(label); });
        return {
            price: min === max ? money(min) : money(min) + ' - ' + money(max),
            details: unique.length ? unique.join('، ') : 'حصص غير معرّفة',
            totalStock: totalStock
        };
    }

    function renderMenuRows() {
        var products = adapters.products ? adapters.products() : [];
        var query = state.query.toLowerCase();
        products = products.filter(function (product) {
            return (!query || String(product.name || '').toLowerCase().indexOf(query) !== -1) &&
                (state.category === 'all' || product.category === state.category);
        });
        return products.map(function (product) {
                var summary = menuVariantSummary(product);
                var image = model.menuImageSource(product.image);
                return '<article class="restaurant-menu-row"><div class="restaurant-menu-identity">' +
                    (image ? '<img data-menu-image class="restaurant-menu-thumb" src="' + esc(image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
                    '<div><strong>' + esc(product.name) + '</strong><span>' + esc(product.category || 'غير مصنف') + ' · ' + esc(summary.details) + (product.demoDataVersion ? ' · بيانات تجريبية' : '') + '</span>' +
                    (product.description ? '<p class="restaurant-menu-description">' + esc(product.description) + '</p>' : '') +
                    '</div></div><div class="restaurant-price">' + summary.price + '<small>المخزون ' + Number(summary.totalStock || 0) + ' · <span class="restaurant-status ' + menuStatusClass(product) + '">' + menuStatus(product) + '</span></small></div><button class="btn-secondary btn-small" data-r-action="menu-edit" data-id="' + esc(product.id) + '"' + (admin() ? '' : ' disabled') + '>تعديل</button></article>';
            }).join('') + (products.length ? '' : '<div class="restaurant-empty">لا توجد أصناف مطابقة. أضف صنفًا من القائمة أو غيّر البحث.</div>');
    }

    function renderMenu() {
        var categories = menuSections().map(function (section) { return section.name; });
        return '<div class="restaurant-toolbar"><div><h3>إدارة القائمة</h3><p>أصناف الطعام، الحصص، والتوفر الفعلي.</p></div>' +
            '<button class="btn-primary" data-r-action="menu-new"' + (admin() ? '' : ' disabled') + '>+ صنف في القائمة</button></div>' +
            '<div class="restaurant-filters"><input data-r-input="menu-query" value="' + esc(state.query) + '" placeholder="ابحث باسم الصنف"><select data-r-input="menu-category"><option value="all">كل التصنيفات</option>' +
            categories.map(function (category) { return '<option value="' + esc(category) + '"' + (state.category === category ? ' selected' : '') + '>' + esc(category) + '</option>'; }).join('') + '</select></div>' +
            '<div class="restaurant-menu-list">' + renderMenuRows() + '</div>';
    }

    function renderSections() {
        var sections = menuSections();
        var products = adapters.products ? adapters.products() : [];
        return '<div class="restaurant-toolbar"><div><h3>أقسام القائمة</h3><p>رتّب الأقسام كما تريد أن تظهر للكاشير. لا يمكن حذف قسم يحتوي أصنافًا.</p></div><button class="btn-primary" data-r-action="section-new"' + (admin() ? '' : ' disabled') + '>+ قسم جديد</button></div>' +
            '<div class="restaurant-section-list">' + sections.map(function (section, index) {
                var count = products.filter(function (product) { return (product.category || product.type) === section.name; }).length;
                return '<article class="restaurant-section-row"><div><strong>' + esc(section.name) + '</strong><span>' + count + ' أصناف · الترتيب ' + (index + 1) + '</span></div><div class="restaurant-section-actions"><button class="btn-secondary btn-small" data-r-action="section-up" data-id="' + esc(section.id) + '"' + (admin() && index ? '' : ' disabled') + '>أعلى</button><button class="btn-secondary btn-small" data-r-action="section-down" data-id="' + esc(section.id) + '"' + (admin() && index < sections.length - 1 ? '' : ' disabled') + '>أسفل</button><button class="btn-quiet" data-r-action="section-edit" data-id="' + esc(section.id) + '"' + (admin() ? '' : ' disabled') + '>إعادة تسمية</button><button class="btn-quiet" data-r-action="section-delete" data-id="' + esc(section.id) + '"' + (admin() && !count ? '' : ' disabled') + '>حذف</button></div></article>';
            }).join('') + (sections.length ? '' : '<div class="restaurant-empty">أنشئ أول قسم، مثل «الوجبات الرئيسية» أو «المشروبات».</div>') + '</div>';
    }

    function renderOffers() {
        var offers = records('restaurant-offer').sort(function (a, b) { return String(b.createdAtIso || '').localeCompare(String(a.createdAtIso || '')); });
        return '<div class="restaurant-toolbar"><div><h3>العروض</h3><p>لا يُطبّق أي عرض تلقائيًا؛ راجعه ثم طبّقه على سلة البيع الحالية.</p></div><button class="btn-primary" data-r-action="offer-new"' + (admin() ? '' : ' disabled') + '>+ عرض جديد</button></div>' +
            '<div class="restaurant-offer-list">' + offers.map(function (offer) {
                var enabled = activeOffer(offer);
                var label = model.offerLabel(offer);
                return '<article class="restaurant-offer-row"><div><strong>' + esc(offer.name) + '</strong><span>' + esc(label) + ' · حد أدنى ' + Number(offer.minQty || 1) + ' صنف' + (offer.expiresOn ? ' · ينتهي ' + esc(offer.expiresOn) : '') + '</span></div><span class="restaurant-status ' + (enabled ? 'success' : 'muted') + '">' + (enabled ? 'متاح' : 'غير متاح') + '</span><button class="btn-secondary btn-small" data-r-action="offer-apply" data-id="' + esc(offer.id) + '"' + (enabled ? '' : ' disabled') + '>تطبيق على السلة</button><button class="btn-secondary btn-small" data-r-action="offer-edit" data-id="' + esc(offer.id) + '"' + (admin() ? '' : ' disabled') + '>تعديل</button></article>';
            }).join('') + (offers.length ? '' : '<div class="restaurant-empty">أضف عرضًا موثّقًا قبل استخدامه في البيع.</div>') + '</div>';
    }

    function renderCustomers() {
        var list = adapters.customers ? adapters.customers() : [];
        return '<div class="restaurant-toolbar"><div><h3>العملاء والولاء</h3><p>ملفات العملاء ونقاطهم تستخدم دفتر الولاء الحالي نفسه.</p></div><button class="btn-primary" data-r-action="customer-new">+ عميل جديد</button></div>' +
            '<div class="restaurant-customer-list">' + list.slice(0, 30).map(function (customer) {
                return '<article class="restaurant-customer-row"><div><strong>' + esc(customer.name || 'بدون اسم') + '</strong><span>' + esc(customer.phone || 'بدون رقم') + ' · ' + Number(customer.points || 0) + ' نقطة</span></div><div>' + money(customer.spent) + '<small>' + Number(customer.visits || 0) + ' زيارات</small></div><button class="btn-secondary btn-small" data-r-action="customer-open" data-key="' + encodeURIComponent(customer.key) + '">فتح الملف</button></article>';
            }).join('') + (list.length ? '' : '<div class="restaurant-empty">أضف عملاء من سجل المبيعات أو من الزر أعلاه.</div>') + '</div>';
    }

    function renderAttendance() {
        var employees = employeeRecords();
        var date = state.attendanceDate || new Date().toISOString().slice(0, 10);
        var rows = attendanceRecords().filter(function (record) { return String(record.occurredAt || '').slice(0, 10) === date; }).sort(function (a, b) { return String(b.occurredAt).localeCompare(String(a.occurredAt)); });
        return '<div class="restaurant-demo-banner"><strong>DEMO — محاكاة حضور فقط</strong><span>ليست رواتب ولا تكامل جهاز بصمة. لا تُنشئ حسابات دخول للموظفين.</span></div>' +
            '<div class="restaurant-toolbar"><div><h3>حضور الطاقم التجريبي</h3><p>تسجيل يدوي للاختبار حتى توفير جهاز الحضور.</p></div><button class="btn-primary" data-r-action="employee-new"' + (admin() ? '' : ' disabled') + '>+ موظف تجريبي</button></div>' +
            '<div class="restaurant-attendance-controls"><label>التاريخ <input type="date" data-r-input="attendance-date" value="' + esc(date) + '"></label></div>' +
            '<div class="restaurant-employee-list">' + employees.map(function (employee) {
                var shift = openShift(employee.id);
                    var openRecord = openShiftRecord(employee.id);
                    var shiftText = shift ? 'وردية مفتوحة · ' + durationLabel(openRecord.occurredAt, new Date().toISOString()) : 'خارج الوردية';
                    return '<article class="restaurant-employee-row"><div><strong>' + esc(employee.name) + '</strong><span>' + esc(employee.role || 'طاقم خدمة') + '</span></div><span class="restaurant-status ' + (shift ? 'warning' : 'muted') + '">' + shiftText + '</span><button class="btn-secondary btn-small" data-r-action="' + (shift ? 'attendance-out' : 'attendance-in') + '" data-id="' + esc(employee.id) + '">' + (shift ? 'تسجيل انصراف' : 'تسجيل حضور') + '</button><button class="btn-quiet" data-r-action="employee-edit" data-id="' + esc(employee.id) + '"' + (admin() ? '' : ' disabled') + '>تعديل الدور</button></article>';
            }).join('') + (employees.length ? '' : '<div class="restaurant-empty">أضف موظفًا تجريبيًا لبدء المحاكاة.</div>') + '</div>' +
            '<div class="restaurant-history"><h4>سجل ' + esc(date) + '</h4>' + rows.map(function (record) {
                var start = record.action === 'out' && attendanceRecords().find(function (candidate) { return candidate.shiftId === record.shiftId && candidate.action === 'in'; });
                var label = record.action === 'in' ? 'حضور' : 'انصراف · ' + (start ? durationLabel(start.occurredAt, record.occurredAt) : '—');
                return '<div><span>' + esc(record.employeeName) + '</span><span>' + label + '</span><time>' + new Date(record.occurredAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) + '</time></div>';
            }).join('') + (rows.length ? '' : '<p>لا توجد حركات في هذا التاريخ.</p>') + '</div>';
    }
    function renderTables() {
        return '<div class="restaurant-toolbar"><div><h3>الطاولات والطلبات</h3><p>اضغط على طاولة لبدء طلب أو متابعة طلب معلّق.</p></div></div>' +
            '<div class="restaurant-attendance-controls"><label>عدد الطاولات <input type="number" id="tableCount" min="1" max="60" step="1" value="' + Number(adapters.tableCount ? adapters.tableCount() : 12) + '"></label><button class="btn-secondary" data-r-action="tables-save">حفظ العدد</button></div><div class="tables-grid" id="tablesGrid"></div>';
    }

    function render() {
        var host = document.getElementById('restaurantWorkspace');
        if (!host) return;
        var content = state.tab === 'menu' ? renderMenu() : state.tab === 'sections' ? renderSections() : state.tab === 'offers' ? renderOffers() : state.tab === 'customers' ? renderCustomers() : state.tab === 'attendance' ? renderAttendance() : renderTables();
        host.innerHTML = '<header class="restaurant-workspace-header"><div><h2>إدارة المطعم</h2><p>القائمة والعروض والعملاء والطاولات في مساحة تشغيل واحدة.</p></div></header>' +
            '<div class="restaurant-tabs" role="tablist">' +
            [['menu', 'إدارة القائمة'], ['sections', 'الأقسام'], ['offers', 'العروض'], ['customers', 'العملاء والولاء'], ['attendance', 'الحضور التجريبي'], ['tables', 'الطاولات']].map(function (tab) { return '<button role="tab" class="' + (state.tab === tab[0] ? 'active' : '') + '" data-r-tab="' + tab[0] + '">' + tab[1] + '</button>'; }).join('') +
            '</div><div id="restaurantWorkspaceNotice" class="restaurant-notice"></div><section class="restaurant-panel">' + content + '</section>';
        if (state.tab === 'tables' && adapters.renderTables) adapters.renderTables();
    }

    function promptFields(title, fields, submit) {
        var previousFocus = document.activeElement;
        var modal = document.createElement('div');
        modal.className = 'modal-overlay restaurant-editor'; modal.style.display = 'flex';
        modal.innerHTML = '<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="restaurantEditorTitle"><div class="modal-header"><h3 id="restaurantEditorTitle">' + esc(title) + '</h3><button class="modal-close" data-r-close>&times;</button></div><form class="modal-body restaurant-form">' +
            fields.map(function (field) {
                var name = esc(field.name), value = field.value == null ? '' : String(field.value);
                if (field.type === 'select') return '<label>' + esc(field.label) + '<select name="' + name + '">' + (field.options || []).map(function (option) { return '<option value="' + esc(option.value) + '"' + (String(option.value) === value ? ' selected' : '') + '>' + esc(option.label) + '</option>'; }).join('') + '</select></label>';
                if (field.type === 'textarea') return '<label>' + esc(field.label) + '<textarea name="' + name + '"' + (field.required ? ' required' : '') + '>' + esc(value) + '</textarea></label>';
                return '<label>' + esc(field.label) + '<input name="' + name + '" type="' + esc(field.type || 'text') + '" value="' + esc(value) + '"' + (field.min != null ? ' min="' + field.min + '"' : '') + (field.step ? ' step="' + field.step + '"' : '') + (field.required ? ' required' : '') + '></label>';
            }).join('') +
            '<div class="restaurant-inline-error" aria-live="polite"></div>' +
            '<div class="modal-footer"><button class="btn-primary">حفظ</button><button type="button" class="btn-secondary" data-r-close>إلغاء</button></div></form></div>';
        document.body.appendChild(modal);
        var form = modal.querySelector('form');
        var saveButton = form.querySelector('.btn-primary');
        var errorEl = form.querySelector('.restaurant-inline-error');
        var pending = false;
        function setPending(next) {
            pending = !!next;
            saveButton.disabled = pending;
            saveButton.textContent = pending ? 'جارٍ الحفظ...' : 'حفظ';
        }
        function fail(message) {
            setPending(false);
            errorEl.textContent = message || 'تعذر حفظ البيانات.';
        }
        function close() {
            document.removeEventListener('keydown', onKeydown, true);
            modal.remove();
            if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
        }
        function onKeydown(event) {
            if (event.key === 'Escape' && !pending) {
                event.preventDefault();
                close();
            }
        }
        document.addEventListener('keydown', onKeydown, true);
        modal.addEventListener('click', function (event) {
            if (pending) return;
            if (event.target === modal || event.target.closest('[data-r-close]')) close();
        });
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            if (pending) return;
            errorEl.textContent = '';
            var values = {};
            fields.forEach(function (field) { values[field.name] = form.querySelector('[name="' + field.name + '"]').value.trim(); });
            setPending(true);
            submit(values, { fail: fail, close: close, setPending: setPending });
        });
        var firstInput = modal.querySelector('input,select,textarea,button');
        if (firstInput) firstInput.focus();
    }

    function saveRecord(record, prefix, success) {
        adapters.saveRecord(record, prefix, function () { setMessage(success, 'success'); render(); });
    }

    function editSection(id) {
        if (!requireAdmin()) return;
        var sections = menuSections();
        var section = sections.find(function (item) { return item.id === id; });
        promptFields(section ? 'إعادة تسمية القسم' : 'قسم جديد', [{ name: 'name', label: 'اسم القسم', value: section && section.name, required: true }], function (value, ui) {
            if (!value.name) return ui.fail('اسم القسم مطلوب.');
            if (sections.some(function (item) { return item.name === value.name && item.id !== (section && section.id); })) return ui.fail('يوجد قسم بهذا الاسم.');
            var next = sections.map(function (item) { return Object.assign({}, item); });
            if (section && section.name !== value.name && adapters.renameMenuSection) {
                adapters.renameMenuSection(section.id, value.name, function () { ui.close(); setMessage('تم حفظ القسم وإعادة تعيين أصنافه.', 'success'); render(); }, function () { ui.fail('تعذر حفظ القسم.'); });
                return;
            }
            if (section) next.forEach(function (item) { if (item.id === section.id) item.name = value.name; });
            else next.push({ id: 'menu-section-' + Date.now(), name: value.name, order: next.length });
            adapters.saveMenuSections(next, function () { ui.close(); setMessage('تم حفظ القسم.', 'success'); render(); }, function () { ui.fail('تعذر حفظ القسم.'); });
        });
    }

    function moveSection(id, direction) {
        if (!requireAdmin()) return;
        var sections = menuSections().map(function (section) { return Object.assign({}, section); });
        var index = sections.findIndex(function (section) { return section.id === id; });
        var target = index + direction;
        if (index < 0 || target < 0 || target >= sections.length) return;
        var swap = sections[index]; sections[index] = sections[target]; sections[target] = swap;
        sections.forEach(function (section, position) { section.order = position; });
        adapters.saveMenuSections(sections, function () { setMessage('تم تحديث الترتيب.', 'success'); render(); }, function () { setMessage('تعذر تحديث الترتيب.', 'error'); });
    }

    function deleteSection(id) {
        if (!requireAdmin()) return;
        var section = menuSections().find(function (item) { return item.id === id; });
        var populated = (adapters.products ? adapters.products() : []).some(function (product) { return section && (product.category || product.type) === section.name; });
        if (populated) return setMessage('انقل الأصناف إلى قسم آخر قبل حذف هذا القسم.', 'error');
        var next = menuSections().filter(function (item) { return item.id !== id; }).map(function (item, index) { return Object.assign({}, item, { order: index }); });
        adapters.saveMenuSections(next, function () { setMessage('تم حذف القسم.', 'success'); render(); }, function () { setMessage('تعذر حذف القسم.', 'error'); });
    }

    function managedVariantIndexes(product) {
        return model.foodChoices(product).map(function (choice) { return choice.index; });
    }

    function variantRowTemplate(row, canRemove) {
        return '<div class="restaurant-portion-row" data-row data-source-index="' + (row.sourceIndex == null ? '' : String(row.sourceIndex)) + '"><label>الحصة / الوزن<input data-row-field="label" placeholder="مثال: 100غ أو صغير" value="' + esc(row.label || '') + '"></label>' +
            '<label>السعر<input data-row-field="price" type="number" step="0.01" min="0.01" value="' + esc(row.price) + '" placeholder="السعر"></label>' +
            '<label>التكلفة<input data-row-field="cost" type="number" step="0.01" min="0" value="' + esc(row.cost) + '" placeholder="التكلفة"></label>' +
            '<label>المخزون<input data-row-field="stock" type="number" step="1" min="0" value="' + esc(row.stock) + '" placeholder="المخزون"></label>' +
            '<button type="button" class="btn-quiet btn-small" data-r-action="portion-remove"' + (canRemove ? '' : ' disabled') + '>حذف</button></div>';
    }

    function readVariantRows(container) {
        return Array.prototype.map.call(container.querySelectorAll('[data-row]'), function (row) {
            return {
                sourceIndex: row.dataset.sourceIndex ? Number(row.dataset.sourceIndex) : null,
                label: row.querySelector('[data-row-field="label"]').value.trim(),
                price: row.querySelector('[data-row-field="price"]').value.trim(),
                cost: row.querySelector('[data-row-field="cost"]').value.trim(),
                stock: row.querySelector('[data-row-field="stock"]').value.trim()
            };
        });
    }

    function editMenu(id) {
        if (!requireAdmin()) return;
        if (document.querySelector('.restaurant-editor')) return;
        var product = id && adapters.products().find(function (item) { return String(item.id) === String(id); });
        var sectionOptions = menuSections().map(function (section) { return { value: section.name, label: section.name }; });
        if (!sectionOptions.length) return setMessage('أنشئ قسمًا للقائمة قبل إضافة صنف.', 'error');
        var existing = product && product.variants || [];
        var editableIndexes = managedVariantIndexes(product);
        var defaultRows = editableIndexes.map(function (index) {
            var variant = existing[index] || {};
            return {
                sourceIndex: index,
                label: String(variant.size || '').trim() || 'قياسية',
                price: String(variant.price == null ? '' : variant.price),
                cost: String(variant.cost == null ? '' : variant.cost),
                stock: String(variant.stock == null ? '' : variant.stock)
            };
        });
        if (!defaultRows.length) defaultRows.push({ sourceIndex: null, label: 'قياسية', price: '', cost: '0', stock: '0' });
        var selectedCategory = product && product.category || (state.category !== 'all' ? state.category : sectionOptions[0].value);
        if (!sectionOptions.some(function (option) { return option.value === selectedCategory; })) selectedCategory = sectionOptions[0].value;

        var previousFocus = document.activeElement;
        var draftImage = String(product && product.image || '');
        var imageBusy = false;
        var previewBusy = false;
        var imageError = '';
        var imageRevision = 0;
        var closed = false;
        var modal = document.createElement('div');
        modal.className = 'modal-overlay restaurant-editor restaurant-menu-editor';
        modal.style.display = 'flex';
        modal.innerHTML = '<div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="restaurantMenuEditorTitle"><div class="modal-header"><h3 id="restaurantMenuEditorTitle">' + esc(product ? 'تعديل صنف القائمة' : 'صنف جديد في القائمة') + '</h3><button class="modal-close" type="button" data-r-close>&times;</button></div><form id="restaurantMenuEditorForm" class="modal-body restaurant-form">' +
            '<label>اسم الصنف<input name="name" required maxlength="120" value="' + esc(product && product.name || '') + '"></label>' +
            '<label>وصف الصنف<textarea name="description" rows="3" maxlength="2000" placeholder="المكونات وطريقة التحضير وأي تفاصيل مهمة">' + esc(product && product.description || '') + '</textarea></label>' +
            '<fieldset class="restaurant-image-editor"><legend>صورة الصنف</legend><div class="restaurant-image-fields"><div class="restaurant-image-preview"><img data-image-preview alt="معاينة صورة الصنف" hidden><span data-image-empty>بدون صورة</span></div><div>' +
            '<label>رفع صورة<input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp"></label><small>JPG أو PNG أو WebP حتى 10MB و24 مليون بكسل (8192 بكسل لكل جانب). تُصغّر الصورة تلقائياً قبل الحفظ.</small>' +
            '<label>أو رابط صورة HTTPS<input name="imageUrl" type="url" dir="ltr" placeholder="https://…" value="' + esc(/^https:/i.test(draftImage) ? draftImage : '') + '"></label>' +
            '<button type="button" class="btn-quiet" data-r-action="image-remove">إزالة الصورة</button><p class="restaurant-image-status" data-image-status role="status"></p></div></div></fieldset>' +
            '<label>القسم<select name="category">' + sectionOptions.map(function (option) { return '<option value="' + esc(option.value) + '"' + (option.value === selectedCategory ? ' selected' : '') + '>' + esc(option.label) + '</option>'; }).join('') + '</select></label>' +
            '<label>حالة الصنف<select name="available"><option value="true"' + (product && product.status === 'disabled' ? '' : ' selected') + '>متاح</option><option value="false"' + (product && product.status === 'disabled' ? ' selected' : '') + '>غير متاح</option></select></label>' +
            '<div class="restaurant-portions-editor"><label>الأحجام والتسعير</label><small>عدّل السعر لكل حجم، وأضف أو احذف الأحجام. للصنف بدون أحجام متعددة، اترك حصة واحدة باسم «قياسية».</small><div data-r-portions></div><button type="button" class="btn-secondary" data-r-action="portion-add">+ إضافة حجم</button></div>' +
            '<div class="restaurant-inline-error" aria-live="polite"></div></form>' +
            '<div class="modal-footer"><button class="btn-primary" type="submit" form="restaurantMenuEditorForm">حفظ</button><button class="btn-secondary" type="button" data-r-close>إلغاء</button></div></div>';
        document.body.appendChild(modal);

        var form = modal.querySelector('form');
        var rowHost = form.querySelector('[data-r-portions]');
        var errorEl = form.querySelector('.restaurant-inline-error');
        var saveButton = modal.querySelector('.modal-footer .btn-primary');
        var pending = false;
        var imagePreview = form.querySelector('[data-image-preview]');
        var imageStatus = form.querySelector('[data-image-status]');
        var imageInput = form.querySelector('[name="imageFile"]');
        var imageUrl = form.querySelector('[name="imageUrl"]');

        function updatePreview() {
            var source = model.menuImageSource(draftImage);
            var revision = imageRevision;
            previewBusy = !!source;
            if (source) imageStatus.textContent = 'جارٍ تحميل معاينة الصورة...';
            setPending(pending);
            imagePreview.onload = function () {
                if (!closed && revision === imageRevision) {
                    previewBusy = false;
                    imageError = '';
                    imageStatus.textContent = 'الصورة جاهزة. اضغط حفظ لتطبيق التغيير.';
                    setPending(pending);
                }
            };
            imagePreview.onerror = function () {
                if (closed || revision !== imageRevision) return;
                previewBusy = false;
                imageError = 'تعذر عرض الصورة. تحقق من الرابط أو ارفع صورة من الجهاز.';
                imageStatus.textContent = imageError;
                imagePreview.hidden = true;
                form.querySelector('[data-image-empty]').hidden = false;
                setPending(pending);
            };
            imagePreview.hidden = !source;
            form.querySelector('[data-image-empty]').hidden = !!source;
            if (source) imagePreview.src = source;
            else imagePreview.removeAttribute('src');
        }
        imagePreview.referrerPolicy = 'no-referrer';
        imageUrl.addEventListener('input', function () {
            if (pending) return;
            imageRevision++;
            imageBusy = false;
            imageInput.value = '';
            draftImage = imageUrl.value.trim();
            imageError = draftImage && !model.menuImageSource(draftImage) ? 'استخدم رابط صورة HTTPS صالحاً.' : '';
            imageStatus.textContent = imageError;
            setPending(false);
            updatePreview();
        });
        imageInput.addEventListener('change', async function () {
            if (pending) return;
            var file = imageInput.files && imageInput.files[0];
            if (!file) return;
            var revision = ++imageRevision;
            imageBusy = false;
            previewBusy = false;
            setPending(false);
            if (['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) < 0 || !file.size || file.size > 10 * 1024 * 1024) {
                imageInput.value = '';
                imageError = 'اختر صورة JPG أو PNG أو WebP لا تتجاوز 10MB.';
                imageStatus.textContent = imageError;
                return;
            }
            imageBusy = true;
            imageError = '';
            saveButton.disabled = true;
            imageStatus.textContent = 'جارٍ تجهيز الصورة...';
            var bitmap;
            try {
                var bytes = new Uint8Array(await file.arrayBuffer());
                if (closed || revision !== imageRevision) return;
                var dimensions = require('image-size').imageSize(bytes);
                if (['jpg', 'png', 'webp'].indexOf(dimensions.type) < 0 || !dimensions.width || !dimensions.height) {
                    throw new Error('Unsupported image');
                }
                if (dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 24000000) {
                    throw new Error('الصورة كبيرة جداً: الحد 24 مليون بكسل و8192 بكسل لكل جانب. صغّرها ثم أعد المحاولة.');
                }
                var rotated = dimensions.orientation >= 5 && dimensions.orientation <= 8;
                var width = rotated ? dimensions.height : dimensions.width;
                var height = rotated ? dimensions.width : dimensions.height;
                var decodeScale = Math.min(1, 960 / Math.max(width, height));
                bitmap = await createImageBitmap(file, {
                    resizeWidth: Math.max(1, Math.round(width * decodeScale)),
                    resizeHeight: Math.max(1, Math.round(height * decodeScale)),
                    resizeQuality: 'high'
                });
                if (closed || revision !== imageRevision) return;
                var scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
                var canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                var prepared = canvas.toDataURL('image/webp', 0.82);
                if (!model.menuImageSource(prepared)) throw new Error('الصورة كبيرة بعد التصغير؛ اختر صورة أصغر أو استخدم رابط HTTPS.');
                if (closed || revision !== imageRevision) return;
                draftImage = prepared;
                imageUrl.value = '';
                imageStatus.textContent = 'الصورة جاهزة. اضغط حفظ لتطبيق التغيير.';
                updatePreview();
            } catch (error) {
                if (!closed && revision === imageRevision) {
                    imageError = error.message && error.message.indexOf('الصورة كبيرة') === 0 ? error.message : 'تعذر قراءة الصورة. اختر ملف صورة صالحاً آخر.';
                    imageStatus.textContent = imageError;
                    imageInput.value = '';
                }
            } finally {
                if (bitmap) bitmap.close();
                if (!closed && revision === imageRevision) { imageBusy = false; setPending(false); }
            }
        });
        updatePreview();

        function setPending(next) {
            pending = !!next;
            saveButton.disabled = pending || imageBusy || previewBusy;
            form.querySelectorAll('input,textarea,select').forEach(function (field) { field.disabled = pending; });
            saveButton.textContent = pending ? 'جارٍ الحفظ...' : 'حفظ';
        }
        function fail(message) {
            setPending(false);
            errorEl.textContent = message || 'تعذر حفظ الصنف.';
        }
        function close() {
            closed = true;
            imageRevision++;
            document.removeEventListener('keydown', onKeydown, true);
            modal.remove();
            if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
        }
        function renderRows(rows) {
            rowHost.innerHTML = rows.map(function (row) { return variantRowTemplate(row, rows.length > 1); }).join('');
        }
        function currentRows() {
            return Array.prototype.map.call(rowHost.querySelectorAll('[data-row]'), function (row) {
                return {
                    sourceIndex: row.dataset.sourceIndex ? Number(row.dataset.sourceIndex) : null,
                    label: row.querySelector('[data-row-field="label"]').value,
                    price: row.querySelector('[data-row-field="price"]').value,
                    cost: row.querySelector('[data-row-field="cost"]').value,
                    stock: row.querySelector('[data-row-field="stock"]').value
                };
            });
        }
        function refreshRemoveButtons() {
            var rows = rowHost.querySelectorAll('[data-row]');
            Array.prototype.forEach.call(rows, function (row) {
                var remove = row.querySelector('[data-r-action="portion-remove"]');
                if (remove) remove.disabled = rows.length <= 1;
            });
        }
        function onKeydown(event) {
            if (event.key === 'Escape' && !pending) {
                event.preventDefault();
                event.stopPropagation();
                close();
            }
        }
        document.addEventListener('keydown', onKeydown, true);
        modal.addEventListener('click', function (event) {
            if (pending) return;
            if (event.target === modal || event.target.closest('[data-r-close]')) close();
            if (event.target.closest('[data-r-action="image-remove"]')) {
                imageRevision++;
                imageBusy = false;
                draftImage = '';
                imageError = '';
                imageInput.value = '';
                imageUrl.value = '';
                imageStatus.textContent = 'ستُزال الصورة عند حفظ الصنف.';
                setPending(false);
                updatePreview();
            }
            if (event.target.closest('[data-r-action="portion-add"]')) {
                var rows = currentRows();
                rows.push({ sourceIndex: null, label: '', price: '', cost: '0', stock: '0' });
                renderRows(rows);
                refreshRemoveButtons();
                var inputs = rowHost.querySelectorAll('[data-row]');
                var last = inputs[inputs.length - 1];
                if (last) {
                    var field = last.querySelector('[data-row-field="label"]');
                    if (field) field.focus();
                }
            }
            var removeButton = event.target.closest('[data-r-action="portion-remove"]');
            if (removeButton) {
                var rows = currentRows();
                if (rows.length <= 1) return;
                var rowNode = removeButton.closest('[data-row]');
                var wrappers = Array.prototype.slice.call(rowHost.querySelectorAll('[data-row]'));
                var removeIndex = wrappers.indexOf(rowNode);
                if (removeIndex < 0) return;
                rows.splice(removeIndex, 1);
                renderRows(rows);
                refreshRemoveButtons();
            }
        });

        renderRows(defaultRows);
        refreshRemoveButtons();

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            if (pending || imageBusy || previewBusy) return;
            errorEl.textContent = '';
            if (!admin()) return fail('هذه العملية متاحة للمدير فقط.');
            if (imageError) return fail(imageError);
            var name = String(form.querySelector('[name="name"]').value || '').trim();
            var description = String(form.querySelector('[name="description"]').value || '').trim();
            var category = String(form.querySelector('[name="category"]').value || '').trim();
            var available = form.querySelector('[name="available"]').value === 'true';
            if (!name) return fail('اسم الصنف مطلوب.');
            if (name.length > 120 || description.length > 2000) return fail('الاسم أو الوصف أطول من الحد المسموح.');
            if (draftImage && !model.menuImageSource(draftImage)) return fail('اختر صورة صالحة أو رابط HTTPS، أو أزل الصورة.');
            if (!category) return fail('القسم مطلوب.');
            var rows = readVariantRows(rowHost);
            if (!rows.length) return fail('أضف حجمًا واحدًا على الأقل.');
            var labels = Object.create(null);
            for (var i = 0; i < rows.length; i += 1) {
                var row = rows[i];
                var label = normalizeLabel(row.label);
                if (label && labels[label]) return fail('أسماء الأحجام يجب أن تكون فريدة.');
                labels[label] = true;
            }
            var build = model.buildFoodVariants(existing, rows, editableIndexes);
            if (!build.ok) return fail(build.errors[0]);
            var next = {
                id: product ? product.id : 'restaurant-' + Date.now(),
                name: name,
                description: description,
                image: model.menuImageSource(draftImage),
                category: category,
                type: category,
                brand: product && product.brand || 'مطعم',
                restaurantMenu: true,
                status: available ? 'active' : 'disabled',
                variants: build.variants
            };
            setPending(true);
            adapters.saveProduct(next, function () {
                state.category = category;
                close();
                setMessage('تم حفظ صنف القائمة.', 'success');
                render();
            }, function () {
                fail('تعذر حفظ صنف القائمة.');
            });
        });

        var firstInput = form.querySelector('input,select,textarea,button');
        if (firstInput) firstInput.focus();
    }

    function editOffer(id) {
        if (!requireAdmin()) return;
        var offer = records('restaurant-offer').find(function (item) { return String(item.id) === String(id); }) || {};
        promptFields(offer.id ? 'تعديل العرض' : 'عرض جديد', [
            { name: 'name', label: 'اسم العرض', value: offer.name, required: true },
            { name: 'discountType', label: 'نوع الخصم', type: 'select', options: [{ value: 'percent', label: 'نسبة %' }, { value: 'amount', label: 'مبلغ ثابت' }], value: offer.discountType || 'percent', required: true },
            { name: 'discountValue', label: 'قيمة الخصم', type: 'number', min: 0.01, step: '0.5', value: offer.discountValue || '', required: true },
            { name: 'maxDiscount', label: 'الحد الأقصى للخصم (0 بلا حد)', type: 'number', min: 0, step: '0.5', value: offer.maxDiscount || 0, required: true },
            { name: 'minQty', label: 'الحد الأدنى للكمية', type: 'number', min: 1, step: '1', value: offer.minQty || 1, required: true },
            { name: 'expiresOn', label: 'تاريخ الانتهاء (اختياري)', type: 'date', value: offer.expiresOn || '' },
            { name: 'enabled', label: 'حالة العرض', type: 'select', options: [{ value: 'true', label: 'مفعّل' }, { value: 'false', label: 'غير مفعّل' }], value: offer.enabled === false ? 'false' : 'true', required: true }
        ], function (value, ui) {
            var next = { id: offer.id, recordType: 'restaurant-offer', name: value.name, discountType: value.discountType, discountValue: Number(value.discountValue), maxDiscount: Number(value.maxDiscount), minQty: Number(value.minQty), expiresOn: value.expiresOn, enabled: value.enabled === 'true' };
            var errors = model.validateOffer(next); if (errors.length) return ui.fail(errors[0]);
            adapters.saveRecord(next, 'RO', function () { ui.close(); setMessage('تم حفظ العرض.', 'success'); render(); }, function () { ui.fail('تعذر حفظ العرض.'); });
        });
    }

    function applyOffer(id) {
        var offer = records('restaurant-offer').find(function (item) { return String(item.id) === String(id); });
        var result = model.applyOffer(offer, adapters.cart ? adapters.cart() : [], new Date().toISOString());
        if (!result.ok) return setMessage(result.errors[0], 'error');
        adapters.applyOffer(offer, result.discount);
        setMessage('تم تجهيز عرض «' + offer.name + '» بقيمة ' + money(result.discount) + '. راجع الفاتورة قبل الإتمام.', 'success');
    }

    function saveEmployee(id) {
        if (!requireAdmin()) return;
        var employee = employeeRecords().find(function (item) { return String(item.id) === String(id); }) || {};
        promptFields(employee.id ? 'تعديل موظف تجريبي' : 'موظف تجريبي جديد', [{ name: 'name', label: 'الاسم', value: employee.name, required: true }, { name: 'role', label: 'الدور', value: employee.role || 'طاقم خدمة', required: true }], function (value, ui) {
            adapters.saveRecord({ id: employee.id, recordType: 'restaurant-employee', name: value.name, role: value.role, demoDataVersion: model.DEMO_VERSION }, 'RE', function () { ui.close(); setMessage('تم حفظ الموظف التجريبي.', 'success'); render(); }, function () { ui.fail('تعذر حفظ الموظف التجريبي.'); });
        });
    }

    function attendance(employeeId, action) {
        var employee = employeeRecords().find(function (item) { return String(item.id) === String(employeeId); });
        var now = new Date();
        var selected = state.attendanceDate || now.toISOString().slice(0, 10);
        if (selected > now.toISOString().slice(0, 10)) return setMessage('لا يمكن تسجيل حضور أو انصراف في تاريخ مستقبلي.', 'error');
        var occurredAt = selected === now.toISOString().slice(0, 10) ? now.toISOString() : selected + 'T12:00:00.000Z';
        var validation = model.validateAttendanceTransition(attendanceRecords(), employeeId, action, occurredAt);
        if (!validation.ok) return setMessage(validation.error, 'error');
        saveRecord({ recordType: 'restaurant-attendance', employeeId: employeeId, employeeName: employee.name, action: action, shiftId: validation.shiftId, occurredAt: occurredAt, demoDataVersion: model.DEMO_VERSION }, 'RA', 'تم تسجيل ' + (action === 'in' ? 'الحضور' : 'الانصراف') + ' التجريبي.');
    }

    function click(event) {
        var tab = event.target.closest('[data-r-tab]'); if (tab) { state.tab = tab.dataset.rTab; render(); return; }
        var button = event.target.closest('[data-r-action]'); if (!button || button.disabled) return;
        var id = button.dataset.id, action = button.dataset.rAction;
        if (action === 'menu-new') editMenu(); else if (action === 'menu-edit') editMenu(id);
        else if (action === 'section-new') editSection(); else if (action === 'section-edit') editSection(id);
        else if (action === 'section-up') moveSection(id, -1); else if (action === 'section-down') moveSection(id, 1); else if (action === 'section-delete') deleteSection(id);
        else if (action === 'offer-new') editOffer(); else if (action === 'offer-edit') editOffer(id); else if (action === 'offer-apply') applyOffer(id);
        else if (action === 'customer-new') adapters.openNewCustomer(); else if (action === 'customer-open') adapters.openCustomer(decodeURIComponent(button.dataset.key));
        else if (action === 'employee-new') saveEmployee(); else if (action === 'employee-edit') saveEmployee(id);
        else if (action === 'attendance-in') attendance(id, 'in'); else if (action === 'attendance-out') attendance(id, 'out');
        else if (action === 'tables-save') adapters.saveTables();
    }
    function input(event) {
        if (event.target.dataset.rInput === 'menu-query' || event.target.dataset.rInput === 'menu-category') {
            if (event.target.dataset.rInput === 'menu-query') state.query = event.target.value;
            else state.category = event.target.value;
            var list = document.querySelector('#restaurantWorkspace .restaurant-menu-list');
            if (list) list.innerHTML = renderMenuRows();
        }
        if (event.target.dataset.rInput === 'attendance-date') { state.attendanceDate = event.target.value; render(); }
    }
    function init(options) {
        adapters = options || adapters;
        var host = document.getElementById('restaurantWorkspace');
        if (!host || state.initialized) { render(); return; }
        state.initialized = true;
        host.addEventListener('error', function (event) { if (event.target.matches('img[data-menu-image]')) event.target.hidden = true; }, true);
        host.addEventListener('click', click); host.addEventListener('input', input); host.addEventListener('change', input); render();
    }
    root.RestaurantWorkspace = { init: init, render: render, editMenu: editMenu, showMenu: function () { state.tab = 'menu'; state.category = 'all'; state.query = ''; render(); } };
}(window));
