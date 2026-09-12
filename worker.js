const SAMPLE = [
  {
    id: 1,
    title: "Sāmaro maṅgala rūpa nidhāna",
    type: "Kirtan",
    raag: "देवगंधार",
    original_text:
      "सामरो मंगल रूप निधान ॥\nजा दिनतें हरि गोकुल प्रगटे दिन दिन होत कल्यान ॥",
    translate_text:
      "The dark-hued One is the treasury of an auspicious form. From the day Hari appeared in Gokul, auspiciousness increases day by day.",
    transliterate_text:
      "Sāmaro maṅgala rūpa nidhāna. Jā dinateṃ Hari Gokula pragaṭe, dina dina hota kalyāna.",
    image: "",
    verified: 1,
  },
];

let staticKirtansPromise;
let revisionTablePromise;
let contributorTablesPromise;
const PUBLIC_KIRTAN_DATA_PATH = "/data/kirtans-full.json";
const QUERY_CACHE_TTL_MS = 30 * 1000;

const json = (x, status = 200) =>
  new Response(JSON.stringify(x), {
    status,
    headers: {
      "content-type": "application/json;charset=utf-8",
    },
  });

const cachedJson = (x, status = 200, maxAge = 300) =>
  new Response(JSON.stringify(x), {
    status,
    headers: {
      "content-type": "application/json;charset=utf-8",
      "cache-control": `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400`,
    },
  });

const ADMIN_COOKIE = "pk_admin";
const CONTRIBUTOR_COOKIE = "pk_contributor";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LIMIT_MAX = 8;
const LOGIN_CHALLENGE_ACTION = "admin-login";
const LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60;
const LOGIN_CHALLENGE_DIFFICULTY = 3;
const SOCIAL_IMAGE_WIDTH = 1200;
const SOCIAL_IMAGE_HEIGHT = 630;
const SOCIAL_IMAGE_QUALITY = 72;
const SOCIAL_DESCRIPTION_MAX_LENGTH = 520;
const loginAttempts = new Map();
const queryCache = new Map();

function readQueryCache(key) {
  const row =
    queryCache.get(key);

  if (!row) {
    return null;
  }

  if (Date.now() - row.at > QUERY_CACHE_TTL_MS) {
    queryCache.delete(key);
    return null;
  }

  return row.data;
}

function writeQueryCache(key, data) {
  if (queryCache.size > 100) {
    queryCache.clear();
  }

  queryCache.set(key, {
    at: Date.now(),
    data,
  });

  return data;
}

function clearQueryCache() {
  queryCache.clear();
}

const EDITABLE_COLUMNS = [
  "title",
  "type",
  "raag",
  "original_text",
  "translate_text",
  "transliterate_text",
  "image",
  "verified",
];

const CONTRIBUTOR_EDITABLE_COLUMNS = [
  "original_text",
  "translate_text",
];

const KIRTAN_COLUMNS = [
  "id",
  "created_date",
  "updated_date",
  "title",
  "type",
  "raag",
  "original_text",
  "translate_text",
  "transliterate_text",
  "image",
  "verified",
];

const REVISION_COLUMNS = [
  "id",
  "kirtan_id",
  "snapshot_json",
  "changed_fields",
  "created_at",
  "created_by",
  "action",
];

const CONTRIBUTOR_COLUMNS = [
  "id",
  "username",
  "password_hash",
  "active",
  "created_at",
  "updated_at",
  "created_by",
];

const CONTRIBUTION_COLUMNS = [
  "id",
  "kirtan_id",
  "contributor_id",
  "contributor_username",
  "base_snapshot_json",
  "proposed_json",
  "changed_fields",
  "status",
  "created_at",
  "updated_at",
  "reviewed_at",
  "reviewed_by",
  "admin_note",
];

const text = (value, status = 200, headers = {}) =>
  new Response(value, {
    status,
    headers: {
      "content-type": "text/plain;charset=utf-8",
      ...headers,
    },
  });

const unauthorized = () =>
  json({ error: "Unauthorized" }, 401);

function base64UrlEncode(bytes) {
  const bin =
    typeof bytes === "string"
      ? String.fromCharCode(...new TextEncoder().encode(bytes))
      : String.fromCharCode(...new Uint8Array(bytes));

  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);

  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function base64Decode(value) {
  const bin = atob(value);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function parsePasswordHash(stored) {
  const parts = String(stored || "").trim().split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") {
    return null;
  }

  const iterations = Number(parts[1]);
  if (
    !Number.isFinite(iterations) ||
    iterations < 100000 ||
    iterations > 100000
  ) {
    return null;
  }

  try {
    return {
      iterations,
      salt: base64Decode(parts[2]),
      expected: base64Decode(parts[3]),
    };
  } catch {
    return null;
  }
}

function timingSafeEqual(a, b) {
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = left.length ^ right.length;
  const len = Math.max(left.length, right.length);

  for (let i = 0; i < len; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }

  return diff === 0;
}

async function hmac(secret, value) {
  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

  return crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
}

async function signSession(env, payload) {
  if (!env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is not configured");
  }

  const body =
    base64UrlEncode(
      JSON.stringify(payload)
    );

  const sig =
    base64UrlEncode(
      await hmac(env.SESSION_SECRET, body)
    );

  return `${body}.${sig}`;
}

async function verifySession(env, token) {
  if (!token || !env.SESSION_SECRET) {
    return null;
  }

  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected =
    base64UrlEncode(
      await hmac(env.SESSION_SECRET, body)
    );

  if (
    !timingSafeEqual(
      new TextEncoder().encode(sig),
      new TextEncoder().encode(expected)
    )
  ) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(
        base64UrlDecode(body)
      )
    );
  } catch {
    return null;
  }

  if (
    !payload.role ||
    !payload.exp ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return payload;
}

function getCookie(req, name) {
  const header = req.headers.get("cookie") || "";

  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function requireAdmin(req, env) {
  const session =
    await verifySession(
      env,
      getCookie(req, ADMIN_COOKIE)
    );

  return session?.role === "admin" ? session : null;
}

async function requireContributor(req, env) {
  const session =
    await verifySession(
      env,
      getCookie(req, CONTRIBUTOR_COOKIE)
    );

  return session?.role === "contributor" ? session : null;
}

function setSessionCookie(name, token) {
  return `${name}=${token}; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

function clearSessionCookie(name) {
  return `${name}=; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

function setAdminSessionCookie(token) {
  return setSessionCookie(
    ADMIN_COOKIE,
    token
  );
}

function clearAdminSessionCookie() {
  return clearSessionCookie(ADMIN_COOKIE);
}

function setContributorSessionCookie(token) {
  return setSessionCookie(
    CONTRIBUTOR_COOKIE,
    token
  );
}

function clearContributorSessionCookie() {
  return clearSessionCookie(CONTRIBUTOR_COOKIE);
}

function sqlIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insertStatement(table, columns, row) {
  return `INSERT INTO ${sqlIdent(table)} (${columns.map(sqlIdent).join(", ")}) VALUES (${columns.map((column) => sqlLiteral(row[column])).join(", ")});`;
}

function csvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return `"${String(value).replace(/"/g, '""')}"`;
}

function csvRow(columns, row) {
  return columns
    .map((column) =>
      csvValue(
        column === "verified"
          ? dbVerified(Boolean(row[column]))
          : row[column]
      )
    )
    .join(",");
}

async function verifyPassword(password, stored) {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;

  const keyMaterial =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

  const derived =
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: parsed.salt,
        iterations: parsed.iterations,
      },
      keyMaterial,
      parsed.expected.length * 8
    );

  return timingSafeEqual(derived, parsed.expected);
}

async function hashPassword(password) {
  const salt =
    new Uint8Array(16);

  crypto.getRandomValues(salt);

  const keyMaterial =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

  const derived =
    new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt,
          iterations: 100000,
        },
        keyMaterial,
        32 * 8
      )
    );

  return `pbkdf2:100000:${btoa(String.fromCharCode(...salt))}:${btoa(String.fromCharCode(...derived))}`;
}

function loginKey(req) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for") ||
    "unknown"
  ).split(",")[0].trim();
}

function isLoginLimited(req) {
  const key = loginKey(req);
  const now = Date.now();
  const row =
    loginAttempts.get(key) || {
      count: 0,
      first: now,
    };

  if (now - row.first > LOGIN_LIMIT_WINDOW_MS) {
    loginAttempts.set(key, {
      count: 0,
      first: now,
    });
    return false;
  }

  return row.count >= LOGIN_LIMIT_MAX;
}

function recordLoginFailure(req) {
  const key = loginKey(req);
  const now = Date.now();
  const row =
    loginAttempts.get(key) || {
      count: 0,
      first: now,
    };

  if (now - row.first > LOGIN_LIMIT_WINDOW_MS) {
    loginAttempts.set(key, {
      count: 1,
      first: now,
    });
    return;
  }

  row.count += 1;
  loginAttempts.set(key, row);
}

function recordLoginSuccess(req) {
  loginAttempts.delete(loginKey(req));
}

function randomChallengeNonce() {
  const bytes =
    new Uint8Array(16);

  crypto.getRandomValues(bytes);

  return base64UrlEncode(bytes);
}

async function createLoginChallenge(req, env) {
  if (!env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is not configured");
  }

  const body =
    base64UrlEncode(
      JSON.stringify({
        action: LOGIN_CHALLENGE_ACTION,
        key: loginKey(req),
        nonce: randomChallengeNonce(),
        exp:
          Math.floor(Date.now() / 1000) +
          LOGIN_CHALLENGE_TTL_SECONDS,
      })
    );

  const sig =
    base64UrlEncode(
      await hmac(env.SESSION_SECRET, body)
    );

  return `${body}.${sig}`;
}

async function sha256Hex(value) {
  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value)
    );

  return Array.from(
    new Uint8Array(hash),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

async function verifyLoginChallenge(req, env, challengeToken, challengeNonce) {
  if (
    typeof challengeToken !== "string" ||
    challengeToken.length > 1024 ||
    typeof challengeNonce !== "string" ||
    !/^\d{1,16}$/.test(challengeNonce)
  ) {
    return false;
  }

  const [body, sig] =
    challengeToken.split(".");

  if (!body || !sig) {
    return false;
  }

  const expected =
    base64UrlEncode(
      await hmac(env.SESSION_SECRET, body)
    );

  if (
    !timingSafeEqual(
      new TextEncoder().encode(sig),
      new TextEncoder().encode(expected)
    )
  ) {
    return false;
  }

  let payload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(
        base64UrlDecode(body)
      )
    );
  } catch {
    return false;
  }

  if (
    payload.action !== LOGIN_CHALLENGE_ACTION ||
    payload.key !== loginKey(req) ||
    !payload.exp ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  const digest =
    await sha256Hex(`${challengeToken}:${challengeNonce}`);

  return digest.startsWith(
    "0".repeat(LOGIN_CHALLENGE_DIFFICULTY)
  );
}

async function ensureRevisionTable(env) {
  if (!revisionTablePromise) {
    revisionTablePromise = (async () => {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS kirtan_revisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kirtan_id INTEGER NOT NULL,
          snapshot_json TEXT NOT NULL,
          changed_fields TEXT NOT NULL,
          created_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          action TEXT NOT NULL DEFAULT 'update'
        )
      `).run();

      await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_kirtan_revisions_kirtan_id
        ON kirtan_revisions(kirtan_id, id DESC)
      `).run();
    })().catch((err) => {
      revisionTablePromise = null;
      throw err;
    });
  }

  return revisionTablePromise;
}

async function ensureKirtanReadIndexes(env) {
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_tbl_kirtan_verified_id
    ON tbl_kirtan(verified, id)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_tbl_kirtan_raag_id
    ON tbl_kirtan(raag, id)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_tbl_kirtan_type_id
    ON tbl_kirtan(type, id)
  `).run();
}

async function ensureContributorTables(env) {
  if (!contributorTablesPromise) {
    contributorTablesPromise = (async () => {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS contributors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT NOT NULL
        )
      `).run();

      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS kirtan_contributions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kirtan_id INTEGER NOT NULL,
          contributor_id INTEGER NOT NULL,
          contributor_username TEXT NOT NULL,
          base_snapshot_json TEXT NOT NULL,
          proposed_json TEXT NOT NULL,
          changed_fields TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          reviewed_at TEXT,
          reviewed_by TEXT,
          admin_note TEXT
        )
      `).run();

      await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_kirtan_contributions_status
        ON kirtan_contributions(status, updated_at DESC)
      `).run();

      await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_kirtan_contributions_kirtan_id
        ON kirtan_contributions(kirtan_id, status)
      `).run();

      await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_kirtan_contributions_contributor_status_kirtan
        ON kirtan_contributions(contributor_id, status, kirtan_id)
      `).run();

      await ensureKirtanReadIndexes(env);
    })().catch((err) => {
      contributorTablesPromise = null;
      throw err;
    });
  }

  return contributorTablesPromise;
}

function normalizeKirtan(row) {
  if (!row) return row;

  return {
    ...row,
    verified: Boolean(row.verified),
  };
}

function dbVerified(value) {
  return value ? 1 : 0;
}

function normalizeContributor(row) {
  if (!row) return row;

  const {
    password_hash,
    ...safe
  } = row;

  return {
    ...safe,
    active: Boolean(row.active),
  };
}

function changedContributorFields(before, after) {
  return CONTRIBUTOR_EDITABLE_COLUMNS.filter((key) =>
    String(before[key] ?? "") !== String(after[key] ?? "")
  );
}

function normalizeContribution(row) {
  if (!row) return row;

  return {
    ...row,
    changed_fields:
      typeof row.changed_fields === "string"
        ? JSON.parse(row.changed_fields || "[]")
        : row.changed_fields,
    base:
      typeof row.base_snapshot_json === "string"
        ? JSON.parse(row.base_snapshot_json)
        : row.base,
    proposed:
      typeof row.proposed_json === "string"
        ? JSON.parse(row.proposed_json)
        : row.proposed,
    base_snapshot_json: undefined,
    proposed_json: undefined,
  };
}

function redactedRevision(row) {
  return {
    ...row,
    created_by: row.created_by ? "[redacted]" : row.created_by,
  };
}

function redactedContribution(row) {
  return {
    ...row,
    contributor_username:
      row.contributor_username ? "[redacted]" : row.contributor_username,
    reviewed_by:
      row.reviewed_by ? "[redacted]" : row.reviewed_by,
  };
}

function redactedContributor(row) {
  return {
    id: row.id,
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function changedFields(before, after) {
  return EDITABLE_COLUMNS.filter((key) => {
    const left =
      key === "verified"
        ? Boolean(before[key])
        : String(before[key] ?? "");

    const right =
      key === "verified"
        ? Boolean(after[key])
        : String(after[key] ?? "");

    return left !== right;
  });
}

async function getKirtanRow(env, id, { publicOnly = false } = {}) {
  const sql = `
    SELECT ${KIRTAN_COLUMNS.join(", ")}
    FROM tbl_kirtan
    WHERE id=?
    ${publicOnly ? "AND verified=1" : ""}
  `;

  return env.DB.prepare(sql).bind(id).first();
}

async function createRevision(env, row, fields, action, username) {
  await ensureRevisionTable(env);

  await env.DB
    .prepare(`
      INSERT INTO kirtan_revisions
        (kirtan_id, snapshot_json, changed_fields, created_at, created_by, action)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(
      row.id,
      JSON.stringify(normalizeKirtan(row)),
      JSON.stringify(fields),
      new Date().toISOString(),
      username || "admin",
      action
    )
    .run();

  await env.DB
    .prepare(`
      DELETE FROM kirtan_revisions
      WHERE kirtan_id=?
      AND id NOT IN (
        SELECT id
        FROM kirtan_revisions
        WHERE kirtan_id=?
        ORDER BY id DESC
        LIMIT 3
      )
    `)
    .bind(
      row.id,
      row.id
    )
    .run();
}

async function serveAsset(req, env, path) {
  const url = new URL(req.url);
  url.pathname = path;
  url.search = "";
  return env.ASSETS.fetch(new Request(url, req));
}

async function serveHtmlAsset(req, env, path) {
  const response =
    await serveAsset(req, env, path);

  return withHtmlHeaders(response);
}

function withHtmlHeaders(response) {
  const headers =
    new Headers(response.headers);

  headers.set(
    "content-type",
    "text/html;charset=utf-8"
  );
  headers.set(
    "cache-control",
    "no-store"
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value, maxLength) {
  const text = stripHtml(value);

  if (text.length <= maxLength) {
    return text;
  }

  const clipped =
    text.slice(0, maxLength - 1);

  const lastSpace =
    clipped.lastIndexOf(" ");

  return `${clipped.slice(0, lastSpace > 120 ? lastSpace : clipped.length).trim()}...`;
}

function escapeJsonScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function absoluteUrl(origin, path) {
  return new URL(path || "/", origin).toString();
}

function rootRelativeAsset(path) {
  const value =
    String(path || "").trim();

  if (!value) {
    return "";
  }

  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith("/")) {
    return value;
  }

  return `/${value.replace(/^\.?\//, "")}`;
}

function publicKirtanSummary(row) {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    raag: row.raag,
    image: row.image,
    preview: String(row.original_text || "").slice(0, 100),
    verified: row.verified,
  };
}

function isVerifiedPublicKirtan(row) {
  return Number(row?.verified) === 1;
}

async function getStaticPublicKirtans(env, origin) {
  if (!env.ASSETS) {
    return SAMPLE.filter((row) => row.verified === 1);
  }

  if (!staticKirtansPromise) {
    staticKirtansPromise =
      env.ASSETS
        .fetch(
          new Request(
            absoluteUrl(origin, PUBLIC_KIRTAN_DATA_PATH)
          )
        )
        .then((res) => {
          if (!res.ok) {
            throw new Error("Static kirtan data not found");
          }

          return res.json();
        })
        .catch((err) => {
          staticKirtansPromise = null;
          throw err;
        });
  }

  return staticKirtansPromise;
}

async function getStaticPublicKirtan(env, origin, id) {
  const rows =
    await getStaticPublicKirtans(env, origin);

  return rows.find(
    (row) =>
      Number(row.id) === Number(id) &&
      isVerifiedPublicKirtan(row)
  ) || null;
}

async function getStaticAdjacentKirtans(env, origin, id) {
  const numericId =
    Number(id);

  if (!Number.isFinite(numericId)) {
    return {
      previous: null,
      next: null,
    };
  }

  const rows =
    await getStaticPublicKirtans(env, origin);

  return rows
    .filter(isVerifiedPublicKirtan)
    .filter((item) =>
      Number.isFinite(Number(item.id))
    )
    .sort((a, b) =>
      Number(a.id) - Number(b.id)
    )
    .reduce(
      (nav, item) => {
        const itemId =
          Number(item.id);

        if (
          itemId < numericId &&
          (
            !nav.previous ||
            itemId > Number(nav.previous.id)
          )
        ) {
          nav.previous = item;
        }

        if (
          itemId > numericId &&
          (
            !nav.next ||
            itemId < Number(nav.next.id)
          )
        ) {
          nav.next = item;
        }

        return nav;
      },
      {
        previous: null,
        next: null,
      }
    );
}

async function filterStaticPublicKirtans(
  env,
  origin,
  {
    q = "",
    raag = "",
    type = "",
    summary = false,
  } = {}
) {
  const term =
    String(q || "").trim().toLowerCase();

  const rows =
    await getStaticPublicKirtans(env, origin);

  return rows
    .filter((row) => {
      if (!isVerifiedPublicKirtan(row)) {
        return false;
      }

      if (raag && row.raag !== raag) {
        return false;
      }

      if (type && row.type !== type) {
        return false;
      }

      if (!term) {
        return true;
      }

      const hay = [
        row.title,
        row.original_text,
        row.translate_text,
        row.transliterate_text,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(term);
    })
    .map((row) => summary ? publicKirtanSummary(row) : row);
}

function removeEndingMarker(content) {
  return String(content ?? "")
    .replace(/\s*✿\s*$/u, "")
    .trim();
}

function normalizeShareLine(line) {
  return String(line || "")
    .replace(/^\*{1,2}|\*{1,2}$/g, "")
    .replace(/^\(|\)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isRaagShareLine(line) {
  const text =
    normalizeShareLine(line);

  return (
    /^राग(?:\s|[|｜·:：-]).*Raga/i.test(text) ||
    /^Raga(?:\s|[|｜·:：-]).*राग/i.test(text)
  );
}

function removeRepeatedShareTitle(content, title) {
  const lines =
    String(content || "").split(/\r?\n/);

  const firstContentIndex =
    lines.findIndex(
      (line) => line.trim()
    );

  if (firstContentIndex === -1) {
    return "";
  }

  const normalize = (value) =>
    normalizeShareLine(value)
      .replace(/[|｜]/g, "|")
      .toLowerCase();

  const firstLine =
    normalize(lines[firstContentIndex]);

  const pageTitle =
    normalize(title);

  if (
    pageTitle &&
    (
      firstLine === pageTitle ||
      firstLine.includes(pageTitle) ||
      pageTitle.includes(firstLine)
    )
  ) {
    lines.splice(firstContentIndex, 1);
  }

  return lines.join("\n");
}

function hasDevanagari(value) {
  return /[\u0900-\u097F]/u.test(value);
}

function latinLetterCount(value) {
  return (
    String(value || "").match(/[A-Za-z]/g) || []
  ).length;
}

function translatedShareText(kirtan) {
  const cleaned =
    removeEndingMarker(
      removeRepeatedShareTitle(
        kirtan.translate_text,
        kirtan.title
      )
    );

  const englishLines =
    cleaned
      .split(/\r?\n/)
      .map(normalizeShareLine)
      .filter(Boolean)
      .filter((line) => !isRaagShareLine(line))
      .filter((line) => !hasDevanagari(line))
      .filter((line) => latinLetterCount(line) >= 12);

  if (englishLines.length) {
    return englishLines.join(" ");
  }

  return cleaned;
}

function translatedShareExcerpt(kirtan, maxLines = 2) {
  const cleaned =
    removeEndingMarker(
      removeRepeatedShareTitle(
        kirtan.translate_text,
        kirtan.title
      )
    );

  const englishLines =
    cleaned
      .split(/\r?\n/)
      .map(normalizeShareLine)
      .filter(Boolean)
      .filter((line) => !isRaagShareLine(line))
      .filter((line) => !hasDevanagari(line))
      .filter((line) => latinLetterCount(line) >= 12)
      .slice(0, maxLines);

  if (englishLines.length) {
    return englishLines.join(" ");
  }

  return translatedShareText(kirtan);
}

function kirtanShareDescription(kirtan) {
  const occasion =
    englishCollectionLabel(kirtan.type);

  const meaning =
    translatedShareExcerpt(kirtan, 8) ||
    kirtan.original_text ||
    kirtan.transliterate_text;

  return truncateText(
    [
      occasion ? `Occasion: ${occasion}.` : "",
      meaning,
    ].filter(Boolean).join(" "),
    SOCIAL_DESCRIPTION_MAX_LENGTH
  ) || "Read a Pushtimargiya Kirtan with English meaning, transliteration, raag, and occasion.";
}

function splitKirtanLabel(value) {
  const parts =
    String(value || "")
      .split(/[|｜]/)
      .map((part) => part.trim())
      .filter(Boolean);

  const hasDevanagariText = (part) =>
    /[\u0904-\u0939\u0958-\u0961\u0971-\u097F]/u.test(part);

  if (parts.length >= 2) {
    const [first, second] = parts;

    if (
      hasDevanagariText(first) &&
      !hasDevanagariText(second)
    ) {
      return {
        devanagari: first,
        roman: second,
      };
    }

    return {
      devanagari: second,
      roman: first,
    };
  }

  return {
    devanagari: parts.find(hasDevanagariText) || parts[0] || "",
    roman: parts.find((part) => !hasDevanagariText(part)) || "",
  };
}

function formatSeoLabel(value) {
  return String(value || "")
    .replace(/[()]/g, "")
    .replace(/\s*[|｜]\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

function englishCollectionLabel(value) {
  const labels =
    splitKirtanLabel(value);

  return String(
    labels.roman ||
      labels.devanagari ||
      formatSeoLabel(value)
  )
    .replace(/^\d{3}\s+/, "")
    .trim();
}

function kirtanTitleParts(kirtan) {
  const title =
    kirtan.title || `Kirtan #${kirtan.id}`;

  return {
    title,
    ...splitKirtanLabel(title),
  };
}

function slugify(value) {
  const normalized =
    String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  return normalized || "kirtan";
}

function kirtanSlug(kirtan) {
  const titleParts =
    kirtanTitleParts(kirtan);

  return `${slugify(titleParts.roman || titleParts.title)}-${kirtan.id}`;
}

function kirtanPath(kirtan) {
  return `/kirtan/${kirtanSlug(kirtan)}`;
}

function collectionSlug(value) {
  const labels =
    splitKirtanLabel(value);

  return slugify(labels.roman || labels.title || value);
}

function collectionPath(kind, value) {
  return `/${kind}/${collectionSlug(value)}`;
}

function trackingShareUrl(pageUrl, source, campaign) {
  const trackedUrl =
    new URL(pageUrl);

  trackedUrl.searchParams.set(
    "utm_source",
    source
  );

  trackedUrl.searchParams.set(
    "utm_medium",
    "share"
  );

  trackedUrl.searchParams.set(
    "utm_campaign",
    campaign
  );

  return trackedUrl.toString();
}

function kirtanIdFromPath(url) {
  const slugMatch =
    url.pathname.match(/^\/kirtan\/[^/]*-(\d+)$/);

  if (slugMatch) {
    return Number(slugMatch[1]);
  }

  return Number(url.searchParams.get("id"));
}

function collectionTitle(kind, value) {
  const label =
    formatSeoLabel(value);

  return kind === "raag"
    ? `${label} Kirtans`
    : `${label} Kirtans with Meanings`;
}

function collectionDisplayTitle(value) {
  return formatSeoLabel(value)
    .replace(/^\d{3}\s+/, "")
    .trim();
}

function buildKirtanJsonLd({ kirtan, pageUrl, image, description }) {
  const titleParts =
    kirtanTitleParts(kirtan);

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${pageUrl}#kirtan`,
    url: pageUrl,
    headline: titleParts.title,
    name: titleParts.title,
    description,
    image: [image.url],
    inLanguage: ["hi", "en"],
    isPartOf: {
      "@type": "WebSite",
      "@id": "https://pushtikirtan.com/#website",
      name: "Pushti Kirtan",
      url: "https://pushtikirtan.com/",
    },
    about: [
      "Pushtimargiya Kirtan",
      "Vraj Bhasha devotional poetry",
      formatSeoLabel(kirtan.raag),
      formatSeoLabel(kirtan.type),
    ].filter(Boolean),
    articleSection: formatSeoLabel(kirtan.type) || "Pushti Kirtan",
    datePublished: kirtan.created_date || undefined,
    dateModified: kirtan.updated_date || kirtan.created_date || undefined,
  };
}

function buildKirtanMeta({ kirtan, pageUrl, image }) {
  const title =
    kirtan.title
      ? `${kirtan.title} - Pushti Kirtan`
      : `Kirtan #${kirtan.id} - Pushti Kirtan`;

  const description =
    kirtanShareDescription(kirtan);

  const imageAlt =
    kirtan.title || "Pushti Kirtan";

  const jsonLd =
    buildKirtanJsonLd({
      kirtan,
      pageUrl,
      image,
      description,
    });

  return `
  <title>${escapeHtml(title)}</title>
  <link rel="canonical" href="${escapeHtml(pageUrl)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Pushti Kirtan">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:image" content="${escapeHtml(image.url)}">
  <meta property="og:image:secure_url" content="${escapeHtml(image.url)}">
  <meta property="og:image:type" content="${escapeHtml(image.type)}">
  <meta property="og:image:width" content="${escapeHtml(image.width)}">
  <meta property="og:image:height" content="${escapeHtml(image.height)}">
  <meta property="og:image:alt" content="${escapeHtml(imageAlt)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:image" content="${escapeHtml(image.url)}">
  <meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <script type="application/ld+json">${escapeJsonScript(jsonLd)}</script>`.trim();
}

function replaceKirtanMeta(html, metaHtml) {
  return html
    .replace(
      /\n\s*(?:<meta name="description"[\s\S]*?>|<link rel="canonical"[\s\S]*?>|<meta property="og:[\s\S]*?>|<meta name="twitter:[\s\S]*?>|<script type="application\/ld\+json">[\s\S]*?<\/script>)/g,
      ""
    )
    .replace(/<title>[\s\S]*?<\/title>/, metaHtml);
}

function renderSeoTextBlock(title, content) {
  const body =
    removeEndingMarker(content);

  if (!body) {
    return "";
  }

  const paragraphs =
    body
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
      .join("");

  return `
    <section class="seo-kirtan__section">
      <h2>${escapeHtml(title)}</h2>
      ${paragraphs}
    </section>
  `;
}

function renderSsrTextLines(content) {
  return String(content ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed =
        line.trim();

      if (!trimmed) {
        return `<span class="text-line text-line--blank" aria-hidden="true"></span>`;
      }

      const scriptClass =
        hasDevanagari(line)
          ? "text-line--devanagari"
          : "text-line--latin";

      return `<span class="text-line ${scriptClass}">${escapeHtml(line)}</span>`;
    })
    .join("");
}

function renderSsrTextSection(title, content, modifier) {
  const body =
    removeEndingMarker(content);

  if (!body) {
    return "";
  }

  return `
            <section class="text-section text-section--${escapeHtml(modifier)}">
              <div class="text-section__label">${escapeHtml(title)}</div>
              <div class="text-section__content">${renderSsrTextLines(body)}</div>
            </section>
  `;
}

function renderSsrReadingToolbar(hasTransliteration) {
  return `
              <div class="reading-toolbar" aria-label="Reading controls">
                <button type="button" class="reading-toolbar__btn is-active" data-toggle-section="original" aria-pressed="true">
                  Original
                </button>
                <button type="button" class="reading-toolbar__btn is-active" data-toggle-section="meaning" aria-pressed="true">
                  Meaning
                </button>
                ${
                  hasTransliteration
                    ? `<button type="button" class="reading-toolbar__btn is-active" data-toggle-section="transliteration" aria-pressed="true">
                        Transliteration
                      </button>`
                    : ""
                }
                <span class="reading-toolbar__spacer" aria-hidden="true"></span>
                <button type="button" class="reading-toolbar__btn reading-toolbar__copy" data-copy-visible>
                  Copy
                </button>
                <button type="button" class="reading-toolbar__btn reading-toolbar__size" data-font-step="-1" aria-label="Decrease reading text size">
                  A-
                </button>
                <button type="button" class="reading-toolbar__btn reading-toolbar__size" data-font-step="1" aria-label="Increase reading text size">
                  A+
                </button>
                <span class="reading-toolbar__copy-status" data-copy-status role="status" aria-live="polite"></span>
              </div>
  `;
}

function firstMeaningfulLine(content) {
  return String(content ?? "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[(（]?[०-९0-9]+[)）.]?\s*/, "")
        .replace(/^\s*[*✿-]+\s*/, "")
        .trim()
    )
    .find(Boolean) || "";
}

function cleanSearchLine(line) {
  return String(line ?? "")
    .replace(/[|｜]/g, " ")
    .replace(/[।॥"'“”‘’()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90)
    .trim();
}

function removeRaagLines(content) {
  const lines =
    String(content ?? "").split(/\r?\n/);

  const filtered =
    lines.filter(
      (line) => !isRaagShareLine(line)
    );

  while (
    filtered.length &&
    !filtered[0].trim()
  ) {
    filtered.shift();
  }

  return filtered.join("\n");
}

function audioSearchHtml(kirtan) {
  const originalFirstLine =
    cleanSearchLine(
      firstMeaningfulLine(
        removeRaagLines(kirtan.original_text)
      )
    );

  const transliterationFirstLine =
    cleanSearchLine(
      firstMeaningfulLine(kirtan.transliterate_text)
    );

  const query =
    [
      originalFirstLine,
      transliterationFirstLine,
      "kirtan audio video",
    ]
      .filter(Boolean)
      .join(" ");

  if (!query.trim()) {
    return "";
  }

  const searchUrl =
    `https://www.google.com/search?${new URLSearchParams({ q: query }).toString()}`;

  return `
              <aside class="kirtan-audio-search" aria-label="Find kirtan audio online">
                <a
                  class="kirtan-audio-search__link"
                  href="${escapeHtml(searchUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Search the web for audio or video of this kirtan
                </a>
              </aside>
  `;
}

function renderShareHtml({ kirtan, pageUrl }) {
  const pageTitle =
    kirtan.title || `Kirtan #${kirtan.id}`;

  const facebookShareUrl =
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`;

  const whatsappShareUrl =
    `https://wa.me/?text=${encodeURIComponent(`${pageTitle} - ${trackingShareUrl(pageUrl, "whatsapp", "kirtan_share")}`)}`;

  const twitterShareUrl =
    `https://twitter.com/intent/tweet?${new URLSearchParams({
      text: pageTitle,
      url: pageUrl,
    }).toString()}`;

  return `
              <div class="kirtan-share" aria-label="Share this kirtan">
                <a
                  class="kirtan-share__button"
                  href="${escapeHtml(facebookShareUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Share ${escapeHtml(pageTitle)} on Facebook"
                >
                  <span class="kirtan-share__icon" aria-hidden="true">f</span>
                  <span>Facebook</span>
                </a>
                <a
                  class="kirtan-share__button"
                  href="${escapeHtml(whatsappShareUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Share ${escapeHtml(pageTitle)} on WhatsApp"
                >
                  <span class="kirtan-share__icon" aria-hidden="true">W</span>
                  <span>WhatsApp</span>
                </a>
                <a
                  class="kirtan-share__button"
                  href="${escapeHtml(twitterShareUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Share ${escapeHtml(pageTitle)} on X"
                >
                  <span class="kirtan-share__icon" aria-hidden="true">X</span>
                  <span>X</span>
                </a>
              </div>
  `;
}

function kirtanNavTitle(kirtan) {
  return (
    kirtan?.title ||
    kirtan?.preview ||
    `Kirtan #${kirtan?.id}`
  );
}

function adjacentKirtanLink(kirtan, direction) {
  if (!kirtan) {
    return `
              <span
                class="kirtan-adjacent__link kirtan-adjacent__link--empty"
                aria-hidden="true"
              ></span>
    `;
  }

  const label =
    direction === "previous"
      ? "Previous"
      : "Next";

  const arrow =
    direction === "previous"
      ? "←"
      : "→";

  return `
              <a
                class="kirtan-adjacent__link kirtan-adjacent__link--${direction}"
                href="${escapeHtml(kirtanPath(kirtan))}"
                aria-label="${label} kirtan: ${escapeHtml(kirtanNavTitle(kirtan))}"
              >
                <span class="kirtan-adjacent__label">
                  ${direction === "previous" ? `${arrow} ${label}` : `${label} ${arrow}`}
                </span>
                <span class="kirtan-adjacent__title">${escapeHtml(kirtanNavTitle(kirtan))}</span>
              </a>
  `;
}

function adjacentKirtansHtml(nav) {
  if (!nav?.previous && !nav?.next) {
    return "";
  }

  return `
            <nav class="kirtan-adjacent" aria-label="Adjacent kirtans">
              ${adjacentKirtanLink(nav.previous, "previous")}
              ${adjacentKirtanLink(nav.next, "next")}
            </nav>
  `;
}

function buildKirtanSeoHtml({ kirtan, image, pageUrl, adjacent }) {
  const titleParts =
    kirtanTitleParts(kirtan);

  const translationText =
    removeEndingMarker(
      removeRaagLines(
        removeRepeatedShareTitle(
          kirtan.translate_text,
          titleParts.title
        )
      )
    );

  const imageSrc =
    image.sourcePath || "/images/placeholder.png";

  const raagLabel =
    formatSeoLabel(kirtan.raag);

  const typeLabel =
    formatSeoLabel(kirtan.type);

  const hasTransliteration =
    Boolean(
      String(kirtan.transliterate_text ?? "").trim()
    );

  const metaHtml = `
            ${
              typeLabel
                ? `<div class="kirtan-detail__type">
                    <span class="kirtan-detail__meta-label">OCCASION:</span>
                    <a class="kirtan-detail__type-link" href="${escapeHtml(collectionPath("occasion", kirtan.type))}">
                      ${escapeHtml(typeLabel)}
                    </a>
                  </div>`
                : ""
            }
            ${
              raagLabel
                ? `<div class="kirtan-detail__raag">
                    <span class="kirtan-detail__meta-label">RAAG:</span>
                    <a class="kirtan-detail__type-link" href="${escapeHtml(collectionPath("raag", kirtan.raag))}">
                      ${escapeHtml(raagLabel)}
                    </a>
                  </div>`
                : ""
            }
  `;

  const shareHtml =
    renderShareHtml({
      kirtan,
      pageUrl,
    });

  const audioSearch =
    audioSearchHtml(kirtan);

  const stickySummaryHtml = `
            <div class="kirtan-detail__sticky-summary" aria-label="Current kirtan">
              <div class="kirtan-detail__sticky-title">
                <span class="kirtan-detail__sticky-title-main">${escapeHtml(titleParts.devanagari || titleParts.title)}</span>
                ${
                  titleParts.roman
                    ? `<span class="kirtan-detail__sticky-title-sub">${escapeHtml(titleParts.roman)}</span>`
                    : ""
                }
              </div>
              ${metaHtml}
              ${shareHtml}
              ${audioSearch}
            </div>
  `;

  return `
      <article class="kirtan-detail" id="kirtan-${escapeHtml(kirtan.id)}">
        <div class="kirtan-detail__layout">
          <aside class="kirtan-detail__visual" aria-hidden="true">
            <div class="kirtan-detail__image-frame">
              <img src="${escapeHtml(imageSrc)}" alt="">
            </div>
            ${stickySummaryHtml}
          </aside>
          <div class="kirtan-detail__content">
            <div class="kirtan-detail__hero-visual" aria-label="Kirtan illustration">
              <div class="kirtan-detail__image-frame">
                <img
                  src="${escapeHtml(imageSrc)}"
                  alt="${escapeHtml(titleParts.title)} illustration"
                >
              </div>
            </div>
            <header class="kirtan-detail__header">
              <h1 class="kirtan-detail__title">
                <span class="kirtan-detail__title-main">${escapeHtml(titleParts.devanagari || titleParts.title)}</span>
                ${
                  titleParts.roman
                    ? `<span class="kirtan-detail__title-sub">${escapeHtml(titleParts.roman)}</span>`
                    : ""
                }
              </h1>
              ${metaHtml}
              ${shareHtml}
              ${audioSearch}
            </header>
            <div class="reading-shell">
              ${renderSsrReadingToolbar(hasTransliteration)}
              <div class="kirtan-detail__text">
                ${renderSsrTextSection("MEANING", translationText, "translation")}
                ${renderSsrTextSection("ORIGINAL", kirtan.original_text, "original")}
                ${renderSsrTextSection("TRANSLITERATION", kirtan.transliterate_text, "transliteration")}
              </div>
            </div>
            ${adjacentKirtansHtml(adjacent)}
          </div>
        </div>
      </article>
  `;
}

function replaceKirtanContent(html, contentHtml) {
  return html.replace(
    /<div id="content">[\s\S]*?<\/div>\s*<\/main>/,
    `<div id="content">\n${contentHtml}\n    </div>\n  </main>`
  );
}

function sitemapUrlEntry({ loc, lastmod, priority, changefreq }) {
  return [
    "  <url>",
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : "",
    changefreq ? `    <changefreq>${escapeXml(changefreq)}</changefreq>` : "",
    priority ? `    <priority>${escapeXml(priority)}</priority>` : "",
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}

function sitemapDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

async function serveSitemap(env, url) {
  const rows =
    await getStaticPublicKirtans(env, url.origin);

  const verifiedRows =
    rows.filter(isVerifiedPublicKirtan);

  const staticPages = [
    {
      loc: absoluteUrl(url.origin, "/"),
      priority: "1.0",
      changefreq: "daily",
    },
    {
      loc: absoluteUrl(url.origin, "/contribute-proofread.html"),
      priority: "0.4",
      changefreq: "monthly",
    },
    {
      loc: absoluteUrl(url.origin, "/contribute-code.html"),
      priority: "0.4",
      changefreq: "monthly",
    },
    {
      loc: absoluteUrl(url.origin, "/contact.html"),
      priority: "0.3",
      changefreq: "monthly",
    },
    {
      loc: absoluteUrl(url.origin, "/legal.html"),
      priority: "0.2",
      changefreq: "yearly",
    },
  ];

  const kirtanPages =
    verifiedRows
      .map((kirtan) => ({
        loc: absoluteUrl(
          url.origin,
          kirtanPath(kirtan)
        ),
        lastmod: sitemapDate(kirtan.updated_date || kirtan.created_date),
        priority: "0.8",
        changefreq: "monthly",
      }));

  const collectionPages = [
    ...new Set(
      verifiedRows
        .map((kirtan) => kirtan.raag)
        .filter(Boolean)
    ),
  ].map((raag) => ({
    loc: absoluteUrl(url.origin, collectionPath("raag", raag)),
    priority: "0.7",
    changefreq: "weekly",
  })).concat(
    [
      ...new Set(
        verifiedRows
          .map((kirtan) => kirtan.type)
          .filter(Boolean)
      ),
    ].map((type) => ({
      loc: absoluteUrl(url.origin, collectionPath("occasion", type)),
      priority: "0.7",
      changefreq: "weekly",
    }))
  );

  const entries =
    [...staticPages, ...collectionPages, ...kirtanPages]
      .map(sitemapUrlEntry)
      .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`,
    {
      headers: {
        "content-type": "application/xml;charset=utf-8",
        "cache-control": "public, max-age=3600, s-maxage=86400",
      },
    }
  );
}

function serveRobots(url) {
  return text(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /cont",
      "Disallow: /api/",
      "",
      `Sitemap: ${absoluteUrl(url.origin, "/sitemap.xml")}`,
      "",
    ].join("\n"),
    200,
    {
      "cache-control": "public, max-age=3600, s-maxage=86400",
    }
  );
}

async function getPublicKirtanForShare(env, origin, id) {
  return getStaticPublicKirtan(env, origin, id);
}

function parsePngDimensions(bytes) {
  const view =
    new DataView(bytes);

  const pngSignature = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ];

  if (view.byteLength < 24) {
    return null;
  }

  for (let i = 0; i < pngSignature.length; i += 1) {
    if (view.getUint8(i) !== pngSignature[i]) {
      return null;
    }
  }

  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

async function assetExists(env, origin, path) {
  const normalizedPath =
    path.startsWith("/")
      ? path
      : `/${path}`;

  if (!/\.(?:png|jpe?g)(?:$|\?)/i.test(normalizedPath)) {
    return false;
  }

  try {
    const imageResponse =
      await env.ASSETS.fetch(
        new Request(
          absoluteUrl(origin, normalizedPath)
        )
      );

    return imageResponse.ok;
  } catch {
    return false;
  }
}

async function getShareImagePath(env, origin, kirtan) {
  const candidates = [
    `/images/${kirtan.id}.png`,
    kirtan.image,
    "/images/placeholder.png",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const normalizedPath =
      candidate.startsWith("/")
        ? candidate
        : `/${candidate}`;

    const found =
      await assetExists(
        env,
        origin,
        normalizedPath
      );

    if (found || normalizedPath === "/images/placeholder.png") {
      return normalizedPath;
    }
  }

  return "/images/placeholder.png";
}

async function getShareImage(env, origin, kirtan) {
  const path =
    await getShareImagePath(
      env,
      origin,
      kirtan
    );

  return {
    url: absoluteUrl(
      origin,
      `/share-image/kirtans/${kirtan.id}.jpg`
    ),
    sourcePath: path,
    width: SOCIAL_IMAGE_WIDTH,
    height: SOCIAL_IMAGE_HEIGHT,
    type: "image/jpeg",
  };
}

async function serveSocialImage(req, env, url) {
  const match =
    url.pathname.match(/^\/share-image\/kirtans\/(\d+)(?:-v\d+)?\.(?:png|jpe?g)$/);

  if (!match || req.method !== "GET") {
    return json({ error: "Not found" }, 404);
  }

  try {
    const kirtan =
      await getPublicKirtanForShare(
        env,
        url.origin,
        Number(match[1])
      );

    if (!kirtan) {
      return json({ error: "Not found" }, 404);
    }

    const image =
      await getShareImage(
        env,
        url.origin,
        kirtan
      );

    const imageRequest =
      new Request(
        absoluteUrl(url.origin, image.sourcePath),
        req
      );

    const assetResponse =
      await fetch(imageRequest, {
        cf: {
          cacheTtl: 604800,
          image: {
            width: SOCIAL_IMAGE_WIDTH,
            height: SOCIAL_IMAGE_HEIGHT,
            fit: "cover",
            format: "jpeg",
            quality: SOCIAL_IMAGE_QUALITY,
            metadata: "none",
          },
        },
      });

    if (!assetResponse.ok) {
      const fallbackResponse =
        await env.ASSETS.fetch(
          new Request(
            absoluteUrl(url.origin, image.sourcePath),
            req
          )
        );

      if (!fallbackResponse.ok) {
        return env.ASSETS.fetch(
          new Request(
            absoluteUrl(url.origin, "/images/placeholder.png"),
            req
          )
        );
      }

      return fallbackResponse;
    }

    const headers =
      new Headers(assetResponse.headers);

    headers.set(
      "content-type",
      "image/jpeg"
    );

    headers.set(
      "cache-control",
      "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400"
    );

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  } catch (err) {
    console.error("Unable to render social image", err);
    return env.ASSETS.fetch(
      new Request(
        absoluteUrl(url.origin, "/images/placeholder.png"),
        req
      )
    );
  }
}

function pageShell({ title, description, canonical, body, jsonLd, image }) {
  const origin =
    new URL(canonical).origin;

  const previewImage =
    image || {
      url: absoluteUrl(origin, "/images/placeholder.png"),
      width: 1254,
      height: 1254,
      type: "image/png",
      alt: "Pushti Kirtan",
    };

  const imageAlt =
    previewImage.alt || title;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Pushti Kirtan">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(previewImage.url)}">
  <meta property="og:image:secure_url" content="${escapeHtml(previewImage.url)}">
  <meta property="og:image:type" content="${escapeHtml(previewImage.type)}">
  <meta property="og:image:width" content="${escapeHtml(previewImage.width)}">
  <meta property="og:image:height" content="${escapeHtml(previewImage.height)}">
  <meta property="og:image:alt" content="${escapeHtml(imageAlt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(previewImage.url)}">
  <meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css?v=20260910-mobile-menu-v2">
  ${jsonLd ? `<script type="application/ld+json">${escapeJsonScript(jsonLd)}</script>` : ""}
</head>
<body>
  <header class="topbar">
    <div class="topbar__inner">
      <a href="/" class="topbar__brand">
        <span class="topbar__mark" aria-hidden="true">
          <img class="topbar__svg-icon" src="/svg.svg" alt="">
        </span>
        <span class="topbar__brand-name">Pushti Kirtan</span>
      </a>
      <div class="topbar__menu">
        <button class="topbar__menu-toggle" type="button" aria-expanded="false" aria-label="Contribution menu">
          <span class="topbar__menu-icon" aria-hidden="true"></span>
          <span class="visually-hidden">Contribution menu</span>
        </button>
        <nav class="topbar__actions" aria-label="Contribute">
        <a class="topbar__contribute" href="/contribute-code.html">Developers</a>
        <a class="topbar__contribute" href="/contribute-proofread.html">Proofreaders</a>
        </nav>
      </div>
      <form class="topbar__search topbar__search--right" action="/" method="get">
        <label for="search" class="visually-hidden">Search</label>
        <input id="search" name="q" type="search" placeholder="Search kirtans..." autocomplete="off">
      </form>
    </div>
  </header>
  ${body}
  <footer class="site-footer wrap">
    <nav class="site-footer__nav" aria-label="Footer">
      <a href="/contribute-code.html">Developers</a>
      <span aria-hidden="true">·</span>
      <a href="/contribute-proofread.html">Proofreaders</a>
      <span aria-hidden="true">·</span>
      <a href="/legal.html">Terms, Privacy Policy & Disclaimer</a>
      <span aria-hidden="true">·</span>
      <a href="/contact.html">Contact Us</a>
    </nav>
    <p class="site-footer__copy">PushtiKirtan.com</p>
  </footer>
  <script src="/topbar.js"></script>
</body>
</html>`;
}

function collectionIntro(kind, label, count) {
  return kind === "raag"
    ? `Read ${count} Pushtimargiya kirtans in ${label} with original text, English meanings, raag context, and devotional metadata.`
    : `Read ${count} Pushtimargiya kirtans for ${label} with original text, English meanings, raag, and devotional metadata.`;
}

function collectionShareDescription(kind, label) {
  const prefix =
    kind === "raag"
      ? "Raag"
      : "Occasion";

  return `${prefix}: ${label}`;
}

async function serveCollectionPage(req, env, url, kind, slug) {
  if (req.method !== "GET") {
    return json({ error: "Not found" }, 404);
  }

  const rows =
    (await getStaticPublicKirtans(env, url.origin))
      .filter(isVerifiedPublicKirtan);

  const values =
    [
      ...new Set(
        rows
          .map((row) => kind === "raag" ? row.raag : row.type)
          .filter(Boolean)
      ),
    ];

  const value =
    values.find((candidate) => collectionSlug(candidate) === slug);

  if (!value) {
    return new Response(
      pageShell({
        title: "Collection Not Found - Pushti Kirtan",
        description: "The requested Pushti Kirtan collection could not be found.",
        canonical: absoluteUrl(url.origin, url.pathname),
        body: `
  <main class="wrap collection-page">
    <section class="empty-state">
      Collection not found.
      <a href="/">Browse Pushti Kirtan</a>
    </section>
  </main>`,
      }),
      {
        status: 404,
        headers: {
          "content-type": "text/html;charset=utf-8",
        },
      }
    );
  }

  const canonicalPath =
    collectionPath(kind, value);

  if (url.pathname !== canonicalPath) {
    return Response.redirect(
      absoluteUrl(url.origin, canonicalPath),
      301
    );
  }

  const collectionRows =
    rows
      .filter((row) =>
        kind === "raag"
          ? row.raag === value
          : row.type === value
      )
      .sort((a, b) => Number(a.id) - Number(b.id));

  const heading =
    collectionTitle(kind, value);

  const displayHeading =
    collectionDisplayTitle(value);

  const title =
    `${displayHeading} - Pushti Kirtan`;

  const canonical =
    absoluteUrl(url.origin, canonicalPath);

  const previewKirtan =
    collectionRows[0] || null;

  const description =
    collectionShareDescription(
      kind,
      displayHeading
    );

  const previewImage =
    previewKirtan
      ? {
          ...(await getShareImage(env, url.origin, previewKirtan)),
          alt: previewKirtan.title || heading,
        }
      : undefined;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${canonical}#collection`,
    url: canonical,
    name: heading,
    description,
    image: previewImage?.url,
    inLanguage: ["en", "hi"],
    isPartOf: {
      "@type": "WebSite",
      "@id": "https://pushtikirtan.com/#website",
      name: "Pushti Kirtan",
      url: "https://pushtikirtan.com/",
    },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: collectionRows.length,
      itemListElement: collectionRows.slice(0, 100).map((kirtan, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: absoluteUrl(url.origin, kirtanPath(kirtan)),
        name: kirtan.title || `Kirtan #${kirtan.id}`,
      })),
    },
  };

  const filterParam =
    kind === "raag"
      ? `/?raag=${encodeURIComponent(value)}`
      : `/?type=${encodeURIComponent(value)}`;

  const body = `
  <main class="wrap wrap--wide collection-page">
    <section class="collection-hero">
      <p class="collection-hero__eyebrow">${kind === "raag" ? "Raag" : "Occasion"}</p>
      <h1>${escapeHtml(displayHeading)}</h1>
      <a class="collection-hero__filter" href="${escapeHtml(filterParam)}">Open this collection in search</a>
    </section>
    <section class="collection-list" aria-label="${escapeHtml(displayHeading)}">
      ${collectionRows.map((kirtan) => {
        const titleParts =
          kirtanTitleParts(kirtan);

        return `
        <article class="collection-card">
          <a class="collection-card__image" href="${escapeHtml(kirtanPath(kirtan))}">
            <img src="${escapeHtml(rootRelativeAsset(kirtan.image) || "/images/placeholder.png")}" alt="" loading="lazy">
          </a>
          <div class="collection-card__body">
            <h2>
              <a href="${escapeHtml(kirtanPath(kirtan))}">
                ${escapeHtml(titleParts.devanagari || titleParts.title)}
              </a>
            </h2>
            ${titleParts.roman ? `<p>${escapeHtml(titleParts.roman)}</p>` : ""}
            <div class="collection-card__meta">
              ${kind !== "raag" && kirtan.raag ? `<a href="${escapeHtml(collectionPath("raag", kirtan.raag))}">${escapeHtml(formatSeoLabel(kirtan.raag))}</a>` : ""}
              ${kind !== "occasion" && kirtan.type ? `<a href="${escapeHtml(collectionPath("occasion", kirtan.type))}">${escapeHtml(formatSeoLabel(kirtan.type))}</a>` : ""}
            </div>
          </div>
        </article>`;
      }).join("")}
    </section>
  </main>`;

  return new Response(
    pageShell({
      title,
      description,
      canonical,
      body,
      jsonLd,
      image: previewImage,
    }),
    {
      headers: {
        "content-type": "text/html;charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}

async function serveKirtanPage(req, env, url) {
  const asset =
    await serveAsset(req, env, "/kirtan-template.txt");

  if (!asset.ok) {
    return asset;
  }

  const id =
    kirtanIdFromPath(url);

  if (!Number.isInteger(id) || id <= 0) {
    return withHtmlHeaders(asset);
  }

  try {
    const kirtan =
      await getPublicKirtanForShare(env, url.origin, id);

    if (!kirtan) {
      return withHtmlHeaders(asset);
    }

    const canonicalPath =
      kirtanPath(kirtan);

    if (url.pathname !== canonicalPath) {
      const redirectUrl =
        new URL(
          canonicalPath,
          url.origin
        );

      for (const [key, value] of url.searchParams) {
        if (key !== "id") {
          redirectUrl.searchParams.append(key, value);
        }
      }

      return Response.redirect(
        redirectUrl.toString(),
        301
      );
    }

    const pageUrl =
      absoluteUrl(
        url.origin,
        canonicalPath
      );

    const image =
      await getShareImage(
        env,
        url.origin,
        kirtan
      );

    const adjacent =
      await getStaticAdjacentKirtans(
        env,
        url.origin,
        kirtan.id
      );

    const html =
      replaceKirtanContent(
        replaceKirtanMeta(
          await asset.text(),
          buildKirtanMeta({
            kirtan,
            pageUrl,
            image,
          })
        ),
        buildKirtanSeoHtml({
          kirtan,
          image,
          pageUrl,
          adjacent,
        })
      );

    const headers =
      new Headers(asset.headers);

    headers.set(
      "content-type",
      "text/html;charset=utf-8"
    );
    headers.set(
      "cache-control",
      "no-store"
    );
    headers.delete("content-length");
    headers.delete("etag");
    headers.delete("location");

    return new Response(html, {
      status: asset.status,
      headers,
    });
  } catch (err) {
    console.error("Unable to render kirtan metadata", err);
    return withHtmlHeaders(asset);
  }
}


/* --------------------------------------------------
   SAMPLE DATA SEARCH
-------------------------------------------------- */

function filterSample(q, raag, type) {
  const n = q.toLowerCase();

  return SAMPLE.filter(
    (x) =>
      x.verified === 1 &&

      (
        !q ||
        [
          x.original_text,
          x.translate_text,
          x.transliterate_text,
          x.title,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(n)
      ) &&

      (!raag || x.raag === raag) &&

      (!type || x.type === type)
  );
}


/* --------------------------------------------------
   SAMPLE DEPENDENT FILTER OPTIONS
-------------------------------------------------- */

function filterOptionsSample(raag, type) {
  const verified =
    SAMPLE.filter(
      (x) => x.verified === 1
    );

  /*
    If an Occasion/type is selected,
    only return Raags that exist for it.
  */

  const raags = [
    ...new Set(
      verified
        .filter(
          (x) =>
            !type ||
            x.type === type
        )
        .map(
          (x) => x.raag
        )
        .filter(Boolean)
    ),
  ];


  /*
    If a Raag is selected,
    only return Occasions that exist for it.
  */

  const types = [
    ...new Set(
      verified
        .filter(
          (x) =>
            !raag ||
            x.raag === raag
        )
        .map(
          (x) => x.type
        )
        .filter(Boolean)
    ),
  ];


  return {
    raags,
    types,
  };
}


/* --------------------------------------------------
   WORKER
-------------------------------------------------- */

export default {

  async fetch(req, env) {

    const u =
      new URL(req.url);

    if (
      req.method === "GET" &&
      u.pathname === "/robots.txt"
    ) {
      return serveRobots(u);
    }

    if (
      req.method === "GET" &&
      u.pathname === "/sitemap.xml"
    ) {
      return serveSitemap(env, u);
    }

    if (
      req.method === "GET" &&
      (
        u.pathname === "/admin" ||
        u.pathname === "/admin/"
      )
    ) {
      return serveHtmlAsset(req, env, "/admin-shell.txt");
    }

    if (
      req.method === "GET" &&
      (
        u.pathname === "/cont" ||
        u.pathname === "/cont/"
      )
    ) {
      return serveHtmlAsset(req, env, "/contributor-shell.txt");
    }

    if (
      req.method === "GET" &&
      (
        u.pathname === "/contribute" ||
        u.pathname === "/contribute/" ||
        u.pathname === "/contribute.html"
      )
    ) {
      u.pathname = "/contribute-proofread.html";
      return Response.redirect(u.toString(), 301);
    }

    if (
      req.method === "GET" &&
      (
        u.pathname === "/kirtan-template" ||
        u.pathname === "/kirtan-template.html" ||
        u.pathname === "/kirtan-template.txt"
      )
    ) {
      u.pathname = "/kirtan.html";
      return Response.redirect(u.toString(), 302);
    }

    if (u.pathname.startsWith("/share-image/kirtans/")) {
      return serveSocialImage(req, env, u);
    }

    if (
      req.method === "GET" &&
      /^\/(?:raag|occasion)\/[^/]+$/.test(u.pathname)
    ) {
      const [, kind, slug] =
        u.pathname.match(/^\/(raag|occasion)\/([^/]+)$/);

      return serveCollectionPage(req, env, u, kind, slug);
    }

    if (
      req.method === "GET" &&
      (
        u.pathname === "/kirtan" ||
        u.pathname === "/kirtan/" ||
        u.pathname === "/kirtan.html" ||
        /^\/kirtan\/[^/]+$/.test(u.pathname)
      )
    ) {
      return serveKirtanPage(req, env, u);
    }

    /* --------------------------------------------------
       ADMIN AUTH
    -------------------------------------------------- */

    if (u.pathname === "/api/admin/session") {
      const session =
        await requireAdmin(req, env);

      return json({
        authenticated: Boolean(session),
      });
    }

    if (
      u.pathname === "/api/admin/login-challenge" &&
      req.method === "GET"
    ) {
      if (!env.SESSION_SECRET) {
        return json(
          {
            error: "Admin authentication is not configured.",
          },
          503
        );
      }

      return json({
        token: await createLoginChallenge(req, env),
        difficulty: LOGIN_CHALLENGE_DIFFICULTY,
      });
    }

    if (
      u.pathname === "/api/admin/login" &&
      req.method === "POST"
    ) {
      if (isLoginLimited(req)) {
        return json(
          {
            error: "Invalid username or password.",
          },
          429
        );
      }

      if (
        !env.ADMIN_USERNAME ||
        !env.ADMIN_PASSWORD_HASH ||
        !env.SESSION_SECRET
      ) {
        return json(
          {
            error: "Admin authentication is not configured.",
          },
          503
        );
      }

      let body;
      try {
        body = await req.json();
      } catch {
        body = {};
      }

      const username =
        String(body.username || "");

      const password =
        String(body.password || "");

      const challengeOk =
        await verifyLoginChallenge(
          req,
          env,
          body.challengeToken,
          body.challengeNonce
        );

      if (!challengeOk) {
        recordLoginFailure(req);
        return json(
          {
            error: "Security check failed. Please try again.",
          },
          403
        );
      }

      const usernameOk =
        timingSafeEqual(
          new TextEncoder().encode(username),
          new TextEncoder().encode(env.ADMIN_USERNAME)
        );

      if (!parsePasswordHash(env.ADMIN_PASSWORD_HASH)) {
        return json(
          {
            error:
              "ADMIN_PASSWORD_HASH must use this format: pbkdf2:100000:<salt_base64>:<hash_base64>.",
          },
          503
        );
      }

      const passwordOk =
        await verifyPassword(
          password,
          env.ADMIN_PASSWORD_HASH
        );

      if (!usernameOk || !passwordOk) {
        recordLoginFailure(req);
        return json(
          {
            error: "Invalid username or password.",
          },
          401
        );
      }

      recordLoginSuccess(req);

      const token =
        await signSession(env, {
          role: "admin",
          username,
          iat: Math.floor(Date.now() / 1000),
          exp:
            Math.floor(Date.now() / 1000) +
            SESSION_TTL_SECONDS,
        });

      return new Response(
        JSON.stringify({ authenticated: true }),
        {
          status: 200,
          headers: {
            "content-type": "application/json;charset=utf-8",
            "set-cookie": setAdminSessionCookie(token),
          },
        }
      );
    }

    if (
      u.pathname === "/api/admin/logout" &&
      req.method === "POST"
    ) {
      return new Response(
        JSON.stringify({ authenticated: false }),
        {
          status: 200,
          headers: {
            "content-type": "application/json;charset=utf-8",
            "set-cookie": clearAdminSessionCookie(),
          },
        }
      );
    }

    /* --------------------------------------------------
       CONTRIBUTOR AUTH
    -------------------------------------------------- */

    if (u.pathname === "/api/contributor/session") {
      const session =
        await requireContributor(req, env);

      return json({
        authenticated: Boolean(session),
        username: session?.username || "",
      });
    }

    if (
      u.pathname === "/api/contributor/login-challenge" &&
      req.method === "GET"
    ) {
      if (!env.SESSION_SECRET) {
        return json(
          {
            error: "Contributor authentication is not configured.",
          },
          503
        );
      }

      return json({
        token: await createLoginChallenge(req, env),
        difficulty: LOGIN_CHALLENGE_DIFFICULTY,
      });
    }

    if (
      u.pathname === "/api/contributor/login" &&
      req.method === "POST"
    ) {
      if (isLoginLimited(req)) {
        return json(
          {
            error: "Invalid username or password.",
          },
          429
        );
      }

      if (!env.SESSION_SECRET || !env.DB) {
        return json(
          {
            error: "Contributor authentication is not configured.",
          },
          503
        );
      }

      await ensureContributorTables(env);

      let body;
      try {
        body = await req.json();
      } catch {
        body = {};
      }

      const username =
        String(body.username || "").trim();

      const password =
        String(body.password || "");

      const challengeOk =
        await verifyLoginChallenge(
          req,
          env,
          body.challengeToken,
          body.challengeNonce
        );

      if (!challengeOk) {
        recordLoginFailure(req);
        return json(
          {
            error: "Security check failed. Please try again.",
          },
          403
        );
      }

      const contributor =
        await env.DB
          .prepare(`
            SELECT *
            FROM contributors
            WHERE username=?
            AND active=1
          `)
          .bind(username)
          .first();

      const passwordOk =
        contributor
          ? await verifyPassword(password, contributor.password_hash)
          : false;

      if (!contributor || !passwordOk) {
        recordLoginFailure(req);
        return json(
          {
            error: "Invalid username or password.",
          },
          401
        );
      }

      recordLoginSuccess(req);

      const token =
        await signSession(env, {
          role: "contributor",
          id: contributor.id,
          username: contributor.username,
          iat: Math.floor(Date.now() / 1000),
          exp:
            Math.floor(Date.now() / 1000) +
            SESSION_TTL_SECONDS,
        });

      return new Response(
        JSON.stringify({ authenticated: true }),
        {
          status: 200,
          headers: {
            "content-type": "application/json;charset=utf-8",
            "set-cookie": setContributorSessionCookie(token),
          },
        }
      );
    }

    if (
      u.pathname === "/api/contributor/logout" &&
      req.method === "POST"
    ) {
      return new Response(
        JSON.stringify({ authenticated: false }),
        {
          status: 200,
          headers: {
            "content-type": "application/json;charset=utf-8",
            "set-cookie": clearContributorSessionCookie(),
          },
        }
      );
    }

    /* --------------------------------------------------
       CONTRIBUTOR DATA ROUTES
    -------------------------------------------------- */

    if (u.pathname.startsWith("/api/contributor/")) {
      const session =
        await requireContributor(req, env);

      if (!session) {
        return unauthorized();
      }

      if (!env.DB) {
        return json(
          {
            error: "Database is not configured.",
          },
          503
        );
      }

      await ensureContributorTables(env);

      if (u.pathname === "/api/contributor/contributions" && req.method === "GET") {
        const status =
          (u.searchParams.get("status") || "all").trim();

        const limit =
          Math.min(
            Math.max(Number(u.searchParams.get("limit")) || 100, 1),
            200
          );

        const offset =
          Math.max(Number(u.searchParams.get("offset")) || 0, 0);

        const where = [
          "c.contributor_id=?",
        ];

        const args = [
          session.id,
        ];

        if (status !== "all") {
          where.push("c.status=?");
          args.push(status);
        }

        const cacheKey =
          JSON.stringify([
            "contributor-contributions",
            session.id,
            status,
            limit,
            offset,
          ]);

        const cached =
          readQueryCache(cacheKey);

        if (cached) {
          return json(cached);
        }

        const [summary, rows] =
          await Promise.all([
            env.DB
              .prepare(`
                SELECT
                  COUNT(*) AS total,
                  SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
                  SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected,
                  SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending
                FROM kirtan_contributions
                WHERE contributor_id=?
              `)
              .bind(session.id)
              .first(),
            env.DB
              .prepare(`
                SELECT
                  c.id,
                  c.kirtan_id,
                  c.changed_fields,
                  c.status,
                  c.created_at,
                  c.updated_at,
                  c.reviewed_at,
                  c.admin_note,
                  k.title,
                  k.raag,
                  k.type,
                  k.verified
                FROM kirtan_contributions c
                LEFT JOIN tbl_kirtan k
                  ON k.id=c.kirtan_id
                WHERE ${where.join(" AND ")}
                ORDER BY c.updated_at DESC
                LIMIT ? OFFSET ?
              `)
              .bind(...args, limit, offset)
              .all(),
          ]);

        const payload = {
          summary: {
            total: Number(summary?.total || 0),
            approved: Number(summary?.approved || 0),
            rejected: Number(summary?.rejected || 0),
            pending: Number(summary?.pending || 0),
          },
          rows: (rows.results || []).map((row) => ({
            ...normalizeKirtan(row),
            changed_fields:
              typeof row.changed_fields === "string"
                ? JSON.parse(row.changed_fields || "[]")
                : row.changed_fields || [],
            admin_note: row.admin_note || "",
          })),
          limit,
          offset,
        };

        return json(
          writeQueryCache(cacheKey, payload)
        );
      }

      if (u.pathname === "/api/contributor/kirtans" && req.method === "GET") {
        const q =
          (u.searchParams.get("q") || "").trim();

        const status =
          (u.searchParams.get("status") || "unverified").trim();

        const limit =
          Math.min(
            Math.max(Number(u.searchParams.get("limit")) || 50, 1),
            200
          );

        const offset =
          Math.max(Number(u.searchParams.get("offset")) || 0, 0);

        const afterId =
          Number(u.searchParams.get("after_id") || 0);

        const numericSearch =
          /^\d+$/.test(q);

        const where = [];
        const args = [];

        if (status === "verified") {
          where.push("k.verified=1");
        } else if (status === "unverified") {
          where.push("(k.verified=0 OR k.verified IS NULL)");
        }

        if (q) {
          where.push(`
            (
              CAST(k.id AS TEXT) LIKE ?
              OR k.title LIKE ?
              OR k.type LIKE ?
              OR k.raag LIKE ?
              OR k.original_text LIKE ?
              OR k.translate_text LIKE ?
              OR k.transliterate_text LIKE ?
            )
          `);

          const z = `%${q}%`;
          args.push(z, z, z, z, z, z, z);
        }

        const useCursor =
          Number.isFinite(afterId) &&
          afterId > 0;

        if (useCursor) {
          where.push("k.id>?");
          args.push(afterId);
        }

        const clause =
          where.length
            ? `WHERE ${where.join(" AND ")}`
            : "";

        const pageLimit =
          limit + 1;

        const orderSql =
          numericSearch
            ? "CASE WHEN k.id=? THEN 0 ELSE 1 END, k.id ASC"
            : "k.id ASC";

        const orderArgs =
          numericSearch
            ? [Number(q)]
            : [];

        const cacheKey =
          JSON.stringify([
            "contributor-kirtans",
            session.id,
            status,
            q,
            limit,
            offset,
            useCursor ? afterId : 0,
          ]);

        const cached =
          readQueryCache(cacheKey);

        if (cached) {
          return json(cached);
        }

        const rows =
          await env.DB
            .prepare(`
              SELECT
                id,
                title,
                type,
                raag,
                image,
                verified,
                updated_date,
                SUBSTR(original_text, 1, 120) AS preview
              FROM tbl_kirtan k
              ${clause}
              ORDER BY ${orderSql}
              LIMIT ?
              ${useCursor ? "" : "OFFSET ?"}
            `)
            .bind(
              ...args,
              ...orderArgs,
              ...(useCursor
                ? [pageLimit]
                : [pageLimit, offset])
            )
            .all();

        const pageRows =
          rows.results || [];

        const hasMore =
          pageRows.length > limit;

        const visibleRows =
          pageRows.slice(0, limit);

        if (visibleRows.length) {
          const ids =
            visibleRows.map((row) => row.id);

          const pendingRows =
            await env.DB
              .prepare(`
                SELECT kirtan_id, id
                FROM kirtan_contributions
                WHERE contributor_id=?
                AND status='pending'
                AND kirtan_id IN (${ids.map(() => "?").join(",")})
              `)
              .bind(session.id, ...ids)
              .all();

          const pendingByKirtan =
            new Map(
              (pendingRows.results || []).map((row) => [
                row.kirtan_id,
                row.id,
              ])
            );

          for (const row of visibleRows) {
            row.pending_contribution_id =
              pendingByKirtan.get(row.id) || null;
          }
        }

        const payload = {
          rows: visibleRows.map(normalizeKirtan),
          has_more: hasMore,
          total: null,
          unverified: null,
          limit,
          offset,
        };

        return json(
          writeQueryCache(cacheKey, payload)
        );
      }

      const contributorKirtanMatch =
        u.pathname.match(/^\/api\/contributor\/kirtans\/(\d+)$/);

      if (contributorKirtanMatch && req.method === "GET") {
        const row =
          await getKirtanRow(
            env,
            Number(contributorKirtanMatch[1])
          );

        if (!row) {
          return json({ error: "Not found" }, 404);
        }

        const pending =
          await env.DB
            .prepare(`
              SELECT *
              FROM kirtan_contributions
              WHERE kirtan_id=?
              AND contributor_id=?
              AND status='pending'
              ORDER BY id DESC
              LIMIT 1
            `)
            .bind(row.id, session.id)
            .first();

        return json({
          ...normalizeKirtan(row),
          contribution: pending ? normalizeContribution(pending) : null,
        });
      }

      if (contributorKirtanMatch && req.method === "POST") {
        const before =
          await getKirtanRow(
            env,
            Number(contributorKirtanMatch[1])
          );

        if (!before) {
          return json({ error: "Not found" }, 404);
        }

        let body;
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }

        const proposed = {};
        for (const key of CONTRIBUTOR_EDITABLE_COLUMNS) {
          proposed[key] = String(body[key] ?? "");
        }

        const fields =
          changedContributorFields(before, proposed);

        if (!fields.length) {
          return json(
            {
              error: "No text changes to submit.",
            },
            400
          );
        }

        const now =
          new Date().toISOString();

        await env.DB
          .prepare(`
            UPDATE kirtan_contributions
            SET status='superseded',
                updated_at=?
            WHERE kirtan_id=?
            AND contributor_id=?
            AND status='pending'
          `)
          .bind(now, before.id, session.id)
          .run();

        await env.DB
          .prepare(`
            INSERT INTO kirtan_contributions
              (
                kirtan_id,
                contributor_id,
                contributor_username,
                base_snapshot_json,
                proposed_json,
                changed_fields,
                status,
                created_at,
                updated_at
              )
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          `)
          .bind(
            before.id,
            session.id,
            session.username,
            JSON.stringify(normalizeKirtan(before)),
            JSON.stringify(proposed),
            JSON.stringify(fields),
            now,
            now
          )
          .run();

        clearQueryCache();

        return json({
          submitted: true,
          changed_fields: fields,
        });
      }

      return json({ error: "Not found" }, 404);
    }


    /* --------------------------------------------------
       ADMIN DATA ROUTES
    -------------------------------------------------- */

    if (u.pathname.startsWith("/api/admin/")) {
      const session =
        await requireAdmin(req, env);

      if (!session) {
        return unauthorized();
      }

      if (!env.DB) {
        return json(
          {
            error: "Database is not configured.",
          },
          503
        );
      }

      await ensureContributorTables(env);

      if (u.pathname === "/api/admin/contributors" && req.method === "GET") {
        const cacheKey =
          "admin-contributors";

        const cached =
          readQueryCache(cacheKey);

        if (cached) {
          return json(cached);
        }

        const rows =
          await env.DB
            .prepare(`
              SELECT
                ${CONTRIBUTOR_COLUMNS.map((column) => `c.${column}`).join(", ")},
                COUNT(CASE WHEN kc.status='approved' THEN 1 END) AS approved_submissions
              FROM contributors c
              LEFT JOIN kirtan_contributions kc
                ON kc.contributor_id=c.id
              GROUP BY
                c.id,
                c.username,
                c.password_hash,
                c.active,
                c.created_at,
                c.updated_at,
                c.created_by
              ORDER BY c.active DESC, c.username ASC
            `)
            .all();

        return json(writeQueryCache(cacheKey, {
          rows: rows.results.map(normalizeContributor),
        }));
      }

      if (u.pathname === "/api/admin/contributors" && req.method === "POST") {
        let body;
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }

        const username =
          String(body.username || "").trim();

        const password =
          String(body.password || "");

        if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
          return json(
            {
              error: "Username must be 3-64 characters using letters, numbers, dots, underscores, or hyphens.",
            },
            400
          );
        }

        if (password.length < 8) {
          return json(
            {
              error: "Password must be at least 8 characters.",
            },
            400
          );
        }

        const now =
          new Date().toISOString();

        try {
          await env.DB
            .prepare(`
              INSERT INTO contributors
                (username, password_hash, active, created_at, updated_at, created_by)
              VALUES (?, ?, 1, ?, ?, ?)
            `)
            .bind(
              username,
              await hashPassword(password),
              now,
              now,
              session.username
            )
            .run();
        } catch {
          return json(
            {
              error: "Contributor username already exists.",
            },
            409
          );
        }

        clearQueryCache();

        return json({
          created: true,
        }, 201);
      }

      const contributorMatch =
        u.pathname.match(/^\/api\/admin\/contributors\/(\d+)$/);

      if (contributorMatch && req.method === "PUT") {
        let body;
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }

        const id =
          Number(contributorMatch[1]);

        const existing =
          await env.DB
            .prepare(`
              SELECT *
              FROM contributors
              WHERE id=?
            `)
            .bind(id)
            .first();

        if (!existing) {
          return json({ error: "Not found" }, 404);
        }

        const username =
          Object.prototype.hasOwnProperty.call(body, "username")
            ? String(body.username || "").trim()
            : existing.username;

        if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
          return json(
            {
              error: "Username must be 3-64 characters using letters, numbers, dots, underscores, or hyphens.",
            },
            400
          );
        }

        const password =
          String(body.password || "");

        if (password && password.length < 8) {
          return json(
            {
              error: "Password must be at least 8 characters.",
            },
            400
          );
        }

        const passwordHash =
          password
            ? await hashPassword(password)
            : existing.password_hash;

        const active =
          Object.prototype.hasOwnProperty.call(body, "active")
            ? dbVerified(Boolean(body.active))
            : dbVerified(Boolean(existing.active));

        try {
          await env.DB
            .prepare(`
              UPDATE contributors
              SET username=?,
                  password_hash=?,
                  active=?,
                  updated_at=?
              WHERE id=?
            `)
            .bind(
              username,
              passwordHash,
              active,
              new Date().toISOString(),
              id
            )
            .run();
        } catch {
          return json(
            {
              error: "Contributor username already exists.",
            },
            409
          );
        }

        clearQueryCache();

        return json({
          row: normalizeContributor(
            await env.DB
              .prepare(`
                SELECT *
                FROM contributors
                WHERE id=?
              `)
              .bind(id)
              .first()
          ),
        });
      }

      if (contributorMatch && req.method === "DELETE") {
        const id =
          Number(contributorMatch[1]);

        await env.DB
          .prepare(`
            DELETE FROM contributors
            WHERE id=?
          `)
          .bind(id)
          .run();

        await env.DB
          .prepare(`
            UPDATE kirtan_contributions
            SET status='archived',
                updated_at=?
            WHERE contributor_id=?
            AND status='pending'
          `)
          .bind(new Date().toISOString(), id)
          .run();

        clearQueryCache();

        return json({
          deleted: true,
          id,
        });
      }

      if (u.pathname === "/api/admin/contributions" && req.method === "GET") {
        const status =
          (u.searchParams.get("status") || "pending").trim();

        const limit =
          Math.min(
            Math.max(Number(u.searchParams.get("limit")) || 50, 1),
            200
          );

        const offset =
          Math.max(Number(u.searchParams.get("offset")) || 0, 0);

        const pageLimit =
          limit + 1;

        const cacheKey =
          JSON.stringify([
            "admin-contributions",
            status,
            limit,
            offset,
          ]);

        const cached =
          readQueryCache(cacheKey);

        if (cached) {
          return json(cached);
        }

        const rows =
          await env.DB
            .prepare(`
              SELECT
                c.id,
                c.kirtan_id,
                c.contributor_username,
                c.changed_fields,
                c.status,
                c.created_at,
                c.updated_at,
                c.reviewed_at,
                c.reviewed_by,
                k.title,
                k.raag,
                k.type,
                k.verified
              FROM kirtan_contributions c
              JOIN tbl_kirtan k
                ON k.id=c.kirtan_id
              WHERE c.status=?
              ORDER BY c.updated_at DESC
              LIMIT ? OFFSET ?
            `)
            .bind(status, pageLimit, offset)
            .all();

        const pageRows =
          rows.results || [];

        const payload = {
          rows: pageRows.slice(0, limit).map((row) => ({
            ...normalizeKirtan(row),
            changed_fields: JSON.parse(row.changed_fields || "[]"),
          })),
          has_more: pageRows.length > limit,
          total: null,
          limit,
          offset,
        };

        return json(
          writeQueryCache(cacheKey, payload)
        );
      }

      const contributionMatch =
        u.pathname.match(/^\/api\/admin\/contributions\/(\d+)$/);

      if (contributionMatch && req.method === "GET") {
        const contribution =
          await env.DB
            .prepare(`
              SELECT *
              FROM kirtan_contributions
              WHERE id=?
            `)
            .bind(Number(contributionMatch[1]))
            .first();

        if (!contribution) {
          return json({ error: "Not found" }, 404);
        }

        const current =
          await getKirtanRow(env, contribution.kirtan_id);

        return json({
          contribution: normalizeContribution(contribution),
          current: normalizeKirtan(current),
        });
      }

      const approveMatch =
        u.pathname.match(/^\/api\/admin\/contributions\/(\d+)\/approve$/);

      if (approveMatch && req.method === "POST") {
        await ensureRevisionTable(env);

        const contribution =
          await env.DB
            .prepare(`
              SELECT *
              FROM kirtan_contributions
              WHERE id=?
              AND status='pending'
            `)
            .bind(Number(approveMatch[1]))
            .first();

        if (!contribution) {
          return json({ error: "Pending contribution not found" }, 404);
        }

        const before =
          await getKirtanRow(env, contribution.kirtan_id);

        if (!before) {
          return json({ error: "Kirtan not found" }, 404);
        }

        let body;
        try {
          body = await req.json();
        } catch {
          body = {};
        }

        const proposed =
          JSON.parse(contribution.proposed_json);

        const after = {
          ...before,
        };

        for (const key of CONTRIBUTOR_EDITABLE_COLUMNS) {
          after[key] =
            Object.prototype.hasOwnProperty.call(body, key)
              ? String(body[key] ?? "")
              : String(proposed[key] ?? "");
        }

        const fields =
          changedContributorFields(before, after);

        if (fields.length) {
          await createRevision(
            env,
            before,
            fields,
            `approve-contribution:${contribution.id}`,
            session.username
          );

          await env.DB
            .prepare(`
              UPDATE tbl_kirtan
              SET original_text=?,
                  translate_text=?,
                  updated_date=?
              WHERE id=?
            `)
            .bind(
              after.original_text,
              after.translate_text,
              new Date().toISOString(),
              before.id
            )
            .run();
        }

        await env.DB
          .prepare(`
            UPDATE kirtan_contributions
            SET status='approved',
                reviewed_at=?,
                reviewed_by=?,
                admin_note=?,
                updated_at=?
            WHERE id=?
          `)
          .bind(
            new Date().toISOString(),
            session.username,
            String(body.admin_note || ""),
            new Date().toISOString(),
            contribution.id
          )
          .run();

        clearQueryCache();

        return json({
          approved: true,
          changed_fields: fields,
          row: normalizeKirtan(
            await getKirtanRow(env, before.id)
          ),
        });
      }

      const rejectMatch =
        u.pathname.match(/^\/api\/admin\/contributions\/(\d+)\/reject$/);

      if (rejectMatch && req.method === "POST") {
        let body;
        try {
          body = await req.json();
        } catch {
          body = {};
        }

        await env.DB
          .prepare(`
            UPDATE kirtan_contributions
            SET status='rejected',
                reviewed_at=?,
                reviewed_by=?,
                admin_note=?,
                updated_at=?
            WHERE id=?
            AND status='pending'
          `)
          .bind(
            new Date().toISOString(),
            session.username,
            String(body.admin_note || ""),
            new Date().toISOString(),
            Number(rejectMatch[1])
          )
          .run();

        clearQueryCache();

        return json({
          rejected: true,
        });
      }

      if (u.pathname === "/api/admin/kirtans" && req.method === "GET") {
        const q =
          (u.searchParams.get("q") || "").trim();

        const status =
          (u.searchParams.get("status") || "unverified").trim();

        const limit =
          Math.min(
            Math.max(
              Number(u.searchParams.get("limit")) || 50,
              1
            ),
            200
          );

        const offset =
          Math.max(
            Number(u.searchParams.get("offset")) || 0,
            0
          );

        const afterId =
          Number(u.searchParams.get("after_id") || 0);

        const numericSearch =
          /^\d+$/.test(q);

        const where = [];
        const args = [];

        if (status === "verified") {
          where.push("verified=1");
        } else if (status === "unverified") {
          where.push("(verified=0 OR verified IS NULL)");
        }

        if (q) {
          where.push(`
            (
              CAST(id AS TEXT) LIKE ?
              OR title LIKE ?
              OR type LIKE ?
              OR raag LIKE ?
              OR original_text LIKE ?
              OR translate_text LIKE ?
              OR transliterate_text LIKE ?
            )
          `);

          const z = `%${q}%`;
          args.push(z, z, z, z, z, z, z);
        }

        const useCursor =
          Number.isFinite(afterId) &&
          afterId > 0;

        if (useCursor) {
          where.push("id>?");
          args.push(afterId);
        }

        const clause =
          where.length
            ? `WHERE ${where.join(" AND ")}`
            : "";

        const pageLimit =
          limit + 1;

        const orderSql =
          numericSearch
            ? "CASE WHEN id=? THEN 0 ELSE 1 END, id ASC"
            : "id ASC";

        const orderArgs =
          numericSearch
            ? [Number(q)]
            : [];

        const cacheKey =
          JSON.stringify([
            "admin-kirtans",
            status,
            q,
            limit,
            offset,
            useCursor ? afterId : 0,
          ]);

        const cached =
          readQueryCache(cacheKey);

        if (cached) {
          return json(cached);
        }

        const rows =
          await env.DB
            .prepare(`
              SELECT
                id,
                title,
                type,
                raag,
                image,
                verified,
                updated_date,
                SUBSTR(original_text, 1, 120) AS preview,
                EXISTS (
                  SELECT 1
                  FROM kirtan_contributions c
                  WHERE c.kirtan_id=tbl_kirtan.id
                  AND c.status='pending'
                ) AS pending_contributions
              FROM tbl_kirtan
              ${clause}
              ORDER BY ${orderSql}
              LIMIT ?
              ${useCursor ? "" : "OFFSET ?"}
            `)
            .bind(
              ...args,
              ...orderArgs,
              ...(useCursor
                ? [pageLimit]
                : [pageLimit, offset])
            )
            .all();

        const pageRows =
          rows.results || [];

        const hasMore =
          pageRows.length > limit;

        const payload = {
          rows: pageRows.slice(0, limit).map(normalizeKirtan),
          has_more: hasMore,
          total: null,
          unverified: null,
          limit,
          offset,
        };

        return json(
          writeQueryCache(cacheKey, payload)
        );
      }

      if (u.pathname === "/api/admin/kirtans" && req.method === "POST") {
        await ensureRevisionTable(env);

        let body;
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }

        const row = {};
        for (const key of EDITABLE_COLUMNS) {
          row[key] =
            key === "verified"
              ? dbVerified(Boolean(body[key]))
              : String(body[key] ?? "");
        }

        const now = new Date().toISOString();
        const next =
          await env.DB
            .prepare(`
              SELECT COALESCE(MAX(id), 0) + 1 AS id
              FROM tbl_kirtan
            `)
            .first();

        const id =
          Number(next.id);

        await env.DB
          .prepare(`
            INSERT INTO tbl_kirtan
              (
                id,
                title,
                type,
                raag,
                original_text,
                translate_text,
                transliterate_text,
                image,
                verified,
                created_date,
                updated_date
              )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .bind(
            id,
            row.title,
            row.type,
            row.raag,
            row.original_text,
            row.translate_text,
            row.transliterate_text,
            row.image,
            row.verified,
            now,
            now
          )
          .run();

        const saved =
          await getKirtanRow(env, id);

        await createRevision(
          env,
          saved,
          EDITABLE_COLUMNS,
          "create",
          session.username
        );

        clearQueryCache();

        return json(
          {
            row: normalizeKirtan(saved),
            changed_fields: EDITABLE_COLUMNS,
          },
          201
        );
      }

      const adminKirtanMatch =
        u.pathname.match(/^\/api\/admin\/kirtans\/(\d+)$/);

      if (adminKirtanMatch && req.method === "GET") {
        const row =
          await getKirtanRow(
            env,
            Number(adminKirtanMatch[1])
          );

        return row
          ? json(normalizeKirtan(row))
          : json({ error: "Not found" }, 404);
      }

      if (adminKirtanMatch && req.method === "PUT") {
        await ensureRevisionTable(env);

        const id = Number(adminKirtanMatch[1]);
        const before =
          await getKirtanRow(env, id);

        if (!before) {
          return json({ error: "Not found" }, 404);
        }

        let body;
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }

        const after = { ...before };

        for (const key of EDITABLE_COLUMNS) {
          if (Object.prototype.hasOwnProperty.call(body, key)) {
            after[key] =
              key === "verified"
                ? dbVerified(Boolean(body[key]))
                : String(body[key] ?? "");
          }
        }

        const fields =
          changedFields(before, after);

        if (!fields.length) {
          return json({
            row: normalizeKirtan(before),
            changed_fields: [],
          });
        }

        await createRevision(
          env,
          before,
          fields,
          "update",
          session.username
        );

        const now = new Date().toISOString();

        await env.DB
          .prepare(`
            UPDATE tbl_kirtan
            SET
              title=?,
              type=?,
              raag=?,
              original_text=?,
              translate_text=?,
              transliterate_text=?,
              image=?,
              verified=?,
              updated_date=?
            WHERE id=?
          `)
          .bind(
            after.title,
            after.type,
            after.raag,
            after.original_text,
            after.translate_text,
            after.transliterate_text,
            after.image,
            dbVerified(Boolean(after.verified)),
            now,
            id
          )
          .run();

        const saved =
          await getKirtanRow(env, id);

        clearQueryCache();

        return json({
          row: normalizeKirtan(saved),
          changed_fields: fields,
        });
      }

      if (adminKirtanMatch && req.method === "DELETE") {
        await ensureRevisionTable(env);

        const id = Number(adminKirtanMatch[1]);
        const before =
          await getKirtanRow(env, id);

        if (!before) {
          return json({ error: "Not found" }, 404);
        }

        await createRevision(
          env,
          before,
          KIRTAN_COLUMNS,
          "delete",
          session.username
        );

        await env.DB
          .prepare(`
            DELETE FROM tbl_kirtan
            WHERE id=?
          `)
          .bind(id)
          .run();

        clearQueryCache();

        return json({
          deleted: true,
          id,
        });
      }

      const historyMatch =
        u.pathname.match(/^\/api\/admin\/kirtans\/(\d+)\/revisions$/);

      if (historyMatch && req.method === "GET") {
        await ensureRevisionTable(env);

        const rows =
          await env.DB
            .prepare(`
              SELECT
                id,
                kirtan_id,
                changed_fields,
                created_at,
                created_by,
                action
              FROM kirtan_revisions
              WHERE kirtan_id=?
              ORDER BY id DESC
            `)
            .bind(Number(historyMatch[1]))
            .all();

        return json({
          rows: rows.results.map((row) => ({
            ...row,
            changed_fields: JSON.parse(row.changed_fields || "[]"),
          })),
        });
      }

      const revisionMatch =
        u.pathname.match(/^\/api\/admin\/revisions\/(\d+)$/);

      if (revisionMatch && req.method === "GET") {
        await ensureRevisionTable(env);

        const revision =
          await env.DB
            .prepare(`
              SELECT *
              FROM kirtan_revisions
              WHERE id=?
            `)
            .bind(Number(revisionMatch[1]))
            .first();

        if (!revision) {
          return json({ error: "Not found" }, 404);
        }

        const current =
          await getKirtanRow(
            env,
            revision.kirtan_id
          );

        return json({
          revision: {
            ...revision,
            changed_fields: JSON.parse(revision.changed_fields || "[]"),
            snapshot: JSON.parse(revision.snapshot_json),
          },
          current: normalizeKirtan(current),
        });
      }

      const restoreMatch =
        u.pathname.match(/^\/api\/admin\/revisions\/(\d+)\/restore$/);

      if (restoreMatch && req.method === "POST") {
        await ensureRevisionTable(env);

        const revision =
          await env.DB
            .prepare(`
              SELECT *
              FROM kirtan_revisions
              WHERE id=?
            `)
            .bind(Number(restoreMatch[1]))
            .first();

        if (!revision) {
          return json({ error: "Not found" }, 404);
        }

        const snapshot =
          JSON.parse(revision.snapshot_json);

        const before =
          await getKirtanRow(
            env,
            revision.kirtan_id
          );

        if (!before) {
          return json({ error: "Not found" }, 404);
        }

        const fields =
          changedFields(before, snapshot);

        await createRevision(
          env,
          before,
          fields,
          `restore:${revision.id}`,
          session.username
        );

        const now = new Date().toISOString();

        await env.DB
          .prepare(`
            UPDATE tbl_kirtan
            SET
              title=?,
              type=?,
              raag=?,
              original_text=?,
              translate_text=?,
              transliterate_text=?,
              image=?,
              verified=?,
              updated_date=?
            WHERE id=?
          `)
          .bind(
            snapshot.title,
            snapshot.type,
            snapshot.raag,
            snapshot.original_text,
            snapshot.translate_text,
            snapshot.transliterate_text,
            snapshot.image,
            dbVerified(Boolean(snapshot.verified)),
            now,
            snapshot.id
          )
          .run();

        clearQueryCache();

        return json({
          row: normalizeKirtan(
            await getKirtanRow(env, snapshot.id)
          ),
          changed_fields: fields,
        });
      }

      if (
        (
          u.pathname === "/api/admin/kirtans.csv" ||
          u.pathname === "/api/admin/kirtan.csv"
        ) &&
        req.method === "GET"
      ) {
        const kirtans =
          await env.DB
            .prepare(`
              SELECT ${KIRTAN_COLUMNS.join(", ")}
              FROM tbl_kirtan
              ORDER BY id ASC
            `)
            .all();

        const lines = [
          KIRTAN_COLUMNS.map(csvValue).join(","),
          ...kirtans.results.map((row) =>
            csvRow(KIRTAN_COLUMNS, row)
          ),
          "",
        ];

        return new Response(
          lines.join("\r\n"),
          {
            status: 200,
            headers: {
              "content-type": "text/csv;charset=utf-8",
              "content-disposition":
                'attachment; filename="kirtans.csv"',
              "cache-control": "no-store",
            },
          }
        );
      }

      if (
        (
          u.pathname === "/api/admin/kirtan.sql" ||
          u.pathname === "/api/admin/database.sql"
        ) &&
        req.method === "GET"
      ) {
        const kirtans =
          await env.DB
            .prepare(`
              SELECT ${KIRTAN_COLUMNS.join(", ")}
              FROM tbl_kirtan
              ORDER BY id ASC
            `)
            .all();

        const lines = [
          "-- Pushti Kirtan public database export",
          `-- Exported at ${new Date().toISOString()}`,
          "-- Private contributor, contribution review, and revision metadata are intentionally excluded.",
          "PRAGMA foreign_keys=OFF;",
          "BEGIN TRANSACTION;",
          "",
          "DROP TABLE IF EXISTS tbl_kirtan;",
          "",
          `CREATE TABLE tbl_kirtan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  type TEXT NOT NULL,
  raag TEXT NOT NULL,
  original_text TEXT NOT NULL,
  translate_text TEXT,
  transliterate_text TEXT,
  image TEXT,
  verified BOOLEAN NOT NULL DEFAULT 0,
  created_date TEXT NOT NULL,
  updated_date TEXT NOT NULL
);`,
          "",
          ...kirtans.results.map((row) =>
            insertStatement(
              "tbl_kirtan",
              KIRTAN_COLUMNS,
              {
                ...row,
                verified: dbVerified(Boolean(row.verified)),
              }
            )
          ),
          "",
          "COMMIT;",
          "PRAGMA foreign_keys=ON;",
          "",
        ];

        return new Response(
          lines.join("\n"),
          {
            status: 200,
            headers: {
              "content-type": "application/sql;charset=utf-8",
              "content-disposition":
                'attachment; filename="kirtan.sql"',
              "cache-control": "no-store",
            },
          }
        );
      }

      if (u.pathname === "/api/admin/backup" && req.method === "GET") {
        const kirtans =
          await env.DB
            .prepare(`
              SELECT ${KIRTAN_COLUMNS.join(", ")}
              FROM tbl_kirtan
              ORDER BY id ASC
            `)
            .all();

        return new Response(
          JSON.stringify(
            {
              exported_at: new Date().toISOString(),
              note:
                "Public corpus export only. Private contributor, contribution review, and revision metadata are intentionally excluded.",
              tables: {
                tbl_kirtan:
                  kirtans.results.map(normalizeKirtan),
              },
            },
            null,
            2
          ),
          {
            status: 200,
            headers: {
              "content-type": "application/json;charset=utf-8",
              "content-disposition":
                'attachment; filename="pushti-kirtan-d1-backup.json"',
            },
          }
        );
      }

      return json({ error: "Not found" }, 404);
    }


    /* --------------------------------------------------
       FILTER DROPDOWNS
    -------------------------------------------------- */

    if (
      u.pathname ===
      "/api/filters"
    ) {

      const rows =
        (
          await getStaticPublicKirtans(
            env,
            u.origin
          )
        ).filter(isVerifiedPublicKirtan);

      return cachedJson({
        raags: [
          ...new Set(
            rows
              .map((row) => row.raag)
              .filter(Boolean)
          ),
        ].sort(),
        types: [
          ...new Set(
            rows
              .map((row) => row.type)
              .filter(Boolean)
          ),
        ].sort(),
      });

    }


    /* --------------------------------------------------
       SINGLE KIRTAN
    -------------------------------------------------- */

    const idMatch =
      u.pathname.match(
        /^\/api\/kirtans\/(\d+)$/
      );


    if (idMatch) {

      const id =
        Number(idMatch[1]);


      const row =
        await getStaticPublicKirtan(
          env,
          u.origin,
          id
        );


      return row
        ? cachedJson(row)
        : json(
            {
              error:
                "Not found",
            },
            404
          );

    }


    /* --------------------------------------------------
       KIRTAN LIST + SEARCH
    -------------------------------------------------- */

    if (
      u.pathname ===
      "/api/kirtans"
    ) {

      const q =
        (
          u.searchParams.get("q") ||
          ""
        ).trim();

      const raag =
        (
          u.searchParams.get("raag") ||
          ""
        ).trim();

      const type =
        (
          u.searchParams.get("type") ||
          ""
        ).trim();

      const summary =
        u.searchParams.get(
          "summary"
        ) === "1";

      return cachedJson(
        await filterStaticPublicKirtans(
          env,
          u.origin,
          {
            q,
            raag,
            type,
            summary,
          }
        )
      );


      /*
        Local/sample fallback
      */

      if (!env.DB) {

        return json(
          filterSample(
            q,
            raag,
            type
          )
        );

      }


      /*
        SUMMARY MODE

        Used by homepage cards.

        When a search is being performed,
        we can still search the full columns
        even though only the summary fields
        are returned.
      */

      let sql =
        summary

          ? `
            SELECT
              id,
              title,
              type,
              raag,
              image,
              SUBSTR(
                original_text,
                1,
                100
              ) AS preview,
              verified
            FROM tbl_kirtan
            WHERE verified=1
          `

          : `
            SELECT
              id,
              created_date,
              updated_date,
              title,
              type,
              raag,
              original_text,
              translate_text,
              transliterate_text,
              image,
              verified
            FROM tbl_kirtan
            WHERE verified=1
          `;


      const v = [];


      /* --------------------------------------------------
         FULL-TEXT STYLE SEARCH

         Searches:

         original_text
           Hindi / Braj

         translate_text
           English translation

         transliterate_text
           Roman transliteration

         title
           Kirtan title
      -------------------------------------------------- */

      if (q) {

        sql += `
          AND (
            original_text LIKE ?
            OR translate_text LIKE ?
            OR transliterate_text LIKE ?
            OR title LIKE ?
          )
        `;


        const z =
          `%${q}%`;


        v.push(
          z,
          z,
          z,
          z
        );

      }


      /* --------------------------------------------------
         RAAG FILTER
      -------------------------------------------------- */

      if (raag) {

        sql +=
          " AND raag=?";

        v.push(raag);

      }


      /* --------------------------------------------------
         OCCASION FILTER
      -------------------------------------------------- */

      if (type) {

        sql +=
          " AND type=?";

        v.push(type);

      }


      /*
        Keep results in stable order.
      */

      sql +=
        " ORDER BY id ASC";


      const result =
        await env.DB
          .prepare(sql)
          .bind(...v)
          .all();


      return json(
        result.results
      );

    }


    /* --------------------------------------------------
       STATIC WEBSITE FILES
    -------------------------------------------------- */

    return env.ASSETS.fetch(req);

  },

};
