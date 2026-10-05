import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { pickFields } from "../../../src/viewer/server/boundary.mjs";
import { appData, viewer } from "../../helpers/viewer.mjs";

async function setup(t) {
  const data = appData();
  const v = await viewer(data.registryFile);
  t.after(async () => {
    await v.close();
    data.cleanup();
  });
  return v;
}

const refuses = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      resolve(false);
    });
    s.once("error", () => resolve(true));
  });

test("binds loopback only and close() releases the port", async () => {
  const data = appData();
  const v = await viewer(data.registryFile);
  try {
    assert.ok(v.server.url.startsWith("http://127.0.0.1:"));
    assert.equal((await v.get("/api/repos")).status, 200);
  } finally {
    await v.close();
    data.cleanup();
  }
  assert.equal(await refuses(v.server.port), true);
});

test("Host header checks", async (t) => {
  const v = await setup(t);
  const port = v.server.port;
  assert.equal((await v.get("/api/repos", { host: `evil.example:${port}` })).status, 421);
  assert.equal((await v.get("/api/repos", { host: `127.0.0.1:${port + 1}` })).status, 421);
  assert.equal((await v.get("/api/repos", { host: "127.0.0.1" })).status, 421);
  assert.equal((await v.get("/api/repos", { host: `localhost:${port}` })).status, 200);
});

test("Origin and Sec-Fetch-Site checks on reads", async (t) => {
  const v = await setup(t);
  const port = v.server.port;
  const foreign = await v.get("/api/repos", { headers: { origin: "http://evil.example" } });
  assert.equal(foreign.status, 403);
  assert.equal((await v.get("/api/repos", { headers: { origin: "null" } })).status, 403);
  const own = await v.get("/api/repos", { headers: { origin: `http://127.0.0.1:${port}` } });
  assert.equal(own.status, 200);
  const cross = await v.get("/api/repos", { headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(cross.status, 403);
  const same = await v.get("/api/repos", { headers: { "sec-fetch-site": "same-origin" } });
  assert.equal(same.status, 200);
});

test("mutations need token, own Origin and JSON", async (t) => {
  const v = await setup(t);
  assert.equal((await v.post("/api/repos", {}, { token: null })).status, 403);
  assert.equal((await v.post("/api/repos", {}, { token: "wrong" })).status, 403);
  assert.equal((await v.post("/api/repos", {}, { origin: null })).status, 403);
  assert.equal((await v.post("/api/repos", {}, { origin: "http://evil.example" })).status, 403);
  const text = await v.post("/api/repos", "{}", { headers: { "content-type": "text/plain" } });
  assert.equal(text.status, 415);
  // A fully valid mutation passes the boundary; /api/repos is read-only, so 405.
  assert.equal((await v.post("/api/repos", {})).status, 405);
});

test("oversized body is refused (413, or 405 when the route is rejected before reading)", async (t) => {
  const v = await setup(t);
  const body = JSON.stringify("x".repeat(70 * 1024));
  let status;
  try {
    status = (await v.post("/api/repos", body)).status;
  } catch (err) {
    // The server may reset the connection once it decides to refuse the body.
    assert.match(String(err.code), /ECONNRESET|EPIPE/);
    return;
  }
  assert.ok([405, 413].includes(status), `status ${status}`);
});

test("unknown API paths are JSON 404", async (t) => {
  const v = await setup(t);
  const r = await v.get("/api/x");
  assert.equal(r.status, 404);
  assert.equal(typeof r.json.error.code, "string");
  assert.equal(typeof r.json.error.message, "string");
  assert.equal(r.json.error.stack, undefined);
});

test("static serving: shell, assets, and no traversal", async (t) => {
  const v = await setup(t);
  const root = await v.get("/");
  assert.equal(root.status, 200);
  assert.match(root.headers["content-type"], /text\/html/);
  assert.match(root.text, /<meta[^>]*name="docket-token"/);
  assert.ok(root.text.includes(v.server.token));
  const app = await v.get("/ui/app.mjs");
  assert.equal(app.status, 200);
  assert.match(app.headers["content-type"], /^text\/javascript/);
  for (const p of [
    "/ui/../package.json",
    "/ui/%2e%2e/package.json",
    "/package.json",
    "/ui/nope.mjs",
  ]) {
    assert.equal((await v.get(p)).status, 404, p);
  }
});

test("every response carries security headers and no CORS", async (t) => {
  const v = await setup(t);
  const responses = [
    await v.get("/"),
    await v.get("/ui/app.mjs"),
    await v.get("/api/repos"),
    await v.get("/api/x"),
    await v.get("/nope"),
    await v.get("/api/repos", { host: "evil.example" }),
    await v.post("/api/repos", {}, { token: null }),
  ];
  for (const r of responses) {
    assert.match(r.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.headers["x-frame-options"], "DENY");
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  }
});

test("pickFields refuses unknown keys and checks the expected revision", () => {
  assert.throws(() => pickFields({ a: 1, x: 2 }, { allowed: ["a"] }), /not accepted here: x/);
  assert.deepEqual(pickFields({ a: 1 }, { allowed: ["a"] }), { a: 1 });
  assert.throws(
    () => pickFields({ a: 1 }, { allowed: ["a"], expected: true }),
    /expected revision/,
  );
  assert.throws(
    () => pickFields({ expected: "" }, { allowed: [], expected: true }),
    /expected revision/,
  );
  assert.deepEqual(pickFields({ expected: "r1" }, { allowed: [], expected: true }), {
    expected: "r1",
  });
  assert.throws(() => pickFields({}, { allowed: [], expected: "map" }), /expected revisions/);
  assert.throws(
    () => pickFields({ expected: { nope: "r" } }, { allowed: [], expected: "map" }),
    /bad expected revision entry/,
  );
  pickFields({ expected: { "dk-0000a001": "r" } }, { allowed: [], expected: "map" });
});
