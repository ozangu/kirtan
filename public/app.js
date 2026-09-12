const $ = (s) => document.querySelector(s);
const S = $("#search");
const R = $("#raag");
const T = $("#type");
const O = $("#results");
const Z = $("#status");
const PT = $("#pagination-top");
const PB = $("#pagination-bottom");
const LANG = document.querySelectorAll(
  'input[name="filter-language"]'
);

const PLACEHOLDER = "/images/placeholder.png";
const PAGE_SIZE = 20;

let tm;
let currentPage = 1;
let filterLanguage = "english";

const initialParams =
  new URLSearchParams(location.search);

const initialFilters = {
  q: initialParams.get("q") || "",
  raag: initialParams.get("raag") || "",
  type: initialParams.get("type") || ""
};

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

function kirtanSlug(k) {
  const parts =
    String(k?.title || "")
      .split(/[|｜]/)
      .map((part) => part.trim())
      .filter(Boolean);

  const roman =
    parts.find((part) => !hasDevanagariText(part)) ||
    parts[0] ||
    `kirtan-${k.id}`;

  return `${slugify(roman)}-${k.id}`;
}

function kirtanHref(k) {
  return `/kirtan/${kirtanSlug(k)}`;
}

function rootRelativeAsset(path) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith("/")) {
    return value;
  }
  return `/${value.replace(/^\.?\//, "")}`;
}

function selectedFilterLanguage() {
  return (
    document.querySelector(
      'input[name="filter-language"]:checked'
    )?.value || "english"
  );
}

function splitFilterLabel(value) {
  const parts =
    String(value ?? "")
      .split(/[|｜]/)
      .map((part) => part.trim())
      .filter(Boolean);

  const hasDevanagariText = (part) =>
    /[\u0904-\u0939\u0958-\u0961\u0971-\u097F]/.test(part);

  if (parts.length >= 2) {
    const [first, second] = parts;

    /*
      Filter values are stored as English | Hindi.
      Some English labels include Devanagari numerals,
      so do not classify them as Hindi just because
      they contain a Devanagari digit.
    */
    if (
      hasDevanagariText(first) &&
      !hasDevanagariText(second)
    ) {
      return {
        english: second,
        hindi: first
      };
    }

    return {
      english: first,
      hindi: second
    };
  }

  const hindi =
    parts.find(hasDevanagariText);

  const english =
    parts.find((part) => !hasDevanagariText(part));

  return {
    english: english || parts[0] || "",
    hindi: hindi || parts[0] || ""
  };
}

function filterLabel(value) {
  const labels =
    splitFilterLabel(value);

  return labels[filterLanguage] || value;
}

function allFilterLabel(kind) {
  if (filterLanguage === "hindi") {
    return kind === "raag"
      ? "सभी राग"
      : "सभी अवसर";
  }

  return kind === "raag"
    ? "All Raags"
    : "All Occasions";
}

function imgSrc(k) {
  return esc(rootRelativeAsset(k.image) || PLACEHOLDER);
}

function card(k) {
  const title = k.title || k.preview || k.original_text || "";
  const short = title.replace(/\s+/g, " ").trim();
  const display = short.length > 70 ? short.slice(0, 70) + "…" : short;

  return `
    <a
      class="kirtan-card"
      href="${esc(kirtanHref(k))}"
      target="_blank"
      rel="noopener"
    >
      <div class="kirtan-card__image">
        <img
          src="${imgSrc(k)}"
          alt=""
          loading="lazy"
          onerror="this.src='${PLACEHOLDER}'"
        >
      </div>

      <div class="kirtan-card__body">

        ${display
          ? `<div class="kirtan-card__title">${esc(display)}</div>`
          : ""
        }

        <div class="kirtan-card__tags">

          ${k.raag
            ? `<span class="tag">${esc(k.raag)}</span>`
            : ""
          }

          ${k.type
            ? `<span class="tag">${esc(k.type)}</span>`
            : ""
          }

        </div>

      </div>
    </a>
  `;
}


/* --------------------------------------------------
   DEPENDENT RAAG / OCCASION DROPDOWNS
-------------------------------------------------- */

function populateSelect(
  select,
  values,
  allLabel,
  current
) {

  select.innerHTML =
    `<option value="">${allLabel}</option>`;

  values.forEach((x) => {

    const selected =
      x === current ? " selected" : "";

    select.insertAdjacentHTML(
      "beforeend",
      `<option value="${esc(x)}"${selected}>
        ${esc(filterLabel(x))}
      </option>`
    );

  });

  if (
    current &&
    !values.includes(current)
  ) {
    select.value = "";
  }
}


async function refreshFilters(
  current = {}
) {

  const prevRaag =
    current.raag ?? R.value;

  const prevType =
    current.type ?? T.value;

  const f = await KirtanAPI.getFilters();

  populateSelect(
    R,
    f.raags,
    allFilterLabel("raag"),
    prevRaag
  );

  populateSelect(
    T,
    f.types,
    allFilterLabel("type"),
    prevType
  );

}


/* --------------------------------------------------
   PAGINATION
-------------------------------------------------- */

function pageNumbers(
  current,
  total
) {

  if (total <= 7) {

    return Array.from(
      { length: total },
      (_, i) => i + 1
    );

  }

  const pages = [1];

  const start =
    Math.max(
      2,
      current - 1
    );

  const end =
    Math.min(
      total - 1,
      current + 1
    );

  if (start > 2) {
    pages.push("…");
  }

  for (
    let p = start;
    p <= end;
    p++
  ) {
    pages.push(p);
  }

  if (end < total - 1) {
    pages.push("…");
  }

  pages.push(total);

  return pages;
}


function paginationMarkup(
  totalPages
) {

  if (totalPages <= 1) {
    return "";
  }

  const pageButtons =
    pageNumbers(
      currentPage,
      totalPages
    )
      .map((p) => {

        if (p === "…") {

          return `
            <span
              class="pagination__ellipsis"
              aria-hidden="true"
            >
              …
            </span>
          `;

        }

        const active =
          p === currentPage;

        return `
          <button
            type="button"
            class="
              pagination__btn
              pagination__page
              ${active ? "is-active" : ""}
            "
            data-page="${p}"
            ${active
              ? 'aria-current="page"'
              : ""
            }
            aria-label="Go to page ${p}"
          >
            ${p}
          </button>
        `;

      })
      .join("");


  return `

    <button
      type="button"
      class="
        pagination__btn
        pagination__nav
      "
      data-page="${currentPage - 1}"
      ${currentPage === 1
        ? "disabled"
        : ""
      }
      aria-label="Previous page"
    >
      ← Previous
    </button>


    <div class="pagination__pages">

      ${pageButtons}

    </div>


    <button
      type="button"
      class="
        pagination__btn
        pagination__nav
      "
      data-page="${currentPage + 1}"
      ${currentPage === totalPages
        ? "disabled"
        : ""
      }
      aria-label="Next page"
    >
      Next →
    </button>

  `;
}


function renderPagination(
  totalPages
) {

  const html =
    paginationMarkup(totalPages);

  PT.innerHTML = html;
  PB.innerHTML = html;

}


function bindPagination(
  container
) {

  container.addEventListener(
    "click",
    (event) => {

      const button =
        event.target.closest(
          "[data-page]"
        );

      if (
        !button ||
        button.disabled
      ) {
        return;
      }

      currentPage =
        Number(
          button.dataset.page
        );

      load();

    }
  );

}


/* --------------------------------------------------
   LOAD KIRTANS
-------------------------------------------------- */

async function load() {

  Z.textContent =
    "Loading…";

  const list =
    await KirtanAPI.getKirtans({

      q: S.value,

      raag: R.value,

      type: T.value

    });


  if (!list.length) {

    Z.textContent =
      "No kirtans found";

    PT.innerHTML = "";
    PB.innerHTML = "";

    O.innerHTML = `
      <div class="empty-state">
        Try adjusting your search or filters.
      </div>
    `;

    return;

  }


  const totalPages =
    Math.ceil(
      list.length /
      PAGE_SIZE
    );


  if (
    currentPage >
    totalPages
  ) {

    currentPage =
      totalPages;

  }


  if (
    currentPage < 1
  ) {

    currentPage = 1;

  }


  const start =
    (
      currentPage - 1
    ) *
    PAGE_SIZE;


  const end =
    start +
    PAGE_SIZE;


  const pageItems =
    list.slice(
      start,
      end
    );


  const firstShown =
    start + 1;


  const lastShown =
    Math.min(
      end,
      list.length
    );


  Z.textContent =
    `Showing ${firstShown}–${lastShown} of ${list.length} kirtan` +
    `${list.length === 1 ? "" : "s"}`;


  O.innerHTML =
    pageItems
      .map(card)
      .join("");


  renderPagination(
    totalPages
  );

}


/* --------------------------------------------------
   SEARCH
-------------------------------------------------- */

S.addEventListener(
  "input",
  () => {

    clearTimeout(tm);

    currentPage = 1;

    tm =
      setTimeout(
        () => load(),
        250
      );

  }
);


/* --------------------------------------------------
   RAAG FILTER
-------------------------------------------------- */

R.addEventListener(
  "change",
  async () => {

    currentPage = 1;

    await refreshFilters();

    await load();

  }
);


/* --------------------------------------------------
   OCCASION FILTER
-------------------------------------------------- */

T.addEventListener(
  "change",
  async () => {

    currentPage = 1;

    await refreshFilters();

    await load();

  }
);


/* --------------------------------------------------
   FILTER LABEL LANGUAGE
-------------------------------------------------- */

LANG.forEach((input) => {
  input.addEventListener(
    "change",
    async () => {
      filterLanguage =
        selectedFilterLanguage();

      await refreshFilters();
    }
  );
});


/* --------------------------------------------------
   PAGINATION EVENT HANDLERS
-------------------------------------------------- */

bindPagination(PT);

bindPagination(PB);


/* --------------------------------------------------
   INITIAL LOAD
-------------------------------------------------- */

(async () => {

  filterLanguage =
    selectedFilterLanguage();

  try {
    S.value =
      initialFilters.q;

    await refreshFilters(initialFilters);

    await load();
  } catch {
    Z.textContent =
      "Unable to load kirtans.";

    O.innerHTML = `
      <div class="empty-state">
        Please refresh the page.
      </div>
    `;
  }

})();
