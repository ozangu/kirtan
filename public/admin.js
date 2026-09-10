const PAGE_SIZE = 50;

const els = {
  login: document.getElementById("admin-login"),
  dashboard: document.getElementById("admin-dashboard"),
  form: document.getElementById("admin-login-form"),
  error: document.getElementById("admin-login-error"),
  searchForm: document.getElementById("admin-search-form"),
  search: document.getElementById("admin-search"),
  status: document.getElementById("admin-status"),
  results: document.getElementById("admin-results"),
  count: document.getElementById("admin-count"),
  prev: document.getElementById("admin-prev"),
  next: document.getElementById("admin-next"),
  pageState: document.getElementById("admin-page-state"),
  logout: document.getElementById("admin-logout"),
  reviewToggle: document.getElementById("admin-review-toggle"),
  reviewPanel: document.getElementById("admin-review-panel"),
  reviewRefresh: document.getElementById("admin-review-refresh"),
  reviewResults: document.getElementById("admin-review-results"),
  contributorsToggle: document.getElementById("admin-contributors-toggle"),
  contributorsPanel: document.getElementById("admin-contributors-panel"),
  contributorForm: document.getElementById("admin-contributor-form"),
  contributorError: document.getElementById("admin-contributor-error"),
  contributorsResults: document.getElementById("admin-contributors-results"),
};

let offset = 0;
let hasMore = false;
let pageIndex = 0;
let pageCursors = [""];
let currentRows = [];
let hasActiveSearch = false;
const inFlightRequests = new Map();

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
  document.body.classList.remove("is-admin-authenticated");
}

function showDashboard() {
  els.login.hidden = true;
  els.dashboard.hidden = false;
  document.body.classList.add("is-admin-authenticated");
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
    await fetchJSON("/api/admin/login-challenge");

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

function pendingPill(count) {
  return Number(count) > 0
    ? `<span class="admin-status admin-status--pending">${count} pending</span>`
    : "";
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
          <th>Review</th>
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
            <td>${pendingPill(row.pending_contributions)}</td>
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

function renderReviewRows(rows) {
  if (!rows.length) {
    els.reviewResults.innerHTML =
      '<div class="empty-state">No kirtans are waiting for review.</div>';
    return;
  }

  els.reviewResults.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Kirtan</th>
          <th>Contributor</th>
          <th>Fields</th>
          <th>Submitted</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${row.id}</td>
            <td>${esc(row.title || `Kirtan #${row.kirtan_id}`)}</td>
            <td>${esc(row.contributor_username)}</td>
            <td>${esc(row.changed_fields.join(", "))}</td>
            <td>${esc(row.updated_at)}</td>
            <td>
              <a class="admin-table__open" href="${esc(`${kirtanHref(row)}?review=${encodeURIComponent(row.id)}`)}">
                Review
              </a>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function loadReviews() {
  if (!els.reviewResults) return;

  els.reviewResults.innerHTML =
    '<div class="loading">Loading review queue</div>';

  const data =
    await requestOnce(
      "reviews:pending",
      () => fetchJSON("/api/admin/contributions?status=pending")
    );

  renderReviewRows(data.rows);
}

function renderContributors(rows) {
  if (!rows.length) {
    els.contributorsResults.innerHTML =
      '<div class="empty-state">No contributors yet.</div>';
    return;
  }

  els.contributorsResults.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Username</th>
          <th>Approved</th>
          <th>Status</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${esc(row.username)}</td>
            <td>
              <span class="admin-stat-pill">${Number(row.approved_submissions || 0)} approved</span>
            </td>
            <td>${row.active ? '<span class="admin-status admin-status--verified">Active</span>' : '<span class="admin-status admin-status--unverified">Disabled</span>'}</td>
            <td>${esc(row.created_at)}</td>
            <td>
              <div class="admin-actions">
                <button class="admin-button" type="button" data-reset-contributor="${row.id}">Reset Password</button>
                <button class="admin-button" type="button" data-toggle-contributor="${row.id}" data-active="${row.active ? "0" : "1"}">${row.active ? "Disable" : "Enable"}</button>
                <button class="admin-button admin-button--danger" type="button" data-delete-contributor="${row.id}">Delete</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function loadContributors() {
  if (!els.contributorsResults) return;

  els.contributorsResults.innerHTML =
    '<div class="loading">Loading contributors</div>';

  const data =
    await requestOnce(
      "contributors",
      () => fetchJSON("/api/admin/contributors")
    );

  renderContributors(data.rows);
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
      () => fetchJSON(`/api/admin/kirtans?${params}`)
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
  const session =
    await fetchJSON("/api/admin/session")
      .catch(() => ({ authenticated: false }));

  if (!session.authenticated) {
    showLogin();
    return;
  }

  showDashboard();
  showSearchPrompt();
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

    await fetchJSON("/api/admin/login", {
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

    const session =
      await fetchJSON("/api/admin/session");

    if (!session.authenticated) {
      throw new Error("Login succeeded, but the session cookie was not saved. Please allow cookies for this site.");
    }

    showDashboard();
    showSearchPrompt();
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
  offset = 0;
  pageIndex = 0;
  pageCursors = [""];
  await loadRows();
});

els.status.addEventListener("change", async () => {
  offset = 0;
  pageIndex = 0;
  pageCursors = [""];
  await loadRows();
});

els.reviewToggle?.addEventListener("click", async () => {
  els.reviewPanel.hidden = !els.reviewPanel.hidden;
  if (!els.reviewPanel.hidden) {
    await loadReviews();
  }
});

els.reviewRefresh?.addEventListener("click", loadReviews);

els.contributorsToggle?.addEventListener("click", async () => {
  els.contributorsPanel.hidden = !els.contributorsPanel.hidden;
  if (!els.contributorsPanel.hidden) {
    await loadContributors();
  }
});

els.contributorForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.contributorError.textContent = "";

  const form = new FormData(els.contributorForm);

  try {
    await fetchJSON("/api/admin/contributors", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });

    els.contributorForm.reset();
    await loadContributors();
  } catch (err) {
    els.contributorError.textContent =
      err.message || "Could not add contributor.";
  }
});

els.contributorsResults?.addEventListener("click", async (event) => {
  const target =
    event.target instanceof Element
      ? event.target
      : null;

  if (!target) return;

  const reset =
    target.closest("[data-reset-contributor]");

  if (reset) {
    const password =
      prompt("Enter the new contributor password:");

    if (!password) return;

    await fetchJSON(`/api/admin/contributors/${reset.dataset.resetContributor}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ password }),
    });

    await loadContributors();
    return;
  }

  const toggle =
    target.closest("[data-toggle-contributor]");

  if (toggle) {
    await fetchJSON(`/api/admin/contributors/${toggle.dataset.toggleContributor}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        active: toggle.dataset.active === "1",
      }),
    });

    await loadContributors();
    return;
  }

  const del =
    target.closest("[data-delete-contributor]");

  if (del) {
    if (!confirm("Delete this contributor? Pending submissions from this contributor will be archived.")) {
      return;
    }

    await fetchJSON(`/api/admin/contributors/${del.dataset.deleteContributor}`, {
      method: "DELETE",
    });

    await loadContributors();
  }
});

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
  await fetch("/api/admin/logout", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
  location.reload();
});

init();
