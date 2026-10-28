
(function () {
  'use strict';

  const API = new URL(document.currentScript.src).origin;
  const TOKEN_KEY = 'storm-web-auth';

  let token = sessionStorage.getItem(TOKEN_KEY) || '';
  let account = null;
  let products = [];
  let store = {
    open: true,
    announcement: ''
  };
  let definitions = {};

  // =====================================
  // تصميم لوحة الصلاحيات
  // =====================================

  const style = document.createElement('style');

  style.textContent = `
    #storm-login {
      background: #1053bf;
      color: white;
      border: 1px solid #297fff;
      padding: 11px 15px;
      border-radius: 10px;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
    }

    .storm-admin-link {
      color: #58aaff !important;
      font-weight: bold;
      cursor: pointer;
    }

    #storm-modal {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(0,0,0,.85);
      align-items: center;
      justify-content: center;
      padding: 15px;
      direction: rtl;
    }

    #storm-modal.open {
      display: flex;
    }

    .storm-window {
      width: min(700px,100%);
      max-height: 92vh;
      overflow: auto;
      background: #0c1424;
      color: #f1f6ff;
      border: 1px solid #2867bb;
      border-radius: 17px;
      font-family: Tahoma,Arial,sans-serif;
      box-shadow: 0 20px 70px #000b;
    }

    .storm-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 15px;
      padding: 20px;
      border-bottom: 1px solid #263a59;
    }

    .storm-head h2 {
      margin: 0;
      font-size: 20px;
    }

    .storm-body {
      padding: 20px;
      max-height: 75vh;
      overflow: auto;
    }

    .storm-label {
      display: block;
      margin: 15px 0 7px;
      font-weight: bold;
      font-size: 13px;
    }

    .storm-input {
      width: 100%;
      padding: 13px;
      border-radius: 9px;
      background: #080f1d;
      color: white;
      border: 1px solid #29466d;
      font-family: inherit;
      outline: none;
      box-sizing: border-box;
    }

    .storm-input:focus {
      border-color: #2788ff;
    }

    .storm-btn {
      padding: 11px 17px;
      border: none;
      border-radius: 9px;
      color: white;
      background: #1768dd;
      font-family: inherit;
      font-weight: bold;
      cursor: pointer;
    }

    .storm-btn:disabled {
      opacity: .45;
      cursor: not-allowed;
    }

    .storm-btn.gray {
      background: #293b57;
    }

    .storm-btn.red {
      background: #a32d40;
    }

    .storm-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 18px;
    }

    .storm-card {
      border: 1px solid #263e60;
      border-radius: 11px;
      padding: 15px;
      margin: 12px 0;
      background: #111f35;
    }

    .storm-check {
      display: flex;
      gap: 12px;
      padding: 14px;
      margin: 9px 0;
      border: 1px solid #253f62;
      border-radius: 10px;
      background: #101d30;
      cursor: pointer;
      align-items: flex-start;
    }

    .storm-check input {
      width: 20px;
      height: 20px;
      accent-color: #2385ff;
      flex-shrink: 0;
    }

    .storm-check strong {
      display: block;
      font-size: 13px;
    }

    .storm-check small {
      color: #91a9ca;
      font-size: 11px;
    }

    .storm-hint {
      color: #9cb0cb;
      font-size: 13px;
      line-height: 1.9;
    }

    .storm-status {
      margin-top: 15px;
      color: #83baff;
      font-size: 13px;
    }

    .storm-error {
      color: #ff8c9a;
    }

    .storm-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    #storm-notice {
      display: none;
      background: #102e56;
      color: #dceeff;
      padding: 12px;
      text-align: center;
      border-bottom: 1px solid #2566b2;
    }

    @media (max-width: 600px) {
      .storm-grid {
        grid-template-columns: 1fr;
      }

      .storm-body {
        padding: 15px;
      }
    }
  `;

  document.head.appendChild(style);

  // =====================================
  // الأدوات
  // =====================================

  const $ = selector => document.querySelector(selector);

  function button(label, callback, variant = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `storm-btn ${variant}`;
    btn.textContent = label;
    btn.addEventListener('click', callback);
    return btn;
  }

  function can(permission) {
    return Boolean(
      account &&
      (
        account.owner ||
        account.can?.[permission]
      )
    );
  }

  function message(text, error = false) {
    const target = $('#storm-status');

    if (!target) {
      if (error) alert(text);
      return;
    }

    target.textContent = text;
    target.className =
      error
        ? 'storm-status storm-error'
        : 'storm-status';
  }

  async function request(endpoint, options = {}) {
    const headers = {
      Accept: 'application/json'
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(API + endpoint, {
      method: options.method || 'GET',
      headers,
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body)
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || 'حدث خطأ أثناء تنفيذ الطلب.'
      );
    }

    return result;
  }

  // =====================================
  // نافذة الإدارة
  // =====================================

  const modal = document.createElement('div');
  modal.id = 'storm-modal';

  modal.innerHTML = `
    <div class="storm-window"
         role="dialog"
         aria-modal="true">

      <div class="storm-head">
        <h2 id="storm-title">الصلاحيات</h2>
        <button
          class="storm-btn gray"
          id="storm-close">
          إغلاق ✕
        </button>
      </div>

      <div class="storm-body"
           id="storm-content">
      </div>

    </div>
  `;

  document.body.appendChild(modal);

  function open(title, html) {
    $('#storm-title').textContent = title;
    $('#storm-content').innerHTML = html;
    modal.classList.add('open');
  }

  function close() {
    modal.classList.remove('open');
  }

  $('#storm-close').onclick = close;

  modal.onclick = event => {
    if (event.target === modal) close();
  };

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });

  // =====================================
  // تسجيل الدخول بديسكورد
  // =====================================

  const login = document.createElement('button');
  login.id = 'storm-login';
  login.textContent = 'تسجيل دخول Discord';

  login.onclick = () => {
    if (account) {
      sessionStorage.removeItem(TOKEN_KEY);
      token = '';
      account = null;
      updateNavigation();
      alert('تم تسجيل الخروج.');
    } else {
      location.href = API + '/auth/login';
    }
  };

  const header =
    document.querySelector('.header-actions') ||
    document.querySelector('header') ||
    document.body;

  header.appendChild(login);

  // =====================================
  // شريط الصلاحيات
  // =====================================

  const nav =
    document.querySelector('nav') ||
    document.querySelector('.header') ||
    document.body;

  const permissionsLink = document.createElement('a');

  permissionsLink.textContent = '🔐 الصلاحيات';
  permissionsLink.href = '#permissions';
  permissionsLink.className = 'storm-admin-link';
  permissionsLink.hidden = true;
  permissionsLink.style.display = 'none';

  permissionsLink.onclick = event => {
    event.preventDefault();
    showPermissions();
  };

  nav.appendChild(permissionsLink);

  // =====================================
  // شريط لوحة الإدارة
  // =====================================

  const adminLink = document.createElement('a');

  adminLink.textContent = '⚙️ لوحة الإدارة';
  adminLink.href = '#store-admin';
  adminLink.className = 'storm-admin-link';
  adminLink.hidden = true;
  adminLink.style.display = 'none';

  adminLink.onclick = event => {
    event.preventDefault();
    showAdmin();
  };

  nav.appendChild(adminLink);

  const banner = document.createElement('div');
  banner.id = 'storm-notice';

  (document.querySelector('header') || document.body)
    .after(banner);

  function updateNavigation() {
    login.textContent = account
      ? `خروج (${account.user.username})`
      : 'تسجيل دخول Discord';

    permissionsLink.hidden =
      !can('view_permissions');

    permissionsLink.style.display =
      permissionsLink.hidden ? 'none' : '';

    adminLink.hidden = !(
      can('manage_store') ||
      can('manage_products') ||
      can('view_audit')
    );

    adminLink.style.display =
      adminLink.hidden ? 'none' : '';
  }

  async function refreshAccount() {
    if (!token) {
      account = null;
      updateNavigation();
      return;
    }

    try {
      const result = await request('/api/me');

      if (!result.authenticated) {
        sessionStorage.removeItem(TOKEN_KEY);
        token = '';
        account = null;
      } else {
        account = result;
      }
    } catch (error) {
      console.error(error);
      account = null;
    }

    updateNavigation();
  }

  // =====================================
  // تحميل المنتجات والإعدادات
  // =====================================

  async function refreshStore() {
    try {
      const [p, s] = await Promise.all([
        request('/api/products'),
        request('/api/store')
      ]);

      products = Array.isArray(p.products)
        ? p.products
        : [];

      store = s.store || {
        open: true,
        announcement: ''
      };

      // تحديث متجر Storm City الأصلي
      if (
        typeof PRODUCTS !== 'undefined' &&
        Array.isArray(PRODUCTS)
      ) {
        PRODUCTS.splice(
          0,
          PRODUCTS.length,
          ...products
        );

        if (typeof renderCategories === 'function') {
          renderCategories();
        }

        if (typeof renderProducts === 'function') {
          renderProducts();
        }

        if (typeof renderCart === 'function') {
          renderCart();
        }
      }

      const notes = [];

      if (!store.open) {
        notes.push('🚫 المتجر مغلق مؤقتًا');
      }

      if (store.announcement) {
        notes.push(store.announcement);
      }

      banner.textContent = notes.join(' | ');
      banner.style.display =
        notes.length ? 'block' : 'none';

    } catch (error) {
      console.error(
        'Storm Store Error:',
        error
      );
    }
  }

  // منع الإضافة للسلة عند إغلاق المتجر
  if (typeof window.addToCart === 'function') {
    const original = window.addToCart;

    window.addToCart = function (id) {
      if (!store.open) {
        alert('المتجر مغلق حاليًا.');
        return;
      }

      return original(id);
    };
  }

  // =====================================
  // شاشة قائمة الصلاحيات
  // =====================================

  async function showPermissions() {
    if (!can('view_permissions')) return;

    open('🔐 صلاحيات الموقع', `
      <p class="storm-hint">
        أدخل Discord ID للشخص الذي تريد
        إعطاءه صلاحيات في الموقع.
      </p>

      <label class="storm-label">
        Discord ID
      </label>

      <input
        id="storm-user-id"
        class="storm-input"
        inputmode="numeric"
        maxlength="20"
        placeholder="اكتب آيدي الشخص هنا"
      >

      <div class="storm-actions"
           id="storm-next"></div>

      <div id="storm-status"></div>

      <h3 style="margin-top:25px">
        الأشخاص الذين لديهم صلاحيات
      </h3>

      <div id="storm-users"
           class="storm-hint">
        جاري التحميل...
      </div>
    `);

    $('#storm-next').appendChild(
      button('التالي ←', () => {
        const id = $('#storm-user-id').value.trim();
        nextPermissions(id);
      })
    );

    try {
      const result = await request(
        '/api/permissions'
      );

      definitions = result.definitions || {};

      const list = $('#storm-users');
      list.innerHTML = '';

      if (!result.entries?.length) {
        list.textContent =
          'لا يوجد أشخاص مضافون حاليًا.';
        return;
      }

      result.entries.forEach(user => {
        const card = document.createElement('div');
        card.className = 'storm-card';

        const id = document.createElement('strong');
        id.textContent = user.id;

        const desc = document.createElement('p');
        desc.className = 'storm-hint';
        desc.textContent = (
          user.permissions || []
        ).map(
          key => definitions[key] || key
        ).join('، ');

        card.append(id, desc);

        card.appendChild(
          button('عرض / تعديل', () => {
            nextPermissions(user.id);
          })
        );

        list.appendChild(card);
      });

    } catch (error) {
      message(error.message, true);
    }
  }

  // =====================================
  // الخطوة التالية: اختيار الصلاحيات
  // =====================================

  async function nextPermissions(discordId) {
    if (!/^\d{17,20}$/.test(discordId)) {
      message(
        '❌ اكتب Discord ID صحيحًا.',
        true
      );
      return;
    }

    try {
      const result = await request(
        '/api/permissions/' + discordId
      );

      const editable =
        can('grant_permissions') &&
        !result.isOwner;

      const limited =
        !account.owner &&
        !account.permissions.includes(
          'manage_permissions_all'
        );

      open('تحديد الصلاحيات', `
        <p class="storm-hint">
          الصلاحيات الخاصة بالحساب:
          <strong>${discordId}</strong>
        </p>

        <div id="storm-checkboxes"></div>

        <div class="storm-actions"
             id="storm-save-actions"></div>

        <div id="storm-status"></div>
      `);

      const root = $('#storm-checkboxes');

      for (const [key, label] of Object.entries(definitions)) {
        const row = document.createElement('label');
        row.className = 'storm-check';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.permission = key;

        checkbox.checked = (
          result.permissions || []
        ).includes(key);

        checkbox.disabled =
          !editable ||
          (
            limited &&
            !account.permissions.includes(key)
          );

        const info = document.createElement('span');

        const title = document.createElement('strong');
        title.textContent = label;

        const desc = document.createElement('small');
        desc.textContent =
          key === 'manage_permissions_all'
            ? 'يمكنه إدارة جميع صلاحيات المستخدمين عدا المالك.'
            : key === 'grant_permissions'
              ? 'يمكنه منح صلاحيات ضمن حدود صلاحياته.'
              : 'يمكن تفعيل أو إلغاء هذه الصلاحية.';

        info.append(title, desc);
        row.append(checkbox, info);
        root.appendChild(row);
      }

      const actions = $('#storm-save-actions');

      actions.appendChild(
        button('رجوع', showPermissions, 'gray')
      );

      if (editable) {
        actions.appendChild(
          button('حفظ الصلاحيات', async () => {
            const chosen = [
              ...document.querySelectorAll(
                '#storm-checkboxes input:checked'
              )
            ].map(
              element => element.dataset.permission
            );

            try {
              await request(
                '/api/permissions/' + discordId,
                {
                  method: 'PUT',
                  body: {
                    permissions: chosen
                  }
                }
              );

              message(
                '✅ تم حفظ الصلاحيات بنجاح.'
              );

            } catch (error) {
              message(error.message, true);
            }
          })
        );

        actions.appendChild(
          button('سحب جميع الصلاحيات', async () => {
            if (!confirm(
              'هل أنت متأكد من سحب جميع الصلاحيات؟'
            )) return;

            try {
              await request(
                '/api/permissions/' + discordId,
                {
                  method: 'PUT',
                  body: {
                    permissions: []
                  }
                }
              );

              root.querySelectorAll('input')
                .forEach(input => {
                  input.checked = false;
                });

              message(
                '✅ تم سحب جميع الصلاحيات.'
              );

            } catch (error) {
              message(error.message, true);
            }
          }, 'red')
        );
      }

    } catch (error) {
      message(error.message, true);
    }
  }

  // =====================================
  // لوحة إدارة المتجر
  // =====================================

  async function showAdmin() {
    if (!account) return;

    if (!(
      can('manage_store') ||
      can('manage_products') ||
      can('view_audit')
    )) return;

    open('⚙️ لوحة إدارة Storm City', `
      <p class="storm-hint">
        هذه اللوحة خاصة بإدارة متجر Storm City.
      </p>

      <div class="storm-actions"
           id="storm-admin-buttons"></div>

      <div id="storm-admin-content"></div>

      <div id="storm-status"></div>
    `);

    const actions = $('#storm-admin-buttons');

    if (can('manage_store')) {
      actions.appendChild(
        button(
          'إدارة المتجر',
          showStoreSettings
        )
      );
    }

    if (can('manage_products')) {
      actions.appendChild(
        button(
          'إدارة المنتجات',
          showProductSettings
        )
      );
    }

    if (can('view_audit')) {
      actions.appendChild(
        button(
          'سجل التغييرات',
          showAudit
        )
      );
    }

    if (can('manage_products')) {
      showProductSettings();
    } else if (can('manage_store')) {
      showStoreSettings();
    } else {
      showAudit();
    }
  }

  // =====================================
  // إعدادات المتجر
  // =====================================

  function showStoreSettings() {
    const area = $('#storm-admin-content');

    if (!area) return;

    area.innerHTML = `
      <div class="storm-card">

        <h3>إعدادات المتجر</h3>

        <label class="storm-check">
          <input type="checkbox"
                 id="storm-open">

          <span>
            <strong>المتجر مفتوح</strong>
            <small>
              يمكنك إيقاف استقبال الإضافات للسلة.
            </small>
          </span>
        </label>

        <label class="storm-label">
          إعلان المتجر
        </label>

        <textarea
          class="storm-input"
          id="storm-announcement"
          maxlength="250"
          rows="3"></textarea>

        <div class="storm-actions"
             id="storm-settings-actions"></div>

      </div>
    `;

    $('#storm-open').checked = Boolean(store.open);

    $('#storm-announcement').value =
      store.announcement || '';

    $('#storm-settings-actions').appendChild(
      button('حفظ إعدادات المتجر', async () => {
        try {
          await request('/api/store', {
            method: 'PUT',
            body: {
              open: $('#storm-open').checked,
              announcement:
                $('#storm-announcement').value
            }
          });

          await refreshStore();

          message('✅ تم حفظ إعدادات المتجر.');

        } catch (error) {
          message(error.message, true);
        }
      })
    );
  }

  // =====================================
  // إدارة المنتجات
  // =====================================

  function showProductSettings() {
    const area = $('#storm-admin-content');

    if (!area) return;

    area.innerHTML = `
      <div class="storm-card">
        <h3>إضافة / تعديل منتج</h3>

        <div class="storm-grid">
          <div>
            <label class="storm-label">كود المنتج</label>
            <input class="storm-input"
                   id="storm-product-id"
                   placeholder="SC-001">
          </div>

          <div>
            <label class="storm-label">اسم المنتج</label>
            <input class="storm-input"
                   id="storm-product-name">
          </div>

          <div>
            <label class="storm-label">السعر بالدولار</label>
            <input class="storm-input"
                   id="storm-product-price"
                   type="number"
                   min="0"
                   step="0.01">
          </div>

          <div>
            <label class="storm-label">القسم</label>
            <input class="storm-input"
                   id="storm-product-category"
                   value="عام">
          </div>
        </div>

        <label class="storm-label">وصف المنتج</label>
        <textarea class="storm-input"
                  id="storm-product-description"
                  rows="3"></textarea>

        <label class="storm-label">رابط الصورة (اختياري)</label>
        <input class="storm-input"
               id="storm-product-image"
               placeholder="https://...">

        <div class="storm-actions"
             id="storm-product-actions"></div>
      </div>

      <h3>المنتجات الحالية</h3>

      <div id="storm-product-list"></div>
    `;

    function fillForm(product = {}) {
      $('#storm-product-id').value =
        product.id || '';

      $('#storm-product-name').value =
        product.name || '';

      $('#storm-product-price').value =
        product.price ?? 0;

      $('#storm-product-category').value =
        product.category || 'عام';

      $('#storm-product-description').value =
        product.description || '';

      $('#storm-product-image').value =
        product.image || '';
    }

    $('#storm-product-actions').appendChild(
      button('حفظ المنتج', async () => {
        const product = {
          id: $('#storm-product-id').value
            .trim()
            .toUpperCase(),

          name:
            $('#storm-product-name').value.trim(),

          price:
            Number($('#storm-product-price').value),

          category:
            $('#storm-product-category').value.trim(),

          description:
            $('#storm-product-description').value.trim(),

          image:
            $('#storm-product-image').value.trim()
        };

        if (
          !/^[A-Z0-9-]{3,30}$/.test(product.id) ||
          !product.name ||
          !product.category ||
          !Number.isFinite(product.price) ||
          product.price < 0
        ) {
          message(
            '❌ تحقق من كود المنتج والاسم والقسم والسعر.',
            true
          );
          return;
        }

        const updated = products
          .filter(p => p.id !== product.id)
          .concat(product);

        try {
          await request('/api/products', {
            method: 'PUT',
            body: {
              products: updated
            }
          });

          await refreshStore();
          renderProductsList();
          fillForm();

          message('✅ تم حفظ المنتج.');

        } catch (error) {
          message(error.message, true);
        }
      })
    );

    $('#storm-product-actions').appendChild(
      button('تفريغ الخانات', () => fillForm(), 'gray')
    );

    function renderProductsList() {
      const list = $('#storm-product-list');
      list.innerHTML = '';

      if (!products.length) {
        list.textContent = 'لا توجد منتجات حاليًا.';
        return;
      }

      products.forEach(product => {
        const card = document.createElement('div');
        card.className = 'storm-card';

        const title = document.createElement('strong');
        title.textContent =
          `${product.id} | ${product.name} | $${product.price}`;

        const actions = document.createElement('div');
        actions.className = 'storm-actions';

        actions.appendChild(
          button('تعديل', () => {
            fillForm(product);
          })
        );

        actions.appendChild(
          button('حذف', async () => {
            if (!confirm(
              `هل تريد حذف ${product.name}؟`
            )) return;

            try {
              const updated = products.filter(
                p => p.id !== product.id
              );

              await request('/api/products', {
                method: 'PUT',
                body: {
                  products: updated
                }
              });

              await refreshStore();
              renderProductsList();

              message('✅ تم حذف المنتج.');

            } catch (error) {
              message(error.message, true);
            }
          }, 'red')
        );

        card.append(title, actions);
        list.appendChild(card);
      });
    }

    renderProductsList();
  }

  // =====================================
  // سجل تعديلات الموقع
  // =====================================

  async function showAudit() {
    const area = $('#storm-admin-content');

    if (!area) return;

    area.textContent = 'جاري تحميل السجل...';

    try {
      const result = await request('/api/audit');

      area.innerHTML = '<h3>سجل التغييرات</h3>';

      if (!result.events?.length) {
        area.append('لا توجد عمليات مسجلة.');
      }

      for (const event of result.events || []) {
        const card = document.createElement('div');
        card.className = 'storm-card';

        card.textContent =
          `${event.action} | بواسطة ${event.by} | ` +
          `${event.subject} | ${event.at}`;

        area.appendChild(card);
      }

    } catch (error) {
      area.textContent = error.message;
    }
  }

  // =====================================
  // إكمال تسجيل الدخول من Discord
  // =====================================

  async function handleDiscordLogin() {
    const hash = location.hash;

    if (
      !hash.startsWith('#storm_auth=') &&
      !hash.startsWith('#storm_error=')
    ) {
      return;
    }

    const code = hash.slice(
      hash.indexOf('=') + 1
    );

    history.replaceState(
      null,
      '',
      location.pathname + location.search
    );

    if (hash.startsWith('#storm_error=')) {
      alert('❌ تعذر تسجيل الدخول بديسكورد.');
      return;
    }

    try {
      const result = await request(
        '/auth/exchange',
        {
          method: 'POST',
          body: { code }
        }
      );

      token = result.token;

      sessionStorage.setItem(
        TOKEN_KEY,
        token
      );

      await refreshAccount();

      alert('✅ تم تسجيل الدخول بحساب Discord.');

    } catch (error) {
      alert(error.message);
    }
  }

  // =====================================
  // تشغيل نظام الصلاحيات
  // =====================================

  (async () => {
    await handleDiscordLogin();

    await Promise.all([
      refreshAccount(),
      refreshStore()
    ]);

    updateNavigation();
  })();

})();
