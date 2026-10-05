import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempDir } from "../../helpers/repository.mjs";
import { appData, docketRepo, register, viewer } from "../../helpers/viewer.mjs";

/** Repo with `files` {relpath: text} committed, registered with `options`, server started. */
async function start(t, files, options = {}) {
  const data = appData();
  const r = docketRepo({});
  const cleanups = [r.cleanup, data.cleanup];
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(r.root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  r.commit("docs");
  const reg = register(data.registryFile, r.root, { alias: "alpha", ...options });
  const v = await viewer(data.registryFile);
  t.after(async () => {
    await v.close();
    for (const c of cleanups) c();
  });
  const base = `/api/repos/${reg.repo.id}/checkouts/${reg.checkout.id}/documents`;
  const list = async () => (await v.get(base)).json.documents;
  const entry = async (name) => (await list()).find((d) => d.name === name);
  return { v, r, base, list, entry, cleanups };
}

test("lists the seven names; absent documents have a null source", async (t) => {
  const { list } = await start(t, { "STRUCTURE.md": "# s\n" });
  const docs = await list();
  assert.deepEqual(
    docs.map((d) => d.name),
    ["STRUCTURE", "ARCHITECTURE", "DECISIONS", "FEATURES", "ROADMAP", "BACKLOG", "GOTCHAS"],
  );
  assert.equal(docs[0].source, "STRUCTURE.md");
  assert.equal(docs[0].via, "root");
  for (const d of docs.slice(1)) {
    assert.equal(d.source, null);
    assert.equal(d.via, null);
    assert.deepEqual(d.duplicates, []);
  }
});

test("precedence: override, then root, then docs/", async (t) => {
  const { entry } = await start(
    t,
    {
      "design/arch.md": "# override\n",
      "ARCHITECTURE.md": "# root\n",
      "docs/ARCHITECTURE.md": "# docs\n",
    },
    { docs: { ARCHITECTURE: "design/arch.md" } },
  );
  const e = await entry("ARCHITECTURE");
  assert.equal(e.source, "design/arch.md");
  assert.equal(e.via, "override");
  assert.deepEqual(e.duplicates, ["ARCHITECTURE.md", "docs/ARCHITECTURE.md"]);
});

test("root beats docs/ and the duplicate is reported", async (t) => {
  const { entry, v, base } = await start(t, {
    "ARCHITECTURE.md": "# root\n",
    "docs/ARCHITECTURE.md": "# docs\n",
  });
  const e = await entry("ARCHITECTURE");
  assert.equal(e.source, "ARCHITECTURE.md");
  assert.equal(e.via, "root");
  assert.deepEqual(e.duplicates, ["docs/ARCHITECTURE.md"]);
  const doc = await v.get(`${base}/ARCHITECTURE`);
  assert.deepEqual(doc.json.duplicates, ["docs/ARCHITECTURE.md"]);
  assert.match(doc.json.html, /root/);
});

test("docs/ is used when there is no root file", async (t) => {
  const { entry } = await start(t, { "docs/GOTCHAS.md": "# g\n" });
  const e = await entry("GOTCHAS");
  assert.equal(e.source, "docs/GOTCHAS.md");
  assert.equal(e.via, "docs");
});

test("an override pointing at a missing file is flagged and falls back", async (t) => {
  const { entry } = await start(
    t,
    { "docs/ARCHITECTURE.md": "# docs\n" },
    {
      docs: { ARCHITECTURE: "design/missing.md" },
    },
  );
  const e = await entry("ARCHITECTURE");
  assert.equal(e.overrideMissing, "design/missing.md");
  assert.equal(e.source, "docs/ARCHITECTURE.md");
  assert.equal(e.via, "docs");
});

test("a missing document is 404; unknown names are 404", async (t) => {
  const { v, base } = await start(t, { "STRUCTURE.md": "# s\n" });
  const missing = await v.get(`${base}/FEATURES`);
  assert.equal(missing.status, 404);
  assert.ok(missing.json.error.code);
  for (const bad of ["README", "readme", "..%2fx", "STRUCTURE.md", "x"]) {
    assert.equal((await v.get(`${base}/${bad}`)).status, 404, bad);
  }
});

test("source view returns the exact text", async (t) => {
  const text = "# Title\r\n\nline with <b>tags</b> & [link](x.md)\n\n- a\n";
  const { v, base } = await start(t, { "ROADMAP.md": text });
  const r = await v.get(`${base}/ROADMAP?view=source`);
  assert.equal(r.status, 200);
  assert.equal(r.json.text, text);
  assert.equal(r.json.source, "ROADMAP.md");
  assert.equal(r.json.html, undefined);
});

const PAYLOAD = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<iframe src="https://x"></iframe>',
  "[x](javascript:alert(1))",
  '<a href="//evil.example">p</a>',
  "<form><input name=a></form>",
  "<style>body{}</style>",
  '<div onclick="x">d</div>',
  "[ok](https://example.com)",
].join("\n\n");

test("document HTML is sanitized", async (t) => {
  const { v, base } = await start(t, { "DECISIONS.md": `# D\n\n${PAYLOAD}\n` });
  const r = await v.get(`${base}/DECISIONS`);
  assert.equal(r.status, 200);
  const html = r.json.html.replace(/ title="[^"]*"/g, ""); // inert title text may quote the link
  for (const bad of [
    "<script",
    "onerror",
    "<iframe",
    "javascript:",
    "<form",
    "<style",
    "onclick",
    "<img",
    'href="//evil',
  ]) {
    assert.ok(!html.includes(bad), `html must not contain ${bad}: ${html}`);
  }
  assert.ok(html.includes('<a href="https://example.com"'), html);
});

test("relative links resolve to catalog documents; other files are unresolved spans", async (t) => {
  const { v, base } = await start(t, {
    "STRUCTURE.md": "# s\n",
    "README.md": "# readme\n",
    "docs/ARCHITECTURE.md": "See [structure](../STRUCTURE.md) and [readme](../README.md).\n",
  });
  const html = (await v.get(`${base}/ARCHITECTURE`)).json.html;
  assert.ok(html.includes('href="#doc/STRUCTURE"'), html);
  assert.match(html, /<span class="unresolved"[^>]*>readme<\/span>/);
  assert.ok(!html.includes("README.md</a>"));
  assert.ok(!/href="[^"]*README/.test(html), html);
});

test("documents cannot be mutated: POST, PUT and DELETE are 405 and the file is unchanged", async (t) => {
  const { v, r, base } = await start(t, { "ARCHITECTURE.md": "# original\n" });
  const file = path.join(r.root, "ARCHITECTURE.md");
  for (const url of [base, `${base}/ARCHITECTURE`]) {
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await v.request(method, url, { body: { text: "# hacked\n" } });
      assert.equal(res.status, 405, `${method} ${url}`);
    }
  }
  assert.equal(fs.readFileSync(file, "utf8"), "# original\n");
});

test("a document that is a link to a file outside the checkout is not served", async (t) => {
  const outside = tempDir("docket outside ");
  t.after(outside.cleanup);
  const secret = path.join(outside.dir, "secret.md");
  fs.writeFileSync(secret, "# SECRET-OUTSIDE\n");
  const { v, r, base, entry } = await start(t, { "STRUCTURE.md": "# s\n" });
  try {
    fs.symlinkSync(secret, path.join(r.root, "GOTCHAS.md"), "file");
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EACCES") {
      t.skip("symlink creation not permitted");
      return;
    }
    throw err;
  }
  const e = await entry("GOTCHAS");
  assert.equal(e.source, null);
  const res = await v.get(`${base}/GOTCHAS`);
  assert.equal(res.status, 404);
  assert.ok(!res.text.includes("SECRET-OUTSIDE"));
  const src = await v.get(`${base}/GOTCHAS?view=source`);
  assert.equal(src.status, 404);
});
