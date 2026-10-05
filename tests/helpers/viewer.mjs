// Viewer test support: disposable application-data roots (never the owner's registry), registered
// fixture repos, an in-process server, and raw HTTP requests with full control over Host, Origin and
// token headers.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { startServer } from "../../src/viewer/server/main.mjs";
import { inspectCheckout, registerCheckout } from "../../src/state/registry/registration.mjs";
import { updateRegistry } from "../../src/state/registry/store.mjs";
import { git, makeRepo, tempDir } from "./repository.mjs";

/** A temp DOCKET_HOME. Returns {home, registryFile, env, cleanup}. */
export function appData() {
  const { dir, cleanup } = tempDir("docket viewer home ");
  return {
    home: dir,
    registryFile: path.join(dir, "registry.json"),
    env: { DOCKET_HOME: dir },
    cleanup,
  };
}

/** makeRepo plus a committed docket.json, so it can be registered. */
export function docketRepo(items = {}, options) {
  const r = makeRepo(items, options);
  fs.writeFileSync(path.join(r.root, "docket.json"), '{\n  "version": 1\n}\n');
  r.commit("init");
  return r;
}

/** Add a linked worktree of `r` at `<r.dir>/<name>` on a new branch. Returns its path. */
export function addWorktree(r, name = "wt", branch = name) {
  const wt = path.join(r.dir, name);
  git(r.root, "worktree", "add", "-q", "-b", branch, wt);
  return wt;
}

/** Register checkout `p` in `registryFile` (options as registerCheckout). Returns {repo, checkout}. */
export function register(registryFile, p, options) {
  const info = inspectCheckout(p);
  return updateRegistry(registryFile, (reg) => ({ value: registerCheckout(reg, info, options) }))
    .value;
}

/** Start a server on the registry; returns the server plus request helpers bound to it. */
export async function viewer(registryFile) {
  const server = await startServer({ registryFile });
  const origin = `http://127.0.0.1:${server.port}`;
  const request = (method, urlPath, { body, headers = {}, host, origin: o, token } = {}) =>
    new Promise((resolve, reject) => {
      const data =
        body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body);
      const h = { host: host ?? `127.0.0.1:${server.port}`, ...headers };
      if (o !== undefined) {
        if (o !== null) h.origin = o;
      } else if (method !== "GET") h.origin = origin;
      if (method !== "GET") {
        h["content-type"] ??= "application/json";
        if (token !== null) h["x-docket-token"] = token ?? server.token;
      }
      if (data !== null) h["content-length"] = Buffer.byteLength(data);
      const req = http.request(
        { host: "127.0.0.1", port: server.port, method, path: urlPath, headers: h },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try {
              json = JSON.parse(text);
            } catch {
              /* not JSON */
            }
            resolve({ status: res.statusCode, headers: res.headers, text, json });
          });
        },
      );
      req.on("error", reject);
      if (data !== null) req.write(data);
      req.end();
    });
  const get = (p, opts) => request("GET", p, opts);
  const post = (p, body, opts) => request("POST", p, { ...opts, body });
  /** Poll /api/repos until no repo is loading. */
  const settled = async (timeoutMs = 20000) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const r = await get("/api/repos");
      if (!r.json.loading && r.json.coverage.loading === 0) return r.json;
      if (Date.now() > end) throw new Error("catalog did not settle");
      await new Promise((res) => setTimeout(res, 25));
    }
  };
  return { server, origin, request, get, post, settled, close: () => server.close() };
}
