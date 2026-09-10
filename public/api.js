const KirtanAPI = (() => {
  const DB_NAME = "pushti-kirtan-cache";
  const DB_VERSION = 3;

  const TTL = {
    list: 7 * 24 * 60 * 60 * 1000,
    detail: 7 * 24 * 60 * 60 * 1000,
  };

  const KEYS = {
    list: "kirtans:v3:summary:verified",
    detail: (id) => `kirtan:v3:${id}`,
  };

  const URLS = {
    list: "/data/kirtans-summary.json",
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
     LOCAL FILTERING
  -------------------------------------------------- */

  function filterList(
    list,
    {
      q = "",
      raag = "",
      type = ""
    } = {}
  ) {

    const term =
      q
        .trim()
        .toLowerCase();

    return list.filter(
      (k) => {

        if (Number(k?.verified) !== 1) {
          return false;
        }

        if (
          raag &&
          k.raag !== raag
        ) {
          return false;
        }

        if (
          type &&
          k.type !== type
        ) {
          return false;
        }

        if (!term) {
          return true;
        }


        const hay = [
          k.title,
          k.preview,
          k.original_text,
          k.translate_text,
          k.transliterate_text
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();


        return hay.includes(
          term
        );
      }
    );
  }


  /* --------------------------------------------------
     DEPENDENT RAAG / OCCASION FILTERS
  -------------------------------------------------- */

  function filtersFromList(
    list,
    {
      raag = "",
      type = ""
    } = {}
  ) {

    /*
      If Occasion/type is selected,
      only show Raags that exist for it.
    */

    const verified =
      list.filter(
        (k) => Number(k?.verified) === 1
      );

    const raags = [
      ...new Set(
        verified
          .filter(
            (k) =>
              k.raag &&
              (
                !type ||
                k.type === type
              )
          )
          .map(
            (k) => k.raag
          )
      ),
    ].sort();


    /*
      If Raag is selected,
      only show Occasions that exist for it.
    */

    const types = [
      ...new Set(
        verified
          .filter(
            (k) =>
              k.type &&
              (
                !raag ||
                k.raag === raag
              )
          )
          .map(
            (k) => k.type
          )
      ),
    ].sort();


    return {
      raags,
      types
    };
  }


  /* --------------------------------------------------
     ALL KIRTANS SUMMARY
  -------------------------------------------------- */

  async function getAllKirtans() {

    const list =
      await cached(
        KEYS.list,
        URLS.list,
        TTL.list
      );

    return list.filter(
      (k) => Number(k?.verified) === 1
    );

  }


  /* --------------------------------------------------
     HOMEPAGE SEARCH + FILTERS
  -------------------------------------------------- */

  async function getKirtans(
    params = {}
  ) {

    const q =
      (
        params.q ||
        ""
      ).trim();

    const raag =
      (
        params.raag ||
        ""
      ).trim();

    const type =
      (
        params.type ||
        ""
      ).trim();


    /*
      If the user entered a search term,
      search the actual D1 database.

      worker.js searches:

      original_text
      translate_text
      transliterate_text
      title

      This allows both Hindi and English searches.
    */

    if (q) {

      const p =
        new URLSearchParams();

      p.set(
        "summary",
        "1"
      );

      p.set(
        "q",
        q
      );


      if (raag) {
        p.set(
          "raag",
          raag
        );
      }


      if (type) {
        p.set(
          "type",
          type
        );
      }


      return fetchJSON(
        `/api/kirtans?${p.toString()}`
      );
    }


    /*
      No search term:
      use the cached summary list for speed.
    */

    const list =
      await getAllKirtans();


    return filterList(
      list,
      {
        q: "",
        raag,
        type
      }
    );
  }


  /* --------------------------------------------------
     FILTER OPTIONS
  -------------------------------------------------- */

  async function getFilters(
    params = {}
  ) {

    const list =
      await getAllKirtans();

    return filtersFromList(
      list,
      params
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
