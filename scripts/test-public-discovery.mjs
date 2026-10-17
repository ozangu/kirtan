import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const origin = "https://pushtikirtan.com";
const fixtures = [
  { id: 3, title: "Third", raag: "Bhairav | भैरव", type: "Morning", original_text: "तीसरा", verified: 1 },
  { id: 1, title: "Sāmaro | सामरो", raag: "Bhairav | भैरव", type: "Morning", original_text: "सामरो मंगल\nरूप निधान", translate_text: "An auspicious form", transliterate_text: "Sāmaro maṅgala", verified: 1 },
  { id: 2, title: "Hidden unpublished", raag: "Private", type: "Private", original_text: "Secret draft", verified: 0 },
  { id: 4, title: "<script>alert(1)</script>", raag: "Evening", type: "Evening", original_text: "<img onerror=alert(1)>", verified: 1 },
];
const env = {
  ASSETS: {
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/data/kirtans-full.json") return Response.json(fixtures);
      if (path === "/kirtan-template.txt") {
        return new Response(await readFile(new URL("../public/kirtan-template.txt", import.meta.url), "utf8"));
      }
      return new Response("Missing", { status: 404 });
    },
  },
};
const request = (path, method = "GET") => worker.fetch(new Request(new URL(path, origin), { method }), env);

test("public search paginates in ID order, returns citation URLs, and excludes unpublished rows", async () => {
  const page = await (await request("/api/search?limit=1")).json();
  assert.equal(page.total, 3);
  assert.equal(page.results[0].id, 1);
  assert.equal(page.results[0].url, `${origin}/kirtan/samaro-1`);
  assert.equal(page.results[0].markdown_url, `${origin}/kirtan/samaro-1.md`);
  const second = await (await request(page.next)).json();
  assert.equal(second.results[0].id, 3);
  assert.equal(new URL(second.previous).searchParams.get("offset"), "0");
  assert.equal((await (await request("/api/search?q=secret")).json()).total, 0);
  const empty = await (await request("/api/search?offset=100")).json();
  assert.deepEqual(empty.results, []);
  assert.equal(empty.next, null);
});

test("search supports accented transliterations, Devanagari, meanings, and exact metadata filters", async () => {
  for (const q of ["samaro", "SĀMARO", "सामरो", "auspicious", "maṅgala"]) {
    const page = await (await request(`/api/search?q=${encodeURIComponent(q)}`)).json();
    assert.deepEqual(page.results.map((r) => r.id), [1]);
  }
  const page = await (await request("/api/search?q=bhairav&type=Morning")).json();
  assert.equal(page.total, 2);
  assert.equal((await (await request("/api/search?type=morning")).json()).total, 0);
  // Existing array-returning routes remain compatible with the browser UI.
  assert.ok(Array.isArray(await (await request("/api/kirtans?summary=1")).json()));
});

test("search rejects invalid bounds and non-read methods", async () => {
  for (const query of ["limit=0", "limit=101", "limit=1.5", "offset=-1", "offset=NaN", "offset=9007199254740992", `q=${"x".repeat(201)}`]) {
    assert.equal((await request(`/api/search?${query}`)).status, 400, query);
  }
  for (const path of ["/api/search", "/search", "/browse", "/kirtan/samaro-1.md"]) {
    assert.equal((await request(path, "POST")).status, 405);
    const head = await request(path, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
});

test("Markdown preserves text and citations, redirects stale slugs, and hides drafts", async () => {
  const response = await request("/kirtan/samaro-1.md");
  assert.match(response.headers.get("content-type"), /text\/markdown/);
  assert.equal(response.headers.get("link"), `<${origin}/kirtan/samaro-1>; rel="canonical"`);
  const body = await response.text();
  assert.ok(body.includes("सामरो मंगल\nरूप निधान"));
  assert.ok(body.includes("## English meaning\n\nAn auspicious form"));
  assert.ok(body.includes("## Transliteration\n\nSāmaro maṅgala"));
  assert.equal((await request("/kirtan/hidden-2.md")).status, 404);
  assert.equal((await request("/kirtan/missing-999.md")).status, 404);
  const stale = await request("/kirtan/old-1.md");
  assert.equal(stale.status, 301);
  assert.equal(stale.headers.get("location"), `${origin}/kirtan/samaro-1.md`);
});

test("browse/search HTML works without JavaScript, escapes content, and links collections and results", async () => {
  const browse = await (await request("/browse")).text();
  assert.ok(browse.includes('href="/raag/bhairav"'));
  assert.ok(browse.includes('href="/occasion/morning"'));
  assert.ok(!browse.includes("Private"));
  const search = await (await request("/search?limit=1")).text();
  assert.ok(search.includes('href="https://pushtikirtan.com/kirtan/samaro-1"'));
  assert.ok(search.includes('rel="next"'));
  assert.ok(search.includes('name="robots" content="noindex, follow"'));
  const unsafe = await (await request("/search?q=%3Cscript%3E")).text();
  assert.ok(unsafe.includes("&lt;script&gt;"));
  assert.ok(!unsafe.includes("<script>alert(1)</script>"));
});

test("crawler discovery links and sitemap expose public collections", async () => {
  const robots = await (await request("/robots.txt")).text();
  assert.ok(robots.includes("Allow: /api/search?"));
  assert.ok(robots.includes("Allow: /api/kirtans/"));
  assert.ok(robots.includes("Disallow: /api/"));
  assert.ok(!robots.includes("Disallow: /cont\n"));
  const sitemap = await (await request("/sitemap.xml")).text();
  assert.ok(sitemap.includes(`<loc>${origin}/browse</loc>`));
  assert.ok(!sitemap.includes("hidden-2"));
  const page = await (await request("/kirtan/samaro-1")).text();
  assert.ok(page.includes('type="text/markdown" href="https://pushtikirtan.com/kirtan/samaro-1.md"'));
  assert.ok(page.includes('href="/llms.txt"'));
});

test("OpenAPI definitions and Worker routing configuration cover the public endpoints", async () => {
  const spec = JSON.parse(await readFile(new URL("../public/openapi.json", import.meta.url), "utf8"));
  for (const path of ["/api/search", "/api/filters", "/api/kirtans/{id}", "/kirtan/{slug}.md"]) {
    assert.ok(spec.paths[path].get.operationId);
  }
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  for (const path of ["/browse", "/search", "/api/*", "/kirtan/*", "/robots.txt", "/sitemap.xml"]) {
    assert.ok(config.assets.run_worker_first.includes(path));
  }
});

test("full published archive search and Markdown use the exported source texts", async () => {
  // Isolate the module's corpus cache from the small privacy fixtures above.
  const { default: archiveWorker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#archive`);
  const corpusText = await readFile(new URL("../public/data/kirtans-full.json", import.meta.url), "utf8");
  const published = JSON.parse(corpusText).filter((row) => Number(row.verified) === 1);
  const archiveEnv = { ASSETS: { fetch: async () => new Response(corpusText, { headers: { "content-type": "application/json" } }) } };
  const fetchArchive = (path) => archiveWorker.fetch(new Request(new URL(path, origin)), archiveEnv);
  const response = await fetchArchive("/api/search?limit=2");
  const page = await response.json();
  assert.equal(page.total, published.length);
  assert.equal(page.results.length, 2);
  assert.ok(page.next);
  const first = published.find((row) => Number(row.id) === Number(page.results[0].id));
  const markdown = await fetchArchive(page.results[0].markdown_url);
  assert.equal(markdown.status, 200);
  const body = await markdown.text();
  for (const field of ["original_text", "translate_text", "transliterate_text"]) {
    if (first[field]?.trim()) assert.ok(body.includes(first[field].trim()), field);
  }
  const raagUrl = new URL("/api/search", origin);
  raagUrl.searchParams.set("raag", first.raag);
  const filtered = await (await fetchArchive(raagUrl)).json();
  assert.equal(filtered.total, published.filter((row) => row.raag === first.raag).length);
  const browse = await (await fetchArchive("/browse")).text();
  assert.ok(browse.includes(`${published.length} published kirtans`));
});
