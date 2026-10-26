(function (root) {
    'use strict';
    var model = root.RestaurantModel;
    var state = { tab: 'menu', query: '', category: 'all', attendanceDate: '', initialized: false };
    var adapters = {};

    function esc(value) { var div = document.createElement('div'); div.textContent = value == null ? '' : String(value); return div.innerHTML; }
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

    function renderMenu() {
        var products = (adapters.products ? adapters.products() : []).filter(function (product) {
            return product.status !== 'disabled';
        });
        var categories = menuSections().map(function (section) { return section.name; });
        var query = state.query.toLowerCase();
        products = products.filter(function (product) {
            return (!query || String(product.name || '').toLowerCase().indexOf(query) !== -1) &&
                (state.category === 'all' || product.category === state.category);
        });
        var html = '<div class="restaurant-toolbar"><div><h3>إدارة القائمة</h3><p>أصناف الطعام، الحصص، والتوفر الفعلي.</p></div>' +
            '<button class="btn-primary" data-r-action="menu-new"' + (admin() ? '' : ' disabled') + '>+ صنف في القائمة</button></div>' +
            '<div class="restaurant-filters"><input data-r-input="menu-query" value="' + esc(state.query) + '" placeholder="ابحث باسم الصنف"><select data-r-input="menu-category"><option value="all">كل التصنيفات</option>' +
            categories.map(function (category) { return '<option value="' + esc(category) + '"' + (state.category === category ? ' selected' : '') + '>' + esc(category) + '</option>'; }).join('') + '</select></div>' +
            '<div class="restaurant-menu-list">' + products.map(function (product) {
                var variant = (product.variants || [])[0] || {};
                return '<article class="restaurant-menu-row"><div><strong>' + esc(product.name) + '</strong><span>' + esc(product.category || 'غير مصنف') + (product.demoDataVersion ? ' · بيانات تجريبية' : '') + '</span></div><div class="restaurant-price">' + money(variant.price) + '<small>المخزون ' + Number(variant.stock || 0) + '</small></div><button class="btn-secondary btn-small" data-r-action="menu-edit" data-id="' + esc(product.id) + '"' + (admin() ? '' : ' disabled') + '>تعديل</button></article>';
            }).join('') + (products.length ? '' : '<div class="restaurant-empty">لا توجد أصناف مطابقة. أضف صنفًا من القائمة أو غيّر البحث.</div>') + '</div>';
        return html;
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
        var modal = document.createElement('div');
        modal.className = 'modal-overlay restaurant-editor'; modal.style.display = 'flex';
        modal.innerHTML = '<div class="modal-content"><div class="modal-header"><h3>' + esc(title) + '</h3><button class="modal-close" data-r-close>&times;</button></div><form class="modal-body restaurant-form">' +
            fields.map(function (field) {
                var name = esc(field.name), value = field.value == null ? '' : String(field.value);
                if (field.type === 'select') return '<label>' + esc(field.label) + '<select name="' + name + '">' + (field.options || []).map(function (option) { return '<option value="' + esc(option.value) + '"' + (String(option.value) === value ? ' selected' : '') + '>' + esc(option.label) + '</option>'; }).join('') + '</select></label>';
                if (field.type === 'textarea') return '<label>' + esc(field.label) + '<textarea name="' + name + '"' + (field.required ? ' required' : '') + '>' + esc(value) + '</textarea></label>';
                return '<label>' + esc(field.label) + '<input name="' + name + '" type="' + esc(field.type || 'text') + '" value="' + esc(value) + '"' + (field.min != null ? ' min="' + field.min + '"' : '') + (field.step ? ' step="' + field.step + '"' : '') + (field.required ? ' required' : '') + '></label>';
            }).join('') +
            '<div class="modal-footer"><button class="btn-primary">حفظ</button><button type="button" class="btn-secondary" data-r-close>إلغاء</button></div></form></div>';
        document.body.appendChild(modal);
        modal.addEventListener('click', function (event) { if (event.target === modal || event.target.closest('[data-r-close]')) modal.remove(); });
        modal.querySelector('form').addEventListener('submit', function (event) {
            event.preventDefault(); var values = {}; fields.forEach(function (field) { values[field.name] = modal.querySelector('[name="' + field.name + '"]').value.trim(); });
            submit(values, function (error) { setMessage(error, 'error'); }); modal.remove();
        });
        modal.querySelector('input').focus();
    }

    function saveRecord(record, prefix, success) {
        adapters.saveRecord(record, prefix, function () { setMessage(success, 'success'); render(); });
    }

    function editSection(id) {
        if (!requireAdmin()) return;
        var sections = menuSections();
        var section = sections.find(function (item) { return item.id === id; });
        promptFields(section ? 'إعادة تسمية القسم' : 'قسم جديد', [{ name: 'name', label: 'اسم القسم', value: section && section.name, required: true }], function (value, fail) {
            if (!value.name) return fail('اسم القسم مطلوب.');
            if (sections.some(function (item) { return item.name === value.name && item.id !== (section && section.id); })) return fail('يوجد قسم بهذا الاسم.');
            var next = sections.map(function (item) { return Object.assign({}, item); });
            if (section && section.name !== value.name && adapters.renameMenuSection) {
                adapters.renameMenuSection(section.id, value.name, function () { setMessage('تم حفظ القسم وإعادة تعيين أصنافه.', 'success'); render(); }, function () { setMessage('تعذر حفظ القسم.', 'error'); });
                return;
            }
            if (section) next.forEach(function (item) { if (item.id === section.id) item.name = value.name; });
            else next.push({ id: 'menu-section-' + Date.now(), name: value.name, order: next.length });
            adapters.saveMenuSections(next, function () { setMessage('تم حفظ القسم.', 'success'); render(); }, function () { setMessage('تعذر حفظ القسم.', 'error'); });
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

    function editMenu(id) {
        if (!requireAdmin()) return;
        var product = id && adapters.products().find(function (item) { return String(item.id) === String(id); });
        var variant = product && product.variants && product.variants[0] || {};
        var sectionOptions = menuSections().map(function (section) { return { value: section.name, label: section.name }; });
        if (!sectionOptions.length) return setMessage('أنشئ قسمًا للقائمة قبل إضافة صنف.', 'error');
        var portions = (product && product.variants || []).map(function (item) { return (item.size || '') + ':' + Number(item.price || 0) + ':' + Number(item.stock || 0) + ':' + Number(item.cost || 0); }).join('\\n');
        promptFields(product ? 'تعديل صنف القائمة' : 'صنف جديد في القائمة', [
            { name: 'name', label: 'اسم الصنف', value: product && product.name, required: true },
            { name: 'category', label: 'القسم', type: 'select', options: sectionOptions, value: product && product.category || sectionOptions[0].value, required: true },
            { name: 'price', label: 'السعر', type: 'number', min: 0, step: '0.5', value: variant.price || '', required: true },
            { name: 'available', label: 'متاح للبيع', type: 'select', options: [{ value: 'true', label: 'متاح' }, { value: 'false', label: 'غير متاح' }], value: product && product.status === 'disabled' ? 'false' : 'true' },
            { name: 'portions', label: 'الحصص (اختياري: الاسم:السعر:المخزون:التكلفة، سطر لكل حصة)', type: 'textarea', value: portions }
        ], function (value, fail) {
            if (Number(value.price) < 0) return fail('تحقق من السعر.');
            var lines = value.portions.split(/\\r?\\n/).map(function (line) { return line.trim(); }).filter(Boolean);
            var existing = product && product.variants || [];
            var variants = lines.length ? lines.map(function (line, index) {
                var parts = line.split(':').map(function (part) { return part.trim(); });
                if (!parts[0] || parts.length < 4 || Number(parts[1]) < 0 || Number(parts[2]) < 0 || Number(parts[3]) < 0) return null;
                return Object.assign({}, existing[index] || {}, { color: (existing[index] || {}).color || 'افتراضي', size: parts[0], price: Number(parts[1]), stock: Number(parts[2]), cost: Number(parts[3]) });
            }) : [Object.assign({}, existing[0] || {}, { color: (existing[0] || {}).color || 'افتراضي', size: (existing[0] || {}).size || 'حصة', price: Number(value.price), stock: Number((existing[0] || {}).stock || 0), cost: Number((existing[0] || {}).cost || 0) })];
            if (variants.some(function (item) { return !item; })) return fail('اكتب كل حصة بالشكل: الاسم:السعر:المخزون:التكلفة.');
            adapters.saveProduct({
                id: product ? product.id : 'restaurant-' + Date.now(), name: value.name, category: value.category, type: value.category, brand: 'مطعم',
                restaurantMenu: true, status: value.available === 'true' ? 'active' : 'disabled', variants: variants
            }, function () { setMessage('تم حفظ صنف القائمة.', 'success'); render(); });
        });
    }

    function editOffer(id) {
        if (!requireAdmin()) return;
        var offer = records('restaurant-offer').find(function (item) { return String(item.id) === String(id); }) || {};
        promptFields(offer.id ? 'تعديل العرض' : 'عرض جديد', [
            { name: 'name', label: 'اسم العرض', value: offer.name, required: true },
            { name: 'discountType', label: 'نوع الخصم (percent أو amount)', value: offer.discountType || 'percent', required: true },
            { name: 'discountValue', label: 'قيمة الخصم', type: 'number', min: 0.01, step: '0.5', value: offer.discountValue || '', required: true },
            { name: 'maxDiscount', label: 'الحد الأقصى للخصم (0 بلا حد)', type: 'number', min: 0, step: '0.5', value: offer.maxDiscount || 0, required: true },
            { name: 'minQty', label: 'الحد الأدنى للكمية', type: 'number', min: 1, step: '1', value: offer.minQty || 1, required: true },
            { name: 'expiresOn', label: 'تاريخ الانتهاء (اختياري)', type: 'date', value: offer.expiresOn || '' },
            { name: 'enabled', label: 'مفعّل؟ (true أو false)', value: offer.enabled === false ? 'false' : 'true', required: true }
        ], function (value, fail) {
            if (value.enabled !== 'true' && value.enabled !== 'false') return fail('حالة التفعيل يجب أن تكون true أو false.');
            var next = { id: offer.id, recordType: 'restaurant-offer', name: value.name, discountType: value.discountType, discountValue: Number(value.discountValue), maxDiscount: Number(value.maxDiscount), minQty: Number(value.minQty), expiresOn: value.expiresOn, enabled: value.enabled === 'true' };
            var errors = model.validateOffer(next); if (errors.length) return fail(errors[0]);
            saveRecord(next, 'RO', 'تم حفظ العرض.');
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
        promptFields(employee.id ? 'تعديل موظف تجريبي' : 'موظف تجريبي جديد', [{ name: 'name', label: 'الاسم', value: employee.name, required: true }, { name: 'role', label: 'الدور', value: employee.role || 'طاقم خدمة', required: true }], function (value) {
            saveRecord({ id: employee.id, recordType: 'restaurant-employee', name: value.name, role: value.role, demoDataVersion: model.DEMO_VERSION }, 'RE', 'تم حفظ الموظف التجريبي.');
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
        if (event.target.dataset.rInput === 'menu-query') { state.query = event.target.value; render(); }
        if (event.target.dataset.rInput === 'menu-category') { state.category = event.target.value; render(); }
        if (event.target.dataset.rInput === 'attendance-date') { state.attendanceDate = event.target.value; render(); }
    }
    function init(options) {
        adapters = options || adapters;
        var host = document.getElementById('restaurantWorkspace');
        if (!host || state.initialized) { render(); return; }
        state.initialized = true;
        host.addEventListener('click', click); host.addEventListener('input', input); host.addEventListener('change', input); render();
    }
    root.RestaurantWorkspace = { init: init, render: render };
}(window));
