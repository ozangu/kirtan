const PLACEHOLDER = "/images/placeholder.png";

const REFERENCE_PDFS = [
  {
    label: "Volume 1",
    url: "https://dn711008.ca.archive.org/0/items/IPRLC-Hindi/_HIN_Kirtan%20Sangrah%20Part%201%20Best%20Quality.pdf",
  },
  {
    label: "Volume 2",
    url: "https://dn711008.ca.archive.org/0/items/IPRLC-Hindi/_HIN_Kirtan%20Sangrah%20Part%202%20Best%20Quality.pdf",
  },
  {
    label: "Volume 3",
    url: "https://dn711008.ca.archive.org/0/items/IPRLC-Hindi/_HIN_Kirtan%20Sangrah%20Part%203%20Best%20Quality.pdf",
  },
  {
    label: "Volume 4",
    url: "https://dn711008.ca.archive.org/0/items/IPRLC-Hindi/_HIN_Kirtan%20Sangrah%20Part%204%20Best%20Quality.pdf",
  },
];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "kirtan";
}

function rootRelativeAsset(path) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith("/")) {
    return value;
  }
  return `/${value.replace(/^\.?\//, "")}`;
}

function isDevanagariLine(line) {
  return /[\u0900-\u097F]/.test(line);
}


function splitPipeLabel(value) {
  const parts =
    String(value ?? "")
      .split(/[|｜]/)
      .map((part) => part.trim())
      .filter(Boolean);

  const hasDevanagariText = (part) =>
    /[\u0904-\u0939\u0958-\u0961\u0971-\u097F]/.test(part);

  if (parts.length >= 2) {
    const [first, second] = parts;

    if (
      hasDevanagariText(first) &&
      !hasDevanagariText(second)
    ) {
      return {
        devanagari: first,
        roman: second
      };
    }

    return {
      devanagari: second,
      roman: first
    };
  }

  return {
    devanagari: parts.find(hasDevanagariText) || parts[0] || "",
    roman: parts.find((part) => !hasDevanagariText(part)) || ""
  };
}

function kirtanSlug(kirtan) {
  const titleParts =
    splitPipeLabel(kirtan?.title || "");

  return `${slugify(titleParts.roman || titleParts.devanagari || `kirtan-${kirtan.id}`)}-${kirtan.id}`;
}

function kirtanPath(kirtan) {
  return `/kirtan/${kirtanSlug(kirtan)}`;
}

function collectionSlug(value) {
  const labels =
    splitPipeLabel(value);

  return slugify(labels.roman || labels.devanagari || value);
}

function collectionPath(kind, value) {
  return `/${kind}/${collectionSlug(value)}`;
}

function kirtanIdFromLocation() {
  const pathMatch =
    location.pathname.match(/^\/kirtan\/[^/]*-(\d+)$/);

  if (pathMatch) {
    return pathMatch[1];
  }

  return new URLSearchParams(location.search).get("id");
}


function formatRaag(value) {
  if (!value) return "";

  const labels =
    splitPipeLabel(value);

  if (
    labels.devanagari &&
    labels.roman
  ) {
    return `राग ${labels.devanagari} · Raga ${labels.roman}`;
  }

  return value
    .replace(/[()]/g, "")
    .replace(/\s*[|｜]\s*/g, " · ");
}


function formatMetadata(value) {
  return String(value ?? "")
    .replace(/[()]/g, "")
    .replace(/\s*[|｜]\s*/g, " · ")
    .trim();
}


function formatType(value) {
  if (!value) return "";

  const labels =
    splitPipeLabel(value);

  const roman =
    labels.roman
      .replace(/^\s*\d{3}\s+/, "")
      .trim();

  if (
    labels.devanagari &&
    roman
  ) {
    return `${labels.devanagari} · ${roman}`;
  }

  return formatMetadata(value)
    .replace(/^\s*\d{3}\s+/, "");
}


function renderTextContent(content, modifier) {
  return String(content ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      const isDevanagari =
        isDevanagariLine(line);

      const scriptClass =
        isDevanagari
          ? " text-line--devanagari"
          : " text-line--latin";

      if (!trimmed) {
        return `<span class="text-line text-line--blank" aria-hidden="true"></span>`;
      }

      return `<span class="text-line${scriptClass}">${esc(line)}</span>`;
    })
    .join("");
}


function textFromSection(section) {
  if (!section) return "";

  return Array
    .from(section.querySelectorAll(".text-line"))
    .map((line) =>
      line.classList.contains("text-line--blank")
        ? ""
        : line.textContent
    )
    .join("\n")
    .trim();
}


async function copyToClipboard(text) {
  if (!text) return false;

  if (
    navigator.clipboard &&
    window.isSecureContext
  ) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea =
    document.createElement("textarea");

  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";

  document.body.appendChild(textarea);
  textarea.select();

  const copied =
    document.execCommand("copy");

  textarea.remove();

  return copied;
}


function block(content, modifier, label) {
  if (!String(content ?? "").trim()) return "";

  return `
    <section class="text-section text-section--${modifier}">
      <div class="text-section__label">${label}</div>
      <div class="text-section__content">${renderTextContent(content, modifier)}</div>
    </section>`;
}


function removeEndingMarker(content) {
  return String(content ?? "")
    .replace(/\s*✿\s*$/u, "")
    .trim();
}


function removeRaagLines(content) {
  const lines =
    String(content ?? "").split(/\r?\n/);

  const isRaagLine = (line) => {
    const trimmed =
      line
        .trim()
        .replace(/^\*{1,2}|\*{1,2}$/g, "")
        .trim()
        .replace(/^\(|\)$/g, "")
        .trim();

    return (
      /^राग(?:\s|[|｜·:：-]).*Raga/i.test(trimmed) ||
      /^Raga(?:\s|[|｜·:：-]).*राग/i.test(trimmed)
    );
  };

  const cleaned =
    lines.filter(
      (line) => !isRaagLine(line)
    );

  while (
    cleaned.length &&
    !cleaned[0].trim()
  ) {
    cleaned.shift();
  }

  return cleaned.join("\n");
}


/*
  Remove the repeated kirtan title from the beginning
  of translate_text.

  The title is already displayed prominently at the
  top of the page, so we do not need to display it
  again inside the translation section.
*/
function removeRepeatedTitle(content, title) {
  if (!content || !title) {
    return content || "";
  }

  const lines =
    String(content).split(/\r?\n/);


  const normalize = (s) =>
    String(s)
      .replace(/\s+/g, " ")
      .replace(/[|｜]/g, "|")
      .trim()
      .toLowerCase();


  const titleNorm =
    normalize(title);


  /*
    Find the first line that actually contains text.
  */
  const firstContentIndex =
    lines.findIndex(
      (line) => line.trim()
    );


  if (firstContentIndex === -1) {
    return content;
  }


  const firstLineNorm =
    normalize(
      lines[firstContentIndex]
    );


  /*
    Remove the first line only if it matches
    the page title.

    This also handles small formatting differences
    such as extra spaces around the | character.
  */
  if (
    firstLineNorm === titleNorm ||
    firstLineNorm.includes(titleNorm) ||
    titleNorm.includes(firstLineNorm)
  ) {

    lines.splice(
      firstContentIndex,
      1
    );


    /*
      Remove blank lines left at the beginning
      after deleting the duplicate title.
    */
    while (
      lines.length &&
      !lines[0].trim()
    ) {
      lines.shift();
    }


    return lines.join("\n");
  }


  return content;
}

async function adjacentKirtans(id) {
  const numericId =
    Number(id);

  if (!Number.isFinite(numericId)) {
    return {
      previous: null,
      next: null
    };
  }

  const list =
    await KirtanAPI
      .getAllKirtans()
      .catch(() => []);

  const sorted =
    list
      .filter((item) =>
        Number.isFinite(Number(item.id))
      )
      .sort((a, b) =>
        Number(a.id) - Number(b.id)
      );

  return sorted.reduce(
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
      next: null
    }
  );
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
      href="${esc(kirtanPath(kirtan))}"
      aria-label="${label} kirtan: ${esc(kirtanNavTitle(kirtan))}"
    >
      <span class="kirtan-adjacent__label">
        ${direction === "previous" ? `${arrow} ${label}` : `${label} ${arrow}`}
      </span>
      <span class="kirtan-adjacent__title">${esc(kirtanNavTitle(kirtan))}</span>
    </a>
  `;
}

function adjacentKirtansHtml(nav) {
  if (!nav.previous && !nav.next) {
    return "";
  }

  return `
    <nav class="kirtan-adjacent" aria-label="Adjacent kirtans">
      ${adjacentKirtanLink(nav.previous, "previous")}
      ${adjacentKirtanLink(nav.next, "next")}
    </nav>
  `;
}

function enhanceServerRenderedKirtan({
  content,
  k,
  shareHtml,
  audioSearch,
  stickySummaryHtml,
  adjacent,
}) {
  const page =
    content.querySelector(".kirtan-detail");

  if (
    !page ||
    page.id !== `kirtan-${k.id}`
  ) {
    return false;
  }

  const header =
    page.querySelector(".kirtan-detail__header");

  if (
    header &&
    !header.querySelector(".kirtan-share")
  ) {
    header.insertAdjacentHTML(
      "beforeend",
      `${shareHtml}${audioSearch}`
    );
  }

  const visual =
    page.querySelector(".kirtan-detail__visual");

  if (
    visual &&
    !visual.querySelector(".kirtan-detail__sticky-summary")
  ) {
    visual.insertAdjacentHTML(
      "beforeend",
      stickySummaryHtml
    );
  }

  const detailContent =
    page.querySelector(".kirtan-detail__content");

  if (
    detailContent &&
    !detailContent.querySelector(".kirtan-adjacent")
  ) {
    detailContent.insertAdjacentHTML(
      "beforeend",
      adjacentKirtansHtml(adjacent)
    );
  }

  bindReadingToolbar(
    page.querySelector(".reading-shell")
  );

  bindKirtanImageTransition(page);

  return true;
}

function bindServerRenderedPublicKirtan(content, id) {
  const page =
    content.querySelector(".kirtan-detail");

  if (
    !page ||
    page.id !== `kirtan-${id}`
  ) {
    return false;
  }

  bindReadingToolbar(
    page.querySelector(".reading-shell")
  );

  bindKirtanImageTransition(page);

  return true;
}

function hasPrivateKirtanSessionCookie() {
  return /(?:^|;\s*)(?:pk_admin|pk_contributor)=/.test(
    document.cookie || ""
  );
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


function audioSearchHtml(k) {
  const originalFirstLine =
    cleanSearchLine(
      firstMeaningfulLine(
        removeRaagLines(k.original_text)
      )
    );

  const transliterationFirstLine =
    cleanSearchLine(
      firstMeaningfulLine(k.transliterate_text)
    );

  const query =
    [
      originalFirstLine,
      transliterationFirstLine,
      "kirtan audio video"
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
        href="${esc(searchUrl)}"
        target="_blank"
        rel="noopener noreferrer"
      >
        Search the web for audio or video of this kirtan
      </a>
    </aside>
  `;
}

async function adminSession() {
  return fetch("/api/admin/session")
    .then((res) => res.ok ? res.json() : { authenticated: false })
    .catch(() => ({ authenticated: false }));
}

async function contributorSession() {
  return fetch("/api/contributor/session")
    .then((res) => res.ok ? res.json() : { authenticated: false })
    .catch(() => ({ authenticated: false }));
}


async function fetchAdminKirtan(id) {
  const res =
    await fetch(`/api/admin/kirtans/${encodeURIComponent(id)}`);

  if (!res.ok) {
    throw new Error(String(res.status));
  }

  return res.json();
}

async function fetchContributorKirtan(id) {
  const res =
    await fetch(`/api/contributor/kirtans/${encodeURIComponent(id)}`);

  if (!res.ok) {
    throw new Error(String(res.status));
  }

  return res.json();
}

async function fetchAdminContribution(id) {
  const res =
    await fetch(`/api/admin/contributions/${encodeURIComponent(id)}`);

  if (!res.ok) {
    throw new Error(String(res.status));
  }

  return res.json();
}


function adminStatus(k) {
  return k.verified
    ? `<span class="admin-status admin-status--verified">Status: Verified</span>`
    : `<span class="admin-status admin-status--unverified">Status: Unverified</span>`;
}


function adminToolbar(k) {
  const isNew =
    !k.id;

  return `
    <div class="kirtan-admin-toolbar">
      <div class="kirtan-admin-toolbar__left">
        <strong>${isNew ? "Admin Mode: New Kirtan" : "Admin Mode"}</strong>
        ${isNew ? "" : adminStatus(k)}
        ${!isNew && !k.verified
          ? `<span class="kirtan-admin-toolbar__note">Public users cannot see this kirtan.</span>`
          : ""
        }
      </div>
      <div class="kirtan-admin-toolbar__actions">
        <a class="admin-button" href="/admin">Admin Home</a>
        ${isNew
          ? ""
          : `<button type="button" class="admin-button admin-button--primary" data-admin-edit>Edit Kirtan</button>
             <button type="button" class="admin-button" data-admin-history>History</button>`
        }
        <button type="button" class="admin-button" data-admin-logout>Logout</button>
      </div>
    </div>
  `;
}


function fieldValue(k, field) {
  return esc(k[field] ?? "");
}


function adminEditForm(k) {
  const isNew =
    !k.id;

  const referenceOptions =
    REFERENCE_PDFS
      .map((pdf) =>
        `<option value="${esc(pdf.url)}">${esc(pdf.label)}</option>`
      )
      .join("");

  return `
    <form class="kirtan-admin-edit" data-admin-edit-form ${isNew ? "" : "hidden"}>
      <div class="kirtan-admin-workspace">
        <aside class="kirtan-admin-reference">
          <div class="kirtan-admin-reference__bar">
            <label>
              Reference
              <select data-admin-reference-select>
                ${referenceOptions}
              </select>
            </label>
            <a class="admin-button" data-admin-reference-open href="${esc(REFERENCE_PDFS[0].url)}" target="_blank" rel="noopener noreferrer">Open PDF</a>
          </div>
          <div class="kirtan-admin-reference__search">
            <label>
              Search PDF Text
              <input data-admin-reference-search type="search" placeholder="Search words in selected PDF">
            </label>
            <label class="kirtan-admin-reference__page">
              Page
              <input data-admin-reference-page type="number" min="1" inputmode="numeric" placeholder="Page">
            </label>
            <button type="button" class="admin-button" data-admin-reference-search-button>Find</button>
          </div>
          <iframe
            class="kirtan-admin-reference__frame"
            data-admin-reference-frame
            src="${esc(REFERENCE_PDFS[0].url)}"
            title="Kirtan Sangrah reference PDF"
          ></iframe>
        </aside>

        <div class="kirtan-admin-edit__panel">
          <div class="kirtan-admin-edit__grid">
            <label>
              Title
              <input name="title" value="${fieldValue(k, "title")}">
            </label>
            <label>
              Raag
              <input name="raag" value="${fieldValue(k, "raag")}">
            </label>
            <label>
              Occasion / Type
              <input name="type" value="${fieldValue(k, "type")}">
            </label>
            <label>
              Image Path
              <input name="image" value="${fieldValue(k, "image")}">
            </label>
          </div>

          <label class="kirtan-admin-edit__check">
            <input name="verified" type="checkbox" ${k.verified ? "checked" : ""}>
            <span>
              Verified
              <small>When verified, this kirtan becomes visible to public users.</small>
            </span>
          </label>

          <label>
            Original Text
            <textarea name="original_text" rows="10">${fieldValue(k, "original_text")}</textarea>
          </label>
          <label>
            Meaning / Translation
            <textarea name="translate_text" rows="14">${fieldValue(k, "translate_text")}</textarea>
          </label>
          <label>
            Transliteration
            <textarea name="transliterate_text" rows="10">${fieldValue(k, "transliterate_text")}</textarea>
          </label>

          <div class="kirtan-admin-edit__actions">
            <button type="submit" class="admin-button admin-button--primary">${isNew ? "Create Kirtan" : "Save Changes"}</button>
            ${isNew
              ? `<a class="admin-button" href="/admin">Cancel</a>`
              : `<button type="button" class="admin-button" data-admin-cancel>Cancel</button>
                 <button type="button" class="admin-button admin-button--danger" data-admin-delete>Delete Kirtan</button>`
            }
            <span class="kirtan-admin-edit__status" data-admin-save-status></span>
          </div>
        </div>
      </div>
    </form>
  `;
}


function adminHistoryPanel() {
  return `
    <section class="kirtan-admin-history" data-admin-history-panel hidden>
      <div class="kirtan-admin-history__header">
        <h2>Revision History</h2>
        <button type="button" class="admin-button" data-admin-history-close>Close</button>
      </div>
      <div data-admin-history-list class="kirtan-admin-history__list"></div>
      <div data-admin-revision-detail class="kirtan-admin-history__detail"></div>
    </section>
  `;
}

function contributorToolbar(k) {
  return `
    <div class="kirtan-admin-toolbar">
      <div class="kirtan-admin-toolbar__left">
        <strong>Contributor Mode</strong>
        ${adminStatus(k)}
        ${k.contribution ? '<span class="admin-status admin-status--pending">Pending review</span>' : ""}
      </div>
      <div class="kirtan-admin-toolbar__actions">
        <a class="admin-button" href="/cont">Contributor Home</a>
        <button type="button" class="admin-button admin-button--primary" data-contributor-edit>Edit Text</button>
        <button type="button" class="admin-button" data-contributor-logout>Logout</button>
      </div>
    </div>
  `;
}

function contributorEditForm(k) {
  const proposed =
    k.contribution?.proposed || {};

  const referenceOptions =
    REFERENCE_PDFS
      .map((pdf) =>
        `<option value="${esc(pdf.url)}">${esc(pdf.label)}</option>`
      )
      .join("");

  return `
    <form class="kirtan-admin-edit" data-contributor-edit-form hidden>
      <div class="kirtan-admin-workspace">
        <aside class="kirtan-admin-reference">
          <div class="kirtan-admin-reference__bar">
            <label>
              Reference
              <select data-admin-reference-select>
                ${referenceOptions}
              </select>
            </label>
            <a class="admin-button" data-admin-reference-open href="${esc(REFERENCE_PDFS[0].url)}" target="_blank" rel="noopener noreferrer">Open PDF</a>
          </div>
          <div class="kirtan-admin-reference__search">
            <label>
              Search PDF Text
              <input data-admin-reference-search type="search" placeholder="Search words in selected PDF">
            </label>
            <label class="kirtan-admin-reference__page">
              Page
              <input data-admin-reference-page type="number" min="1" inputmode="numeric" placeholder="Page">
            </label>
            <button type="button" class="admin-button" data-admin-reference-search-button>Find</button>
          </div>
          <iframe
            class="kirtan-admin-reference__frame"
            data-admin-reference-frame
            src="${esc(REFERENCE_PDFS[0].url)}"
            title="Kirtan Sangrah reference PDF"
          ></iframe>
        </aside>

        <div class="kirtan-admin-edit__panel">
          <div class="kirtan-admin-edit__grid">
            <label>
              Title
              <input name="title" value="${fieldValue(k, "title")}" disabled>
            </label>
            <label>
              Raag
              <input name="raag" value="${fieldValue(k, "raag")}" disabled>
            </label>
            <label>
              Occasion / Type
              <input name="type" value="${fieldValue(k, "type")}" disabled>
            </label>
            <label>
              Image Path
              <input name="image" value="${fieldValue(k, "image")}" disabled>
            </label>
          </div>

          <label class="kirtan-admin-edit__check">
            <input name="verified" type="checkbox" ${k.verified ? "checked" : ""} disabled>
            <span>
              Verified
              <small>Only admins can change verification status.</small>
            </span>
          </label>

          <label>
            Original Text
            <textarea name="original_text" rows="10">${esc(proposed.original_text ?? k.original_text ?? "")}</textarea>
          </label>
          <label>
            Meaning / Translation
            <textarea name="translate_text" rows="14">${esc(proposed.translate_text ?? k.translate_text ?? "")}</textarea>
          </label>
          <label>
            Transliteration
            <textarea name="transliterate_text" rows="10" disabled>${fieldValue(k, "transliterate_text")}</textarea>
          </label>

          <div class="kirtan-admin-edit__actions">
            <button type="submit" class="admin-button admin-button--primary">Submit for Approval</button>
            <button type="button" class="admin-button" data-contributor-cancel>Cancel</button>
            <span class="kirtan-admin-edit__status" data-contributor-save-status></span>
          </div>
        </div>
      </div>
    </form>
  `;
}

function reviewPanelHtml(reviewData) {
  if (!reviewData) return "";

  const contribution =
    reviewData.contribution;

  const base =
    contribution.base || {};

  const proposed =
    contribution.proposed || {};

  return `
    <section class="kirtan-admin-history" data-admin-review-panel>
      <div class="kirtan-admin-history__header">
        <div>
          <h2>Contribution Review</h2>
          <p class="admin-dashboard__count">
            ${esc(contribution.contributor_username)} · ${esc(contribution.updated_at)} · ${esc(contribution.status)}
          </p>
        </div>
        <a class="admin-button" href="/admin">Admin Home</a>
      </div>
      ${diffHtml(base, proposed, ["original_text", "translate_text"], {
        beforeLabel: "Current",
        afterLabel: "Proposed",
        highlightAfter: true,
      })}
      <form class="kirtan-admin-edit" data-admin-review-form>
        <label>
          Original Text
          <textarea name="original_text" rows="12">${esc(proposed.original_text ?? "")}</textarea>
        </label>
        <label>
          Meaning / Translation
          <textarea name="translate_text" rows="14">${esc(proposed.translate_text ?? "")}</textarea>
        </label>
        <label>
          Admin Note
          <input name="admin_note" value="">
        </label>
        <div class="kirtan-admin-edit__actions">
          <button type="submit" class="admin-button admin-button--primary">Approve Changes</button>
          <button type="button" class="admin-button admin-button--danger" data-admin-review-reject>Reject</button>
          <span class="kirtan-admin-edit__status" data-admin-review-status></span>
        </div>
      </form>
    </section>
  `;
}



async function load() {

  const content =
    document.getElementById(
      "content"
    );


  const params =
    new URLSearchParams(
      location.search
    );

  const id =
    kirtanIdFromLocation();

  const isNew =
    params.get("new") === "1";

  const reviewId =
    params.get("review");

  if (
    id &&
    !isNew &&
    !reviewId &&
    !hasPrivateKirtanSessionCookie() &&
    bindServerRenderedPublicKirtan(content, id)
  ) {
    return;
  }

  const session =
    await adminSession();

  const isAdmin =
    Boolean(session.authenticated);

  const contributor =
    isAdmin
      ? { authenticated: false }
      : await contributorSession();

  const isContributor =
    Boolean(contributor.authenticated);

  if (isNew) {
    if (!isAdmin) {
      location.href = "/admin";
      return;
    }

    const k = {
      id: null,
      title: "",
      type: "",
      raag: "",
      original_text: "",
      translate_text: "",
      transliterate_text: "",
      image: "",
      verified: false,
    };

    document.title =
      "New Kirtan - Pushti Kirtan Admin";

    content.innerHTML = `
      <article class="kirtan-detail" data-admin-editing>
        <div class="kirtan-detail__content">
          ${adminToolbar(k)}
          ${adminEditForm(k)}
        </div>
      </article>
    `;

    bindAdminControls(content, k);
    return;
  }

  /*
    No kirtan ID provided
  */
  if (!id) {

    content.innerHTML = `
      <div class="error-state">
        No kirtan selected.
        <a href="/">
          Browse PushtiKirtan
        </a>
      </div>
    `;

    return;
  }



  /*
    Load individual kirtan
  */
  const reviewData =
    isAdmin && reviewId
      ? await fetchAdminContribution(reviewId).catch(() => null)
      : null;

  const res =
    reviewData?.current ||
    (
      isAdmin
        ? await fetchAdminKirtan(id).catch(() => null)
        : isContributor
          ? await fetchContributorKirtan(id).catch(() => null)
          : await KirtanAPI.getKirtan(id).catch(() => null)
    );



  /*
    Kirtan not found
  */
  if (!res) {

    content.innerHTML = `
      <div class="error-state">
        Kirtan not found.
        <a href="/">
          Back to PushtiKirtan
        </a>
      </div>
    `;

    document.title =
      "Not found";

    return;
  }



  const k = res;

  const adjacent =
    await adjacentKirtans(k.id);


  /*
    Main page title
  */
  const pageTitle =
    k.title ||
    `Kirtan #${k.id}`;

  const titleParts =
    splitPipeLabel(pageTitle);

  const titleHindi =
    titleParts.devanagari || pageTitle;

  const titleRoman =
    titleParts.roman;


  document.title =
    pageTitle;

  const shareUrl =
    new URL(
      kirtanPath(k),
      window.location.origin
    ).toString();

  const whatsappTrackedUrl =
    new URL(
      kirtanPath(k),
      window.location.origin
    );

  whatsappTrackedUrl.searchParams.set(
    "utm_source",
    "whatsapp"
  );

  whatsappTrackedUrl.searchParams.set(
    "utm_medium",
    "share"
  );

  whatsappTrackedUrl.searchParams.set(
    "utm_campaign",
    "kirtan_share"
  );

  const shareTitle =
    pageTitle;

  const facebookShareUrl =
    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;

  const whatsappShareUrl =
    `https://wa.me/?text=${encodeURIComponent(`${shareTitle} - ${whatsappTrackedUrl.toString()}`)}`;

  const twitterShareUrl =
    `https://twitter.com/intent/tweet?${new URLSearchParams({
      text: shareTitle,
      url: shareUrl
    }).toString()}`;



  /*
    Kirtan image
  */
  const imgSrc =
    rootRelativeAsset(k.image) ||
    PLACEHOLDER;



  /*
    Remove duplicate title from the beginning
    of the translation text.
  */
  const translationText =
    removeEndingMarker(
      removeRaagLines(
        removeRepeatedTitle(
          k.translate_text,
          pageTitle
        )
      )
    );

  const raagDisplay =
    formatRaag(k.raag);

  const typeDisplay =
    formatType(k.type);

  const typeHref =
    k.type
      ? collectionPath("occasion", k.type)
      : "";

  const raagHref =
    k.raag
      ? collectionPath("raag", k.raag)
      : "";

  const hasTransliteration =
    Boolean(
      String(k.transliterate_text ?? "").trim()
    );

  const metaHtml = `
    ${
      typeDisplay
        ? `<div class="kirtan-detail__type">
            <span class="kirtan-detail__meta-label">OCCASION:</span>
            <a class="kirtan-detail__type-link" href="${esc(typeHref)}">
              ${esc(typeDisplay)}
            </a>
          </div>`
        : ""
    }
    ${
      raagDisplay
        ? `<div class="kirtan-detail__raag">
            <span class="kirtan-detail__meta-label">RAAG:</span>
            <a class="kirtan-detail__type-link" href="${esc(raagHref)}">
              ${esc(raagDisplay)}
            </a>
          </div>`
        : ""
    }
  `;

  const shareHtml = `
    <div class="kirtan-share" aria-label="Share this kirtan">
      <a
        class="kirtan-share__button"
        href="${facebookShareUrl}"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share ${esc(pageTitle)} on Facebook"
      >
        <span class="kirtan-share__icon" aria-hidden="true">f</span>
        <span>Facebook</span>
      </a>
      <a
        class="kirtan-share__button"
        href="${whatsappShareUrl}"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share ${esc(pageTitle)} on WhatsApp"
      >
        <span class="kirtan-share__icon" aria-hidden="true">W</span>
        <span>WhatsApp</span>
      </a>
      <a
        class="kirtan-share__button"
        href="${twitterShareUrl}"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Share ${esc(pageTitle)} on X"
      >
        <span class="kirtan-share__icon" aria-hidden="true">X</span>
        <span>X</span>
      </a>
    </div>
  `;

  const audioSearch =
    audioSearchHtml(k);

  const stickySummaryHtml = `
    <div class="kirtan-detail__sticky-summary" aria-label="Current kirtan">
      <div class="kirtan-detail__sticky-title">
        <span class="kirtan-detail__sticky-title-main">${esc(titleHindi)}</span>
        ${
          titleRoman
            ? `<span class="kirtan-detail__sticky-title-sub">${esc(titleRoman)}</span>`
            : ""
        }
      </div>
      ${metaHtml}
      ${shareHtml}
      ${audioSearch}
    </div>
  `;

  if (
    !isAdmin &&
    !isContributor &&
    !reviewData &&
    enhanceServerRenderedKirtan({
      content,
      k,
      shareHtml,
      audioSearch,
      stickySummaryHtml,
      adjacent,
    })
  ) {
    return;
  }



  /*
    Render the page
  */
  content.innerHTML = `

    <article class="kirtan-detail">

      <div class="kirtan-detail__layout">


        <!-- IMAGE -->

        <aside
          class="kirtan-detail__visual"
          aria-hidden="true"
        >

          <div class="kirtan-detail__image-frame">

            <img
              src="${esc(imgSrc)}"
              alt=""
              onerror="this.src='${PLACEHOLDER}'"
            >

          </div>

          ${stickySummaryHtml}

        </aside>



        <!-- KIRTAN CONTENT -->

        <div class="kirtan-detail__content">

          ${isAdmin ? adminToolbar(k) : ""}
          ${isAdmin ? adminEditForm(k) : ""}
          ${isAdmin ? adminHistoryPanel() : ""}
          ${isAdmin ? reviewPanelHtml(reviewData) : ""}
          ${isContributor ? contributorToolbar(k) : ""}
          ${isContributor ? contributorEditForm(k) : ""}


          <!-- OPENING IMAGE -->

          <div
            class="kirtan-detail__hero-visual"
            aria-label="Kirtan illustration"
          >

            <div class="kirtan-detail__image-frame">

              <img
                src="${esc(imgSrc)}"
                alt=""
                onerror="this.src='${PLACEHOLDER}'"
              >

            </div>

          </div>


          <!-- TITLE -->

          <header class="kirtan-detail__header">

            <h1 class="kirtan-detail__title">
              <span class="kirtan-detail__title-main">${esc(titleHindi)}</span>
              ${
                titleRoman
                  ? `<span class="kirtan-detail__title-sub">${esc(titleRoman)}</span>`
                  : ""
              }
            </h1>


            <!-- RAAG + OCCASION -->

            ${metaHtml}
            ${shareHtml}
            ${audioSearch}

          </header>



          <!-- TEXT -->

          <div class="reading-shell">

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

            <div class="kirtan-detail__text">


            <!-- TRANSLATION -->

            ${block(
              translationText,
              "translation",
              "MEANING"
            )}


            <!-- ORIGINAL HINDI / BRAJ -->

            ${block(
              k.original_text,
              "original",
              "ORIGINAL"
            )}


            <!-- TRANSLITERATION -->

            ${block(
              k.transliterate_text,
              "transliteration",
              "TRANSLITERATION"
            )}


            </div>

          </div>

          ${adjacentKirtansHtml(adjacent)}

        </div>

      </div>

    </article>
  `;

  bindReadingToolbar(
    content.querySelector(".reading-shell")
  );

  if (isAdmin) {
    bindAdminControls(content, k);
    if (reviewData) {
      bindAdminReviewControls(content, k, reviewData);
    }
  }

  if (isContributor) {
    bindContributorControls(content, k);
  }

  bindKirtanImageTransition(
    content.querySelector(".kirtan-detail")
  );
}



load();


function bindReadingToolbar(shell) {
  if (!shell) return;

  let copyStatusTimer = null;

  const state = {
    original: true,
    meaning: true,
    transliteration: true,
    scale: 1
  };

  const setCopyStatus = (message) => {
    const status =
      shell.querySelector("[data-copy-status]");

    if (!status) return;

    status.textContent =
      message;

    if (copyStatusTimer) {
      clearTimeout(copyStatusTimer);
    }

    copyStatusTimer =
      setTimeout(
        () => {
          status.textContent = "";
        },
        1800
      );
  };

  const apply = () => {
    shell.style.setProperty(
      "--reading-scale",
      state.scale.toFixed(2)
    );

    shell.toggleAttribute(
      "data-hide-original",
      !state.original
    );

    shell.toggleAttribute(
      "data-hide-meaning",
      !state.meaning
    );

    shell.toggleAttribute(
      "data-hide-transliteration",
      !state.transliteration
    );

    shell
      .querySelectorAll("[data-toggle-section]")
      .forEach((button) => {
        const key =
          button.dataset.toggleSection;

        button.classList.toggle(
          "is-active",
          state[key]
        );

        button.setAttribute(
          "aria-pressed",
          String(state[key])
        );
      });
  };

  shell.addEventListener(
    "click",
    (event) => {
      const button =
        event.target instanceof Element
          ? event.target.closest("button")
          : null;

      if (!button) return;

      const section =
        button.dataset.toggleSection;

      if (section) {
        state[section] =
          !state[section];

        apply();
        return;
      }

      if (button.hasAttribute("data-copy-visible")) {
        const sections =
          [
            ["meaning", "translation"],
            ["original", "original"],
            ["transliteration", "transliteration"]
          ];

        const text =
          sections
            .filter(([stateKey]) => state[stateKey])
            .map(([, className]) =>
              textFromSection(
                shell.querySelector(
                  `.text-section--${className}`
                )
              )
            )
            .filter(Boolean)
            .join("\n\n");

        copyToClipboard(text)
          .then((copied) => {
            setCopyStatus(
              copied
                ? "Copied"
                : "Copy failed"
            );
          })
          .catch(() => {
            setCopyStatus("Copy failed");
          });

        return;
      }

      const fontStep =
        Number(button.dataset.fontStep);

      if (fontStep) {
        state.scale =
          Math.min(
            1.25,
            Math.max(
              0.9,
              state.scale + fontStep * 0.05
            )
          );

        apply();
      }
    }
  );

  apply();
}


function bindKirtanImageTransition(page) {
  if (!page) return;

  const heroImage =
    page.querySelector(".kirtan-detail__hero-visual");

  if (!heroImage) return;

  if (!("IntersectionObserver" in window)) {
    page.classList.add("is-sticky-visual-ready");
    return;
  }

  const observer =
    new IntersectionObserver(
      ([entry]) => {
        page.classList.toggle(
          "is-sticky-visual-ready",
          !entry.isIntersecting
        );
      },
      {
        rootMargin: "0px 0px -68% 0px",
        threshold: 0
      }
    );

  observer.observe(heroImage);
}


function valuesFromForm(form) {
  const data = new FormData(form);

  return {
    title: data.get("title"),
    type: data.get("type"),
    raag: data.get("raag"),
    image: data.get("image"),
    original_text: data.get("original_text"),
    translate_text: data.get("translate_text"),
    transliterate_text: data.get("transliterate_text"),
    verified: data.get("verified") === "on",
  };
}


function diffParts(value) {
  return String(value ?? "")
    .match(/\s+|[^\s]+/g) || [];
}

function isSpaceToken(value) {
  return /^\s+$/.test(value);
}

function wordEntries(parts) {
  return parts
    .map((value, index) => ({
      value,
      index,
    }))
    .filter((part) => !isSpaceToken(part.value));
}

function hasWords(value) {
  return diffParts(value).some((part) => !isSpaceToken(part));
}

function renderMarkedText(value, type) {
  return diffParts(value)
    .map((part) => {
      if (isSpaceToken(part)) {
        return esc(part);
      }

      return `<mark class="revision-diff__mark revision-diff__mark--${type}">${esc(part)}</mark>`;
    })
    .join("");
}

function renderDiffChange(beforeValue, afterValue) {
  const beforeHasWords =
    hasWords(beforeValue);

  const afterHasWords =
    hasWords(afterValue);

  if (beforeHasWords && afterHasWords) {
    return {
      before: renderMarkedText(beforeValue, "update"),
      after: renderMarkedText(afterValue, "update"),
    };
  }

  if (beforeHasWords) {
    return {
      before: renderMarkedText(beforeValue, "delete"),
      after: esc(afterValue),
    };
  }

  if (afterHasWords) {
    return {
      before: esc(beforeValue),
      after: renderMarkedText(afterValue, "insert"),
    };
  }

  return {
    before: esc(beforeValue),
    after: esc(afterValue),
  };
}

function diffValuePairHtml(before, after) {
  const left =
    diffParts(before);

  const right =
    diffParts(after);

  const leftWords =
    wordEntries(left);

  const rightWords =
    wordEntries(right);

  const table =
    Array.from(
      { length: leftWords.length + 1 },
      () => Array(rightWords.length + 1).fill(0)
    );

  for (let i = leftWords.length - 1; i >= 0; i -= 1) {
    for (let j = rightWords.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        leftWords[i].value === rightWords[j].value
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const result = {
    before: "",
    after: "",
  };

  let leftPartIndex = 0;
  let rightPartIndex = 0;
  let leftWordIndex = 0;
  let rightWordIndex = 0;

  const appendChange = (leftEnd, rightEnd) => {
    const beforeValue =
      left.slice(leftPartIndex, leftEnd).join("");

    const afterValue =
      right.slice(rightPartIndex, rightEnd).join("");

    const rendered =
      renderDiffChange(beforeValue, afterValue);

    result.before += rendered.before;
    result.after += rendered.after;
    leftPartIndex = leftEnd;
    rightPartIndex = rightEnd;
  };

  while (leftWordIndex < leftWords.length && rightWordIndex < rightWords.length) {
    if (leftWords[leftWordIndex].value === rightWords[rightWordIndex].value) {
      const leftMatchIndex =
        leftWords[leftWordIndex].index;

      const rightMatchIndex =
        rightWords[rightWordIndex].index;

      appendChange(leftMatchIndex, rightMatchIndex);
      result.before += esc(left[leftMatchIndex]);
      result.after += esc(right[rightMatchIndex]);
      leftPartIndex = leftMatchIndex + 1;
      rightPartIndex = rightMatchIndex + 1;
      leftWordIndex += 1;
      rightWordIndex += 1;
      continue;
    }

    if (
      rightWordIndex >= rightWords.length ||
      table[leftWordIndex + 1][rightWordIndex] >= table[leftWordIndex][rightWordIndex + 1]
    ) {
      leftWordIndex += 1;
    } else {
      rightWordIndex += 1;
    }
  }

  appendChange(left.length, right.length);
  return result;
}

function diffValueHtml(snapshot, current, key, side, highlighted) {
  const source =
    side === "before"
      ? snapshot
      : current;

  const value =
    key === "verified"
      ? String(Boolean(source?.[key]))
      : source?.[key] ?? "";

  if (!highlighted || key === "verified") {
    return esc(value);
  }

  return diffValuePairHtml(snapshot?.[key] ?? "", current?.[key] ?? "")[side];
}

function diffHtml(snapshot, current, fields, options = {}) {
  const keys =
    fields.length
      ? fields
      : [
          "title",
          "type",
          "raag",
          "original_text",
          "translate_text",
          "transliterate_text",
          "image",
          "verified",
        ];

  return keys.map((key) => `
    <div class="revision-diff">
      <h3>${esc(key)}</h3>
      <div class="revision-diff__cols">
        <div>
          <strong>${esc(options.beforeLabel || "Historical")}</strong>
          <pre>${diffValueHtml(snapshot, current, key, "before", Boolean(options.highlightAfter))}</pre>
        </div>
        <div>
          <strong>${esc(options.afterLabel || "Current")}</strong>
          <pre>${diffValueHtml(snapshot, current, key, "after", Boolean(options.highlightAfter))}</pre>
        </div>
      </div>
    </div>
  `).join("");
}

function bindReferenceControls(root) {
  const referenceSelect =
    root.querySelector("[data-admin-reference-select]");

  const referenceFrame =
    root.querySelector("[data-admin-reference-frame]");

  const referenceOpen =
    root.querySelector("[data-admin-reference-open]");

  const referenceSearch =
    root.querySelector("[data-admin-reference-search]");

  const referencePage =
    root.querySelector("[data-admin-reference-page]");

  const referenceSearchButton =
    root.querySelector("[data-admin-reference-search-button]");

  const referenceUrl = () => {
    const url =
      referenceSelect?.value ||
      REFERENCE_PDFS[0].url;

    const query =
      referenceSearch?.value.trim();

    const page =
      Number(referencePage?.value || 0);

    const params = [];
    if (Number.isInteger(page) && page > 0) {
      params.push(`page=${page}`);
    }

    if (query) {
      params.push(`search=${encodeURIComponent(query)}`);
    }

    return params.length
      ? `${url}#${params.join("&")}`
      : url;
  };

  const updateReferenceViewer = () => {
    const nextUrl =
      referenceUrl();

    if (referenceFrame) {
      referenceFrame.src = "about:blank";
      window.setTimeout(() => {
        referenceFrame.src = nextUrl;
      }, 40);
    }

    if (referenceOpen) {
      referenceOpen.href = nextUrl;
    }
  };

  referenceSelect
    ?.addEventListener("change", () => {
      updateReferenceViewer();
    });

  referenceSearch
    ?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        updateReferenceViewer();
      }
    });

  referenceSearchButton
    ?.addEventListener("click", () => {
      updateReferenceViewer();
    });
}


function bindAdminControls(root, k) {
  const isNew =
    !k.id;

  const form =
    root.querySelector("[data-admin-edit-form]");

  const article =
    root.querySelector(".kirtan-detail");

  const setEditingMode = () => {
    if (!article || !form) return;

    article.toggleAttribute(
      "data-admin-editing",
      !form.hidden
    );
  };

  const historyPanel =
    root.querySelector("[data-admin-history-panel]");

  const historyList =
    root.querySelector("[data-admin-history-list]");

  const revisionDetail =
    root.querySelector("[data-admin-revision-detail]");

  root
    .querySelector("[data-admin-edit]")
    ?.addEventListener("click", () => {
      form.hidden = !form.hidden;
      setEditingMode();
      if (!form.hidden) {
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

  root
    .querySelector("[data-admin-cancel]")
    ?.addEventListener("click", () => {
      form.hidden = true;
      setEditingMode();
    });

  bindReferenceControls(root);

  root
    .querySelector("[data-admin-logout]")
    ?.addEventListener("click", async () => {
      await fetch("/api/admin/logout", { method: "POST" });
      location.href = "/";
    });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const next =
      valuesFromForm(form);

    if (
      (isNew || !k.verified) &&
      next.verified &&
      !confirm(`${isNew ? "Create" : "Save changes to"} and publish this kirtan?\n\nThis kirtan will become visible to public users.`)
    ) {
      return;
    }

    const status =
      form.querySelector("[data-admin-save-status]");

    status.textContent = "Saving…";

    const res =
      await fetch(isNew ? "/api/admin/kirtans" : `/api/admin/kirtans/${k.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(next),
      });

    if (!res.ok) {
      status.textContent = "Save failed.";
      return;
    }

    const data =
      await res.json().catch(() => ({}));

    status.textContent = isNew ? "Created." : "Saved.";
    location.href = kirtanPath(data.row || { ...k, ...next, id: data.row?.id || k.id });
  });

  root
    .querySelector("[data-admin-delete]")
    ?.addEventListener("click", async () => {
      if (
        !confirm(`Delete Kirtan #${k.id}?\n\nThis removes the row from the table. The current row will be saved in revision history before deletion.`)
      ) {
        return;
      }

      const typed =
        prompt(`This permanently deletes Kirtan #${k.id} from the main table.\n\nType DELETE to confirm.`);

      if (typed !== "DELETE") {
        return;
      }

      const status =
        form.querySelector("[data-admin-save-status]");

      status.textContent = "Deleting...";

      const res =
        await fetch(`/api/admin/kirtans/${k.id}`, {
          method: "DELETE",
        });

      if (!res.ok) {
        status.textContent = "Delete failed.";
        return;
      }

      location.href = "/admin";
    });

  async function loadHistory() {
    if (!historyPanel || !historyList || !revisionDetail) return;

    historyPanel.hidden = false;
    revisionDetail.innerHTML = "";
    historyList.innerHTML = '<div class="loading">Loading revisions</div>';

    const data =
      await fetch(`/api/admin/kirtans/${k.id}/revisions`)
        .then((res) => res.ok ? res.json() : Promise.reject());

    if (!data.rows.length) {
      historyList.innerHTML =
        '<div class="empty-state">No revisions yet.</div>';
      return;
    }

    historyList.innerHTML =
      data.rows.map((row) => `
        <button type="button" class="revision-row" data-revision-id="${row.id}">
          <span>Revision #${row.id}</span>
          <small>${esc(row.created_at)} · ${esc(row.action)} · ${esc(row.changed_fields.join(", ") || "snapshot")}</small>
        </button>
      `).join("");
  }

  root
    .querySelector("[data-admin-history]")
    ?.addEventListener("click", loadHistory);

  root
    .querySelector("[data-admin-history-close]")
    ?.addEventListener("click", () => {
      historyPanel.hidden = true;
    });

  historyList?.addEventListener("click", async (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest("[data-revision-id]")
        : null;

    if (!button) return;

    const revisionId =
      button.dataset.revisionId;

    revisionDetail.innerHTML = '<div class="loading">Loading revision</div>';

    const data =
      await fetch(`/api/admin/revisions/${revisionId}`)
        .then((res) => res.ok ? res.json() : Promise.reject());

    revisionDetail.innerHTML = `
      <div class="revision-detail__header">
        <div>
          <h3>Revision #${esc(data.revision.id)}</h3>
          <p>${esc(data.revision.created_at)} · ${esc(data.revision.action)}</p>
        </div>
        <button type="button" class="admin-button admin-button--primary" data-restore-revision="${esc(data.revision.id)}">
          Restore This Revision
        </button>
      </div>
      ${diffHtml(
        data.revision.snapshot,
        data.current,
        data.revision.changed_fields
      )}
    `;
  });

  revisionDetail?.addEventListener("click", async (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest("[data-restore-revision]")
        : null;

    if (!button) return;

    if (
      !confirm("Restore this historical revision?\n\nA new revision will be created before restoring.")
    ) {
      return;
    }

    const res =
      await fetch(`/api/admin/revisions/${button.dataset.restoreRevision}/restore`, {
        method: "POST",
      });

    if (res.ok) {
      location.href = kirtanPath(k);
    }
  });
}

function bindContributorControls(root, k) {
  const form =
    root.querySelector("[data-contributor-edit-form]");

  const article =
    root.querySelector(".kirtan-detail");

  const setEditingMode = () => {
    if (!article || !form) return;

    article.toggleAttribute(
      "data-admin-editing",
      !form.hidden
    );
  };

  bindReferenceControls(root);

  root
    .querySelector("[data-contributor-edit]")
    ?.addEventListener("click", () => {
      form.hidden = !form.hidden;
      setEditingMode();
      if (!form.hidden) {
        form.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

  root
    .querySelector("[data-contributor-cancel]")
    ?.addEventListener("click", () => {
      form.hidden = true;
      setEditingMode();
    });

  root
    .querySelector("[data-contributor-logout]")
    ?.addEventListener("click", async () => {
      await fetch("/api/contributor/logout", { method: "POST" });
      location.href = "/";
    });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data =
      new FormData(form);

    const status =
      form.querySelector("[data-contributor-save-status]");

    status.textContent = "Submitting...";

    const res =
      await fetch(`/api/contributor/kirtans/${k.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          original_text: data.get("original_text"),
          translate_text: data.get("translate_text"),
        }),
      });

    if (!res.ok) {
      const body =
        await res.json().catch(() => ({}));

      status.textContent =
        body.error || "Submit failed.";
      return;
    }

    status.textContent =
      "Submitted for admin review.";

    window.setTimeout(
      () => location.reload(),
      700
    );
  });
}

function bindAdminReviewControls(root, k, reviewData) {
  const form =
    root.querySelector("[data-admin-review-form]");

  const status =
    root.querySelector("[data-admin-review-status]");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data =
      new FormData(form);

    status.textContent = "Approving...";

    const res =
      await fetch(`/api/admin/contributions/${reviewData.contribution.id}/approve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          original_text: data.get("original_text"),
          translate_text: data.get("translate_text"),
          admin_note: data.get("admin_note"),
        }),
      });

    if (!res.ok) {
      status.textContent = "Approval failed.";
      return;
    }

    const body =
      await res.json().catch(() => ({}));

    status.textContent = "Approved.";
    window.setTimeout(
      () => location.href = kirtanPath(body.row || k),
      700
    );
  });

  root
    .querySelector("[data-admin-review-reject]")
    ?.addEventListener("click", async () => {
      if (!confirm("Reject this contribution?")) {
        return;
      }

      const data =
        new FormData(form);

      status.textContent = "Rejecting...";

      const res =
        await fetch(`/api/admin/contributions/${reviewData.contribution.id}/reject`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            admin_note: data.get("admin_note"),
          }),
        });

      status.textContent =
        res.ok
          ? "Rejected."
          : "Reject failed.";

      if (res.ok) {
        window.setTimeout(
          () => location.href = "/admin",
          700
        );
      }
    });
}
