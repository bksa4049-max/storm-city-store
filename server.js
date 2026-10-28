
'use strict';

// Storm City / Secure Discord Permissions API
// Node.js 20+ | No npm dependencies | Render Web Service
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = {
  port: Number(process.env.PORT || 3000),
  site: process.env.FRONTEND_URL || 'https://bksa4049-max.github.io/storm-city-store/',
  app: (process.env.APP_URL || '').replace(/\/$/, ''),
  clientId: process.env.DISCORD_CLIENT_ID || '',
  clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
  owner: process.env.OWNER_DISCORD_ID || '',
  secret: process.env.SESSION_SECRET || '',
  redisUrl: (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, ''),
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || ''
};

const siteUrl = new URL(CONFIG.site);
const origin = siteUrl.origin;
const KEYS = {
  permissions: 'storm:web:permissions:v1',
  products: 'storm:web:products:v1',
  store: 'storm:web:store:v1',
  audit: 'storm:web:audit:v1'
};

const PERMISSIONS = Object.freeze({
  view_permissions: 'عرض صلاحيات الموقع',
  manage_permissions_all: 'إدارة صلاحيات الموقع بالكامل',
  grant_permissions: 'إضافة صلاحيات لشخص',
  manage_store: 'إدارة المتجر',
  manage_products: 'إدارة المنتجات',
  view_audit: 'عرض سجل التغييرات'
});

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function redirect(res, location, cookies = []) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
    ...(cookies.length ? { 'Set-Cookie': cookies } : {})
  });
  res.end();
}

function parseCookies(req) {
  const result = {};
  for (const segment of String(req.headers.cookie || '').split(';')) {
    const i = segment.indexOf('=');
    if (i > -1) {
      result[segment.slice(0, i).trim()] =
        segment.slice(i + 1).trim();
    }
  }
  return result;
}

function validId(id) {
  return /^\d{17,20}$/.test(String(id || ''));
}

async function redis(...args) {
  if (!CONFIG.redisUrl || !CONFIG.redisToken) {
    throw new Error('Upstash Redis not configured');
  }

  const result = await fetch(CONFIG.redisUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.redisToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000)
  });

  const body = await result.json();

  if (
    !result.ok ||
    body.error ||
    !Object.hasOwn(body, 'result')
  ) {
    throw new Error(
      `Redis: ${body.error || result.status}`
    );
  }

  return body.result;
}

function signSession(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    username: String(user.username || '').slice(0, 100),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 3
  })).toString('base64url');

  const mac = crypto.createHmac(
    'sha256',
    CONFIG.secret
  ).update(payload).digest('base64url');

  return `${payload}.${mac}`;
}

function verifySession(token) {
  if (
    !token ||
    token.length > 3000 ||
    !token.includes('.')
  ) {
    return null;
  }

  const [payload, mac, extra] = token.split('.');

  if (
    !payload ||
    !mac ||
    extra !== undefined
  ) {
    return null;
  }

  const expected = crypto.createHmac(
    'sha256',
    CONFIG.secret
  ).update(payload).digest('base64url');

  const a = Buffer.from(mac);
  const b = Buffer.from(expected);

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  ) {
    return null;
  }

  try {
    const user = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );

    if (
      !validId(user.id) ||
      !Number.isSafeInteger(user.exp) ||
      user.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return user;
  } catch {
    return null;
  }
}

function getSession(req) {
  const match = /^Bearer\s+(.+)$/i.exec(
    String(req.headers.authorization || '')
  );

  return verifySession(match?.[1]);
}

async function getRawPermissions(id) {
  if (id === CONFIG.owner) {
    return Object.keys(PERMISSIONS);
  }

  const stored = await redis(
    'HGET',
    KEYS.permissions,
    id
  );

  if (!stored) return [];

  const values = JSON.parse(stored);

  return Array.isArray(values)
    ? values.filter(
        key => Object.hasOwn(PERMISSIONS, key)
      )
    : [];
}

function can(user, key) {
  if (!user) return false;

  if (user.id === CONFIG.owner) {
    return true;
  }

  const perms = user.perms || [];

  if (perms.includes(key)) {
    return true;
  }

  if (
    perms.includes('manage_permissions_all') &&
    ['grant_permissions', 'view_permissions'].includes(key)
  ) {
    return true;
  }

  if (
    perms.includes('grant_permissions') &&
    key === 'view_permissions'
  ) {
    return true;
  }

  return false;
}

async function authorized(req, res) {
  const user = getSession(req);

  if (!user) {
    json(res, 401, {
      error: 'سجّل دخولك باستخدام Discord أولاً.'
    });
    return null;
  }

  user.perms = await getRawPermissions(user.id);
  return user;
}

async function readBody(req) {
  return await new Promise((resolve, reject) => {
    let text = '';

    req.on('data', chunk => {
      text += chunk.toString('utf8');

      if (text.length > 65000) {
        reject(
          Object.assign(
            new Error('Large request'),
            { status: 413 }
          )
        );

        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(JSON.parse(text || '{}'));
      } catch {
        reject(
          Object.assign(
            new Error('Invalid JSON'),
            { status: 400 }
          )
        );
      }
    });

    req.on('error', reject);
  });
}

async function audit(actor, action, subject, details) {
  const record = JSON.stringify({
    by: actor.id,
    action,
    subject,
    details: String(details || '').slice(0, 400),
    at: new Date().toISOString()
  });

  await redis('LPUSH', KEYS.audit, record);
  await redis('LTRIM', KEYS.audit, 0, 199);
}

function mapHgetall(raw) {
  if (raw === null) return {};

  if (!Array.isArray(raw)) {
    return raw || {};
  }

  const result = {};

  for (let i = 0; i < raw.length; i += 2) {
    result[String(raw[i])] = raw[i + 1];
  }

  return result;
}

async function route(req, res) {
  const url = new URL(
    req.url,
    CONFIG.app || 'http://localhost'
  );

  const pathname = url.pathname;
  const method = req.method || 'GET';

  // Health check used by Render.
  if (
    pathname === '/' ||
    pathname === '/health'
  ) {
    return json(res, 200, {
      status: 'Storm City permissions server online'
    });
  }

  // Public JS loaded into GitHub Pages store.
  if (
    pathname === '/permissions.js' &&
    method === 'GET'
  ) {
    const file = fs.readFileSync(
      path.join(__dirname, 'permissions.js'),
      'utf8'
    );

    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
      'X-Content-Type-Options': 'nosniff'
    });

    return res.end(file);
  }

  // Start Discord login.
  if (
    pathname === '/auth/login' &&
    method === 'GET'
  ) {
    const state = crypto.randomBytes(24)
      .toString('base64url');

    const redirectUri =
      `${CONFIG.app}/auth/callback`;

    const oauth = new URL(
      'https://discord.com/oauth2/authorize'
    );

    oauth.searchParams.set(
      'client_id',
      CONFIG.clientId
    );

    oauth.searchParams.set(
      'redirect_uri',
      redirectUri
    );

    oauth.searchParams.set(
      'response_type',
      'code'
    );

    oauth.searchParams.set(
      'scope',
      'identify'
    );

    oauth.searchParams.set(
      'state',
      state
    );

    return redirect(res, oauth.toString(), [
      `storm_oauth_state=${state}; Max-Age=600; Path=/auth; HttpOnly; Secure; SameSite=Lax`
    ]);
  }

  // Discord callback.
  if (
    pathname === '/auth/callback' &&
    method === 'GET'
  ) {
    const expected =
      parseCookies(req).storm_oauth_state;

    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');

    const clear = [
      'storm_oauth_state=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=Lax'
    ];

    if (
      !state ||
      !expected ||
      state !== expected ||
      !code ||
      (
        url.searchParams.has('iss') &&
        url.searchParams.get('iss') !==
          'https://discord.com'
      )
    ) {
      return redirect(
        res,
        `${CONFIG.site}#storm_error=auth`,
        clear
      );
    }

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${CONFIG.app}/auth/callback`
    });

    const basic = Buffer.from(
      `${CONFIG.clientId}:${CONFIG.clientSecret}`
    ).toString('base64');

    const tokenResponse = await fetch(
      'https://discord.com/api/v10/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basic}`
        },
        body: form,
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!tokenResponse.ok) {
      return redirect(
        res,
        `${CONFIG.site}#storm_error=discord`,
        clear
      );
    }

    const token = await tokenResponse.json();

    const userResponse = await fetch(
      'https://discord.com/api/v10/users/@me',
      {
        headers: {
          Authorization:
            `Bearer ${token.access_token}`
        },
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!userResponse.ok) {
      return redirect(
        res,
        `${CONFIG.site}#storm_error=discord`,
        clear
      );
    }

    const user = await userResponse.json();

    if (!validId(user.id)) {
      return redirect(
        res,
        `${CONFIG.site}#storm_error=discord`,
        clear
      );
    }

    // One-time login code.
    const bridge = crypto.randomBytes(30)
      .toString('base64url');

    await redis(
      'SETEX',
      `storm:web:bridge:${bridge}`,
      90,
      JSON.stringify({
        id: user.id,
        username:
          user.global_name || user.username
      })
    );

    return redirect(
      res,
      `${CONFIG.site}#storm_auth=${bridge}`,
      clear
    );
  }

  // CORS for the storefront.
  const requestOrigin = req.headers.origin;

  if (
    requestOrigin &&
    requestOrigin !== origin
  ) {
    return json(res, 403, {
      error:
        'غير مسموح لهذا الموقع بالوصول.'
    });
  }

  res.setHeader(
    'Access-Control-Allow-Origin',
    origin
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  );

  res.setHeader('Vary', 'Origin');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Exchange one-time login code.
  if (
    pathname === '/auth/exchange' &&
    method === 'POST'
  ) {
    const body = await readBody(req);

    if (
      typeof body.code !== 'string' ||
      !/^[A-Za-z0-9_-]{30,70}$/.test(body.code)
    ) {
      return json(res, 400, {
        error: 'رمز التحقق غير صحيح.'
      });
    }

    const saved = await redis(
      'GETDEL',
      `storm:web:bridge:${body.code}`
    );

    if (!saved) {
      return json(res, 401, {
        error:
          'انتهت صلاحية تسجيل الدخول. جرّب مجددًا.'
      });
    }

    return json(res, 200, {
      token: signSession(JSON.parse(saved))
    });
  }

  // Public products.
  if (
    pathname === '/api/products' &&
    method === 'GET'
  ) {
    const saved = await redis(
      'GET',
      KEYS.products
    );

    return json(res, 200, {
      products: saved
        ? JSON.parse(saved)
        : []
    });
  }

  // Public store settings.
  if (
    pathname === '/api/store' &&
    method === 'GET'
  ) {
    const saved = await redis(
      'GET',
      KEYS.store
    );

    return json(res, 200, {
      store: saved
        ? JSON.parse(saved)
        : {
            open: true,
            announcement: ''
          }
    });
  }

  // Current user.
  if (
    pathname === '/api/me' &&
    method === 'GET'
  ) {
    const user = getSession(req);

    if (!user) {
      return json(res, 200, {
        authenticated: false,
        permissions: []
      });
    }

    const perms = await getRawPermissions(
      user.id
    );

    return json(res, 200, {
      authenticated: true,
      user: {
        id: user.id,
        username: user.username
      },
      owner: user.id === CONFIG.owner,
      permissions: perms,
      can: {
        view_permissions:
          can(
            { ...user, perms },
            'view_permissions'
          ),

        grant_permissions:
          can(
            { ...user, perms },
            'grant_permissions'
          ),

        manage_store:
          can(
            { ...user, perms },
            'manage_store'
          ),

        manage_products:
          can(
            { ...user, perms },
            'manage_products'
          ),

        view_audit:
          can(
            { ...user, perms },
            'view_audit'
          )
      }
    });
  }

  // Protected endpoints.
  const user = await authorized(req, res);

  if (!user) return;

  // List permissions.
  if (
    pathname === '/api/permissions' &&
    method === 'GET'
  ) {
    if (!can(user, 'view_permissions')) {
      return json(res, 403, {
        error:
          'لا تملك صلاحية عرض الصلاحيات.'
      });
    }

    const all = mapHgetall(
      await redis('HGETALL', KEYS.permissions)
    );

    const entries = Object.entries(all)
      .map(([id, raw]) => ({
        id,
        permissions: JSON.parse(raw).filter(
          p => Object.hasOwn(PERMISSIONS, p)
        )
      }));

    return json(res, 200, {
      entries,
      definitions: PERMISSIONS
    });
  }

  // Permissions for a specific Discord ID.
  const match =
    /^\/api\/permissions\/(\d{17,20})$/.exec(
      pathname
    );

  if (match) {
    const id = match[1];

    if (!can(user, 'view_permissions')) {
      return json(res, 403, {
        error:
          'لا تملك صلاحية عرض الصلاحيات.'
      });
    }

    if (method === 'GET') {
      return json(res, 200, {
        id,
        permissions:
          await getRawPermissions(id),
        isOwner:
          id === CONFIG.owner
      });
    }

    if (method === 'PUT') {
      if (!can(user, 'grant_permissions')) {
        return json(res, 403, {
          error:
            'لا تملك صلاحية إضافة الصلاحيات.'
        });
      }

      if (id === CONFIG.owner) {
        return json(res, 403, {
          error:
            'لا يمكن تعديل صلاحيات مالك الموقع.'
        });
      }

      const body = await readBody(req);

      if (
        !Array.isArray(body.permissions) ||
        body.permissions.length > 20 ||
        body.permissions.some(
          p =>
            typeof p !== 'string' ||
            !Object.hasOwn(PERMISSIONS, p)
        )
      ) {
        return json(res, 400, {
          error:
            'قائمة الصلاحيات غير صحيحة.'
        });
      }

      const requested = [
        ...new Set(body.permissions)
      ];

      const existing =
        await getRawPermissions(id);

      if (
        user.id !== CONFIG.owner &&
        !can(user, 'manage_permissions_all')
      ) {
        // Staff may only modify permissions
        // they themselves hold.
        const combined = [
          ...new Set([
            ...requested,
            ...existing
          ])
        ];

        if (
          combined.some(
            p => !can(user, p)
          )
        ) {
          return json(res, 403, {
            error:
              'لا يمكنك إعطاء أو تعديل صلاحيات أعلى من صلاحياتك.'
          });
        }
      }

      if (requested.length) {
        await redis(
          'HSET',
          KEYS.permissions,
          id,
          JSON.stringify(requested)
        );
      } else {
        await redis(
          'HDEL',
          KEYS.permissions,
          id
        );
      }

      await audit(
        user,
        'permissions_updated',
        id,
        requested.join(', ') ||
          'all removed'
      );

      return json(res, 200, {
        ok: true,
        id,
        permissions: requested
      });
    }
  }

  // Update store products.
  if (
    pathname === '/api/products' &&
    method === 'PUT'
  ) {
    if (!can(user, 'manage_products')) {
      return json(res, 403, {
        error:
          'لا تملك صلاحية إدارة المنتجات.'
      });
    }

    const body = await readBody(req);

    if (
      !Array.isArray(body.products) ||
      body.products.length > 100
    ) {
      return json(res, 400, {
        error:
          'عدد المنتجات غير صحيح.'
      });
    }

    const list = [];
    const ids = new Set();

    for (const p of body.products) {
      if (
        !p ||
        typeof p !== 'object'
      ) {
        return json(res, 400, {
          error: 'منتج غير صالح.'
        });
      }

      const id = String(
        p.id || ''
      ).trim().toUpperCase();

      const name = String(
        p.name || ''
      ).trim();

      const category = String(
        p.category || 'عام'
      ).trim();

      const description = String(
        p.description || ''
      ).trim();

      const image = String(
        p.image || ''
      ).trim();

      const price = Number(p.price);

      if (
        !/^[A-Z0-9-]{3,30}$/.test(id) ||
        ids.has(id) ||
        name.length < 1 ||
        name.length > 80 ||
        category.length > 50 ||
        !category ||
        description.length > 400 ||
        !Number.isFinite(price) ||
        price < 0 ||
        price > 100000
      ) {
        return json(res, 400, {
          error:
            `بيانات المنتج غير صحيحة: ${id}`
        });
      }

      if (image) {
        try {
          const u = new URL(image);

          if (
            !['https:', 'http:'].includes(
              u.protocol
            ) ||
            image.length > 1000
          ) {
            throw Error();
          }
        } catch {
          return json(res, 400, {
            error:
              `رابط صورة المنتج ${id} غير صحيح.`
          });
        }
      }

      ids.add(id);

      list.push({
        id,
        name,
        category,
        description,
        price,
        image
      });
    }

    await redis(
      'SET',
      KEYS.products,
      JSON.stringify(list)
    );

    await audit(
      user,
      'products_updated',
      'store',
      `${list.length} products`
    );

    return json(res, 200, {
      ok: true,
      products: list
    });
  }

  // Update store settings.
  if (
    pathname === '/api/store' &&
    method === 'PUT'
  ) {
    if (!can(user, 'manage_store')) {
      return json(res, 403, {
        error:
          'لا تملك صلاحية إدارة المتجر.'
      });
    }

    const body = await readBody(req);

    if (
      typeof body.open !== 'boolean' ||
      typeof body.announcement !== 'string' ||
      body.announcement.length > 250
    ) {
      return json(res, 400, {
        error:
          'بيانات المتجر غير صحيحة.'
      });
    }

    const store = {
      open: body.open,
      announcement:
        body.announcement.trim()
    };

    await redis(
      'SET',
      KEYS.store,
      JSON.stringify(store)
    );

    await audit(
      user,
      'store_updated',
      'store',
      JSON.stringify(store)
    );

    return json(res, 200, {
      ok: true,
      store
    });
  }

  // Activity log.
  if (
    pathname === '/api/audit' &&
    method === 'GET'
  ) {
    if (!can(user, 'view_audit')) {
      return json(res, 403, {
        error:
          'لا تملك صلاحية عرض السجل.'
      });
    }

    const lines = await redis(
      'LRANGE',
      KEYS.audit,
      0,
      49
    );

    return json(res, 200, {
      events: (lines || []).map(
        line => JSON.parse(line)
      )
    });
  }

  return json(res, 404, {
    error:
      'الصفحة المطلوبة غير موجودة.'
  });
}

// =====================================
// Check environment variables
// =====================================

if (
  !CONFIG.app ||
  !/^https:\/\//.test(CONFIG.app) ||
  !CONFIG.clientId ||
  !CONFIG.clientSecret ||
  !validId(CONFIG.owner) ||
  CONFIG.secret.length < 32 ||
  !CONFIG.redisUrl ||
  !CONFIG.redisToken
) {
  console.error(
    '❌ Missing env: APP_URL, DISCORD_CLIENT_ID, ' +
    'DISCORD_CLIENT_SECRET, OWNER_DISCORD_ID, ' +
    'SESSION_SECRET (32+ chars), ' +
    'UPSTASH_REDIS_REST_URL, ' +
    'UPSTASH_REDIS_REST_TOKEN'
  );

  process.exit(1);
}

// =====================================
// Start server
// =====================================

http.createServer((req, res) => {
  route(req, res).catch(error => {
    console.error(
      '❌ Storm Permissions Server:',
      error
    );

    if (!res.headersSent) {
      json(
        res,
        error.status || 500,
        {
          error:
            'حدث خطأ في الخادم. راجع Logs.'
        }
      );
    } else {
      res.end();
    }
  });

}).listen(
  CONFIG.port,
  '0.0.0.0',
  () => {
    console.log(
      `✅ Storm City Permissions API running on ${CONFIG.port}`
    );
  }
);
