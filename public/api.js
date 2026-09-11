const KirtanAPI = (() => {
  const DB_NAME = "pushti-kirtan-cache";
  const DB_VERSION = 6;

  const TTL = {
    list: 5 * 60 * 1000,
    detail: 7 * 24 * 60 * 60 * 1000,
  };

  const KEYS = {
    detail: (id) => `kirtan:v6:${id}`,
  };

  const mem = new Map();
  let dbPromise;


  /* --------------------------------------------------
     INDEXEDDB CACHE
  -------------------------------------------------- */

  function openDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!("indexedDB" in globalThis)) {
          resolve(null);
          return;
        }

        const req =
          indexedDB.open(
            DB_NAME,
            DB_VERSION
          );

        req.onerror = () =>
          reject(req.error);

        req.onsuccess = () =>
          resolve(req.result);

        req.onupgradeneeded = (e) => {
          const db =
            e.target.result;

          if (!db.objectStoreNames.contains("cache")) {
            db.createObjectStore(
              "cache",
              {
                keyPath: "key"
              }
            );
          }
        };
      });
    }

    return dbPromise;
  }


  function readMem(key) {
    const row =
      mem.get(key);

    if (!row) {
      return null;
    }

    if (
      Date.now() - row.at >
      row.ttl
    ) {
      mem.delete(key);
      return null;
    }

    return row.data;
  }


  async function read(key) {
    const hot =
      readMem(key);

    if (hot) {
      return hot;
    }

    const db =
      await openDB().catch(() => null);

    if (!db) {
      return null;
    }

    return new Promise(
      (resolve) => {

        const tx =
          db.transaction(
            "cache",
            "readonly"
          );

        const req =
          tx
            .objectStore("cache")
            .get(key);

        req.onsuccess = () => {

          const row =
            req.result;

          if (
            !row ||
            Date.now() - row.at >
              row.ttl
          ) {
            resolve(null);
            return;
          }

          mem.set(
            key,
            row
          );

          resolve(
            row.data
          );
        };

        req.onerror = () =>
          resolve(null);
      }
    );
  }


  async function write(
    key,
    data,
    ttl
  ) {
    const row = {
      key,
      data,
      at: Date.now(),
      ttl
    };

    mem.set(
      key,
      row
    );

    const db =
      await openDB().catch(() => null);

    if (!db) {
      return;
    }

    return new Promise(
      (resolve) => {

        const tx =
          db.transaction(
            "cache",
            "readwrite"
          );

        tx
          .objectStore("cache")
          .put(row);

        tx.oncomplete = () =>
          resolve();

        tx.onerror = () =>
          resolve();
      }
    );
  }


  /* --------------------------------------------------
     NETWORK
  -------------------------------------------------- */

  async function fetchJSON(url) {
    const res =
      await fetch(url);

    if (!res.ok) {
      throw new Error(
        String(res.status)
      );
    }

    return res.json();
  }


  async function cached(
    key,
    url,
    ttl,
    {
      revalidate = false
    } = {}
  ) {

    const stored =
      await read(key);

    if (stored) {

      if (revalidate) {

        fetchJSON(url)
          .then(
            (data) =>
              write(
                key,
                data,
                ttl
              )
          )
          .catch(() => {});

      }

      return stored;
    }


    const data =
      await fetchJSON(url);

    await write(
      key,
      data,
      ttl
    );

    return data;
  }


  /* --------------------------------------------------
     API URLS
  -------------------------------------------------- */

  function kirtanListUrl(params = {}) {
    const p =
      new URLSearchParams();

    p.set(
      "summary",
      "1"
    );

    for (const key of ["q", "raag", "type"]) {
      const value =
        String(params[key] || "").trim();

      if (value) {
        p.set(
          key,
          value
        );
      }
    }

    return `/api/kirtans?${p.toString()}`;
  }


  /* --------------------------------------------------
     HOMEPAGE SEARCH + FILTERS
  -------------------------------------------------- */

  async function getAllKirtans() {
    return fetchJSON(
      kirtanListUrl()
    );
  }

  async function getKirtans(
    params = {}
  ) {
    return fetchJSON(
      kirtanListUrl(params)
    );
  }


  /* --------------------------------------------------
     FILTER OPTIONS
  -------------------------------------------------- */

  async function getFilters(params = {}) {
    const p =
      new URLSearchParams();

    for (const key of ["raag", "type"]) {
      const value =
        String(params[key] || "").trim();

      if (value) {
        p.set(
          key,
          value
        );
      }
    }

    const query =
      p.toString();

    return fetchJSON(
      `/api/filters${query ? `?${query}` : ""}`
    );
  }


  /* --------------------------------------------------
     INDIVIDUAL KIRTAN PAGE
     
     THIS IS THE FUNCTION THAT WAS MISSING.
  -------------------------------------------------- */

  async function getKirtan(id) {

    const key =
      KEYS.detail(id);

    return cached(
      key,
      `/api/kirtans/${id}`,
      TTL.detail
    );
  }


  /* --------------------------------------------------
     PUBLIC API
  -------------------------------------------------- */

  return {
    getKirtans,
    getFilters,
    getKirtan,
    getAllKirtans
  };

})();
