const PAGE_SIZE = 50;

const els = {
  login: document.getElementById("contributor-login"),
  dashboard: document.getElementById("contributor-dashboard"),
  form: document.getElementById("contributor-login-form"),
  error: document.getElementById("contributor-login-error"),
  searchForm: document.getElementById("contributor-search-form"),
  search: document.getElementById("contributor-search"),
  status: document.getElementById("contributor-status"),
  results: document.getElementById("contributor-results"),
  count: document.getElementById("contributor-count"),
  prev: document.getElementById("contributor-prev"),
  next: document.getElementById("contributor-next"),
  pageState: document.getElementById("contributor-page-state"),
  logout: document.getElementById("contributor-logout"),
  historySummary: document.getElementById("contributor-history-summary"),
  historyRefresh: document.getElementById("contributor-history-refresh"),
  historyResults: document.getElementById("contributor-history-results"),
};

let offset = 0;
let hasMore = false;
let pageIndex = 0;
let pageCursors = [""];
let currentRows = [];
let hasActiveSearch = false;
const inFlightRequests = new Map();

function resetListState() {
  offset = 0;
  pageIndex = 0;
  pageCursors = [""];
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function hasDevanagariText(value) {
  return /[\u0904-\u0939\u0958-\u0961\u0971-\u097F]/.test(value);
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "kirtan";
}

function kirtanHref(row) {
  const id =
    row.kirtan_id || row.id;

  const parts =
    String(row.title || "")
      .split(/[|｜]/)
      .map((part) => part.trim())
      .filter(Boolean);

  const roman =
    parts.find((part) => !hasDevanagariText(part)) ||
    parts[0] ||
    `kirtan-${id}`;

  return `/kirtan/${slugify(roman)}-${id}`;
}

async function fetchJSON(url, options) {
  const res = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || String(res.status));
  }

  return res.json();
}

async function requestOnce(key, loader) {
  const existing =
    inFlightRequests.get(key);

  if (existing) {
    return existing;
  }

  const request =
    loader().finally(() => {
      inFlightRequests.delete(key);
    });

  inFlightRequests.set(key, request);
  return request;
}

function showLogin() {
  els.login.hidden = false;
  els.dashboard.hidden = true;
}

function showDashboard() {
  els.login.hidden = true;
  els.dashboard.hidden = false;
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

async function solveLoginChallenge() {
  const challenge =
    await fetchJSON("/api/contributor/login-challenge");

  const target =
    "0".repeat(challenge.difficulty);

  for (let nonce = 0; nonce < 10_000_000; nonce += 1) {
    const digest =
      await sha256Hex(`${challenge.token}:${nonce}`);

    if (digest.startsWith(target)) {
      return {
        challengeToken: challenge.token,
        challengeNonce: String(nonce),
      };
    }

    if (nonce % 250 === 0) {
      await new Promise(requestAnimationFrame);
    }
  }

  throw new Error("Login check timed out. Please try again.");
}

function statusPill(row) {
  return row.verified
    ? '<span class="admin-status admin-status--verified">Verified</span>'
    : '<span class="admin-status admin-status--unverified">Unverified</span>';
}

function contributionStatusPill(status) {
  const label =
    String(status || "pending");

  const className =
    label === "approved"
      ? "admin-status--verified"
      : label === "rejected"
        ? "admin-status--rejected"
        : "admin-status--pending";

  return `<span class="admin-status ${className}">${esc(label)}</span>`;
}

function formatDate(value) {
  if (!value) return "";

  const date =
    new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderRows(rows) {
  if (!rows.length) {
    els.results.innerHTML =
      '<div class="empty-state">No kirtans found.</div>';
    return;
  }

  els.results.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Title</th>
          <th>Raag</th>
          <th>Occasion</th>
          <th>Status</th>
          <th>Contribution</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${row.id}</td>
            <td>
              <a href="${esc(kirtanHref(row))}">
                ${esc(row.title || row.preview || `Kirtan #${row.id}`)}
              </a>
            </td>
            <td>${esc(row.raag || "")}</td>
            <td>${esc(row.type || "")}</td>
            <td>${statusPill(row)}</td>
            <td>${row.pending_contribution_id ? '<span class="admin-status admin-status--pending">Pending</span>' : ""}</td>
            <td>
              <a class="admin-table__open" href="${esc(kirtanHref(row))}">
                Open
              </a>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function showSearchPrompt() {
  hasMore = false;
  currentRows = [];
  els.results.innerHTML =
    '<div class="empty-state">Search by kirtan ID, title, raag, occasion, or text to see results.</div>';
  els.count.textContent = "Search to load kirtans";
  els.pageState.textContent = "Page 0";
  els.prev.disabled = true;
  els.next.disabled = true;
}

function renderHistory(rows) {
  if (!els.historyResults) return;

  if (!rows.length) {
    els.historyResults.innerHTML =
      '<div class="empty-state">No submissions yet.</div>';
    return;
  }

  els.historyResults.innerHTML = `
    <table class="admin-table contributor-history-table">
      <thead>
        <tr>
          <th>Kirtan</th>
          <th>Status</th>
          <th>Fields</th>
          <th>Submitted</th>
          <th>Reviewed</th>
          <th>Admin Note</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>
              <a href="${esc(kirtanHref(row))}">
                ${esc(row.title || `Kirtan #${row.kirtan_id}`)}
              </a>
            </td>
            <td>${contributionStatusPill(row.status)}</td>
            <td>${esc((row.changed_fields || []).join(", "))}</td>
            <td>${esc(formatDate(row.created_at))}</td>
            <td>${esc(formatDate(row.reviewed_at))}</td>
            <td class="contributor-history-table__note">
              ${row.status === "rejected" && row.admin_note
                ? esc(row.admin_note)
                : ""
              }
            </td>
            <td>
              <a class="admin-table__open" href="${esc(kirtanHref(row))}">
                Open
              </a>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function loadHistory() {
  if (!els.historyResults || !els.historySummary) return;

  els.historyResults.innerHTML =
    '<div class="loading">Loading contribution history</div>';

  const data =
    await requestOnce(
      "contributions:limit=100",
      () => fetchJSON("/api/contributor/contributions?limit=100")
    );

  const summary =
    data.summary || {};

  els.historySummary.textContent =
    `${Number(summary.approved || 0)} approved · ${Number(summary.pending || 0)} pending · ${Number(summary.rejected || 0)} rejected`;

  renderHistory(data.rows || []);
}

async function loadRows() {
  const q = els.search.value.trim();

  if (!hasActiveSearch || !q) {
    showSearchPrompt();
    return;
  }

  const cursor =
    pageCursors[pageIndex] || "";

  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    status: els.status.value,
  });

  if (cursor) {
    params.set("after_id", cursor);
  } else {
    params.set("offset", "0");
  }

  params.set("q", q);

  const data =
    await requestOnce(
      `kirtans:${params.toString()}`,
      () => fetchJSON(`/api/contributor/kirtans?${params}`)
    );

  hasMore = Boolean(data.has_more);
  currentRows = data.rows;
  renderRows(data.rows);

  const start =
    data.rows.length ? offset + 1 : 0;

  const end =
    offset + data.rows.length;

  els.count.textContent =
    `Showing ${start}-${end}${hasMore ? "+" : ""}`;

  els.pageState.textContent =
    data.rows.length
      ? `Page ${Math.floor(offset / PAGE_SIZE) + 1}`
      : "Page 0";

  els.prev.disabled = offset <= 0;
  els.next.disabled = !hasMore;
}

async function init() {
  if (els.status) {
    els.status.value = "unverified";
  }

  const session =
    await fetchJSON("/api/contributor/session")
      .catch(() => ({ authenticated: false }));

  if (!session.authenticated) {
    showLogin();
    return;
  }

  showDashboard();
  showSearchPrompt();
  await loadHistory();
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.error.textContent = "";

  const form = new FormData(els.form);
  const button =
    els.form.querySelector('button[type="submit"]');
  const buttonText =
    button?.textContent;

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Checking...";
    }

    const challenge =
      await solveLoginChallenge();

    await fetchJSON("/api/contributor/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
        ...challenge,
      }),
    });

    showDashboard();
    showSearchPrompt();
    await loadHistory();
  } catch (err) {
    els.error.textContent =
      err.message || "Invalid username or password.";
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = buttonText;
    }
  }
});

els.searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hasActiveSearch = true;
  resetListState();
  await loadRows();
});

els.status.addEventListener("change", async () => {
  resetListState();
  await loadRows();
});

els.historyRefresh?.addEventListener("click", loadHistory);

els.prev.addEventListener("click", async () => {
  pageIndex = Math.max(0, pageIndex - 1);
  offset = Math.max(0, offset - PAGE_SIZE);
  await loadRows();
});

els.next.addEventListener("click", async () => {
  const last =
    currentRows[currentRows.length - 1];

  if (last?.id) {
    pageCursors[pageIndex + 1] = String(last.id);
  }

  pageIndex += 1;
  offset += PAGE_SIZE;
  await loadRows();
});

els.logout.addEventListener("click", async () => {
  await fetch("/api/contributor/logout", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
  location.reload();
});

init();
