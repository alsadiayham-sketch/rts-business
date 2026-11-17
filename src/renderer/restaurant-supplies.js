(function (root, factory) {
    'use strict';
    var api = factory(root);
    root.RestaurantSupplies = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    var adapters = {};
    var adapterKey = null;
    var rerender = function () {};
    var state = freshState();
    var generation = 0;

    function freshState() {
        return {
            loaded: false,
            loading: false,
            saving: false,
            items: [],
            audit: [],
            auditCursor: null,
            error: '',
            message: ''
        };
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function validQuantity(value, positive) {
        var text = String(value == null ? '' : value).trim();
        if (!/^(0|[1-9]\d{0,5})(?:\.\d{1,3})?$/.test(text)) return false;
        return !positive || Number(text) > 0;
    }

    function requestId() {
        if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
        return 'supply_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
    }

    function setAdapters(next, onChange) {
        var nextKey = next && next.sessionKey != null ? 'session:' + String(next.sessionKey) : next;
        if (next && nextKey !== adapterKey) {
            generation += 1;
            state = freshState();
            if (typeof document !== 'undefined') {
                Array.from(document.querySelectorAll('[data-supply-modal]')).forEach(function (modal) { modal.remove(); });
            }
        }
        adapters = next || adapters;
        adapterKey = next ? nextKey : adapterKey;
        rerender = typeof onChange === 'function' ? onChange : rerender;
    }

    function unavailableMessage() {
        return 'مخزون المستلزمات غير متاح لهذه الجلسة. سجّل الدخول إلى خادم RTS المعتمد.';
    }

    function configured() {
        return !!(adapters.isPosSuppliesConfigured && adapters.isPosSuppliesConfigured());
    }

    function load(more) {
        if (state.loading) return Promise.resolve();
        if (!configured()) {
            state.error = unavailableMessage();
            state.loaded = true;
            rerender();
            return Promise.resolve();
        }
        state.loading = true;
        state.error = '';
        var operationGeneration = generation;
        var operationState = state;
        rerender();
        var query = '?auditLimit=50' + (more && state.auditCursor ? '&auditCursor=' + encodeURIComponent(state.auditCursor) : '');
        return adapters.posSupplies('GET', null, query).then(function (data) {
            if (generation !== operationGeneration || state !== operationState) return;
            state.items = Array.isArray(data.items) ? data.items : [];
            state.audit = more ? state.audit.concat(data.audit || []) : (data.audit || []);
            state.auditCursor = data.auditCursor || null;
            state.loaded = true;
        }).catch(function (error) {
            if (generation !== operationGeneration || state !== operationState) return;
            state.error = error && error.message || 'تعذر تحميل مخزون المستلزمات.';
        }).then(function () {
            if (generation !== operationGeneration || state !== operationState) return;
            state.loading = false;
            rerender();
        });
    }

    function activate() {
        if (!state.loaded && !state.loading) load(false);
    }

    function mergeResult(result) {
        var index = state.items.findIndex(function (item) { return item.id === result.item.id; });
        if (index < 0) state.items.push(result.item);
        else state.items[index] = result.item;
        state.items.sort(function (left, right) { return String(left.name).localeCompare(String(right.name), 'ar'); });
        if (result.audit && !state.audit.some(function (entry) { return entry.id === result.audit.id; })) {
            state.audit.unshift(result.audit);
        }
    }

    function submit(action, payload) {
        if (state.saving) return Promise.reject(new Error('انتظر اكتمال العملية الحالية.'));
        if (!configured()) {
            state.error = unavailableMessage();
            rerender();
            return Promise.reject(new Error(state.error));
        }
        var body = Object.assign({}, payload, { action: action, requestId: payload.requestId || requestId() });
        var operationGeneration = generation;
        var operationState = state;
        state.saving = true;
        state.error = '';
        state.message = '';
        rerender();
        return adapters.posSupplies('POST', body).then(function (result) {
            if (generation !== operationGeneration || state !== operationState) {
                throw new Error('تم تبديل المتجر. تجاهلنا استجابة عملية المستلزمات السابقة.');
            }
            mergeResult(result);
            state.message = action === 'use' ? 'تم تسجيل الاستهلاك وتحديث المخزون.' :
                action === 'create' ? 'تم إنشاء المستلزم وحفظ رصيده.' : 'تم تحديث المستلزم وتوثيق العملية.';
            return result;
        }).catch(function (error) {
            if (generation === operationGeneration && state === operationState) {
                state.error = error && error.message || 'تعذر حفظ عملية المستلزمات.';
            }
            throw error;
        }).finally(function () {
            if (generation === operationGeneration && state === operationState) {
                state.saving = false;
                rerender();
            }
        });
    }

    function submitWithRetryIdentity(action, payload, retry) {
        var key = JSON.stringify([action, payload]);
        if (retry.key !== key) {
            retry.key = key;
            retry.requestId = requestId();
        }
        return submit(action, Object.assign({}, payload, { requestId: retry.requestId })).then(function (result) {
            retry.key = '';
            retry.requestId = '';
            return result;
        });
    }

    function status(item) {
        return item.lowStock
            ? '<span class="restaurant-status warning">مخزون منخفض</span>'
            : '<span class="restaurant-status success">متوفر</span>';
    }

    function inventoryRows() {
        if (!state.items.length) return '<div class="restaurant-empty">أضف أول مستلزم تشغيلي مثل الصلصات أو العبوات أو مواد التنظيف.</div>';
        return '<div class="restaurant-supply-list">' + state.items.map(function (item) {
            return '<article class="restaurant-supply-row' + (item.lowStock ? ' low' : '') + '">' +
                '<div><strong>' + esc(item.name) + '</strong><span>' + esc(item.category) + ' · ' + esc(item.unit) + '</span></div>' +
                '<div class="restaurant-supply-quantity"><strong>' + esc(item.quantity) + '</strong><span>حد التنبيه ' + esc(item.lowStockThreshold) + '</span></div>' +
                status(item) +
                '<div class="restaurant-supply-actions"><button class="btn-secondary" data-r-action="supply-use" data-id="' + esc(item.id) + '">استهلاك</button>' +
                '<button class="btn-quiet" data-r-action="supply-adjust" data-id="' + esc(item.id) + '">ضبط الرصيد</button>' +
                '<button class="btn-quiet" data-r-action="supply-threshold" data-id="' + esc(item.id) + '">حد التنبيه</button></div></article>';
        }).join('') + '</div>';
    }

    function auditRows() {
        if (!state.audit.length) return '<div class="restaurant-empty">سيظهر هنا سجل الإنشاء والضبط والاستهلاك.</div>';
        var labels = { create: 'إنشاء', adjust: 'ضبط رصيد', use: 'استهلاك', threshold: 'تحديث حد التنبيه' };
        return '<div class="restaurant-supply-audit">' + state.audit.map(function (entry) {
            var detail = entry.action === 'use'
                ? 'استهلاك ' + entry.quantity + ' · ' + entry.beforeQuantity + ' ← ' + entry.afterQuantity
                : entry.action === 'threshold'
                    ? 'حد التنبيه ' + entry.beforeLowStockThreshold + ' ← ' + entry.lowStockThreshold
                    : 'الرصيد ' + entry.beforeQuantity + ' ← ' + entry.afterQuantity;
            return '<div><span><strong>' + esc(entry.itemName) + '</strong><small>' + esc(labels[entry.action] || entry.action) + ' · ' + esc(detail) + '</small></span>' +
                '<span>' + esc(entry.actor) + '<small>' + esc(entry.actorRole === 'admin' ? 'مدير' : 'موظف') + '</small></span>' +
                '<time datetime="' + esc(entry.timestamp) + '">' + esc(new Date(entry.timestamp).toLocaleString('ar-EG')) + '</time></div>';
        }).join('') + '</div>' + (state.auditCursor ? '<button class="btn-secondary restaurant-audit-more" data-r-action="supplies-more">تحميل سجل أقدم</button>' : '');
    }

    function feedback() {
        if (state.error) return '<div class="restaurant-notice error" role="alert">' + esc(state.error) + '</div>';
        if (state.message) return '<div class="restaurant-notice success" role="status">' + esc(state.message) + '</div>';
        return '';
    }

    function render(mode) {
        if (state.loading && !state.loaded) return '<div class="restaurant-supply-loading" aria-live="polite">جارٍ تحميل مخزون المستلزمات…</div>';
        var low = state.items.filter(function (item) { return item.lowStock; }).length;
        if (mode === 'usage') {
            return '<div class="restaurant-toolbar"><div><h3>الاستهلاك</h3><p>سجّل الكمية المستخدمة باسم الحساب الحالي؛ الخصم يتم على الخادم ولا يرتبط بوصفات القائمة.</p></div>' +
                '<button class="btn-secondary" data-r-action="supplies-refresh"' + (state.loading ? ' disabled' : '') + '>تحديث</button></div>' +
                feedback() + inventoryRows() + '<div class="restaurant-history"><h4>سجل الاستخدام والتعديلات</h4>' + auditRows() + '</div>';
        }
        return '<div class="restaurant-toolbar"><div><h3>مخزون المستلزمات</h3><p>مواد تشغيل منفصلة عن أصناف البيع. ' +
            (low ? '<strong class="restaurant-low-summary">' + low + ' بحاجة لإعادة التوريد.</strong>' : 'لا توجد تنبيهات منخفضة حالياً.') +
            '</p></div><div class="restaurant-toolbar-actions"><button class="btn-secondary" data-r-action="supplies-refresh"' + (state.loading ? ' disabled' : '') + '>تحديث</button>' +
            '<button class="btn-primary" data-r-action="supply-create">+ مستلزم جديد</button></div></div>' + feedback() + inventoryRows();
    }

    function findItem(id) {
        return state.items.find(function (item) { return String(item.id) === String(id); });
    }

    function modal(title, fields, onSubmit) {
        var modalGeneration = generation;
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay restaurant-editor';
        overlay.setAttribute('data-supply-modal', '');
        overlay.style.display = 'flex';
        overlay.innerHTML = '<div class="modal-content" role="dialog" aria-modal="true"><div class="modal-header"><h3>' + esc(title) +
            '</h3><button class="modal-close" type="button" data-s-close>&times;</button></div><form class="modal-body restaurant-form">' +
            fields.map(function (field) {
                return '<label>' + esc(field.label) + '<input name="' + esc(field.name) + '" type="' + esc(field.type || 'text') + '" value="' + esc(field.value || '') + '"' +
                    (field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : '') +
                    (field.required ? ' required' : '') + (field.step ? ' step="' + esc(field.step) + '"' : '') +
                    (field.min != null ? ' min="' + esc(field.min) + '"' : '') + '></label>';
            }).join('') + '<div class="restaurant-inline-error" aria-live="polite"></div><div class="modal-footer"><button class="btn-primary"' +
            (state.saving ? ' disabled' : '') + '>حفظ</button><button type="button" class="btn-secondary" data-s-close>إلغاء</button></div></form></div>';
        document.body.appendChild(overlay);
        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
        overlay.addEventListener('click', function (event) {
            if (event.target === overlay || event.target.closest('[data-s-close]')) close();
        });
        overlay.querySelector('form').addEventListener('submit', function (event) {
            event.preventDefault();
            if (generation !== modalGeneration) {
                overlay.querySelector('.restaurant-inline-error').textContent = 'تم تبديل المتجر. افتح العملية من المتجر الحالي.';
                return;
            }
            var values = {};
            fields.forEach(function (field) { values[field.name] = event.target.elements[field.name].value.trim(); });
            var error = onSubmit(values);
            if (typeof error === 'string') overlay.querySelector('.restaurant-inline-error').textContent = error;
            else Promise.resolve(error).then(close).catch(function (failure) {
                overlay.querySelector('.restaurant-inline-error').textContent = failure && failure.message || 'تعذر حفظ العملية.';
            });
        });
    }

    function handleClick(action, id) {
        if (action === 'supplies-refresh') return load(false);
        if (action === 'supplies-more') return load(true);
        if (action === 'supply-create') {
            var createRetry = {};
            return modal('مستلزم جديد', [
                { name: 'name', label: 'اسم المستلزم', required: true },
                { name: 'category', label: 'النوع', placeholder: 'صلصات، تنظيف، تغليف', required: true },
                { name: 'unit', label: 'وحدة القياس', placeholder: 'كغ، زجاجة، قطعة', required: true },
                { name: 'quantity', label: 'الرصيد الأولي', type: 'number', min: 0, step: '0.001', required: true },
                { name: 'lowStockThreshold', label: 'حد تنبيه المخزون المنخفض', type: 'number', min: 0, step: '0.001', required: true }
            ], function (values) {
                if (!values.name || !values.category || !values.unit) return 'أكمل الاسم والنوع ووحدة القياس.';
                if (!validQuantity(values.quantity) || !validQuantity(values.lowStockThreshold)) return 'استخدم كمية من 0 إلى 999999.999 وبحد أقصى 3 منازل عشرية.';
                return submitWithRetryIdentity('create', values, createRetry);
            });
        }
        var item = findItem(id);
        if (!item) return;
        if (action === 'supply-use') {
            var useRetry = {};
            return modal('تسجيل استهلاك — ' + item.name, [
                { name: 'quantity', label: 'الكمية المستهلكة (' + item.unit + ')', type: 'number', min: 0.001, step: '0.001', required: true }
            ], function (values) {
                if (!validQuantity(values.quantity, true)) return 'أدخل كمية موجبة وبحد أقصى 3 منازل عشرية.';
                if (Number(values.quantity) > Number(item.quantity)) return 'الكمية المستهلكة أكبر من المخزون المتاح.';
                return submitWithRetryIdentity('use', { itemId: item.id, quantity: values.quantity }, useRetry);
            });
        }
        if (action === 'supply-adjust') {
            var adjustRetry = {};
            return modal('ضبط رصيد — ' + item.name, [
                { name: 'quantity', label: 'الرصيد الفعلي (' + item.unit + ')', type: 'number', min: 0, step: '0.001', required: true, value: item.quantity }
            ], function (values) {
                if (!validQuantity(values.quantity)) return 'أدخل رصيداً صالحاً وبحد أقصى 3 منازل عشرية.';
                return submitWithRetryIdentity('adjust', { itemId: item.id, quantity: values.quantity }, adjustRetry);
            });
        }
        if (action === 'supply-threshold') {
            var thresholdRetry = {};
            return modal('حد التنبيه — ' + item.name, [
                { name: 'lowStockThreshold', label: 'نبّه عندما يصل الرصيد إلى', type: 'number', min: 0, step: '0.001', required: true, value: item.lowStockThreshold }
            ], function (values) {
                if (!validQuantity(values.lowStockThreshold)) return 'أدخل حداً صالحاً وبحد أقصى 3 منازل عشرية.';
                return submitWithRetryIdentity('threshold', { itemId: item.id, lowStockThreshold: values.lowStockThreshold }, thresholdRetry);
            });
        }
    }

    return {
        init: setAdapters,
        activate: activate,
        render: render,
        handleClick: handleClick,
        submit: submit,
        submitWithRetryIdentity: submitWithRetryIdentity,
        load: load,
        validQuantity: validQuantity,
        _state: function () { return state; }
    };
}));
