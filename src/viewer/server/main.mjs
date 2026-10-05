// Viewer server lifecycle: bind 127.0.0.1 only (no host option), route API requests to the scoped
// route modules, serve the packaged UI, and shut down cleanly (server, connections, catalog loop).
// Loaded only by `docket serve` (dynamic import), so ordinary CLI and gate startup never need the
// viewer's Markdown dependencies.
import { randomBytes } from "node:crypto";
import http from "node:http";
import {
  checkRequest,
  httpError,
  readJsonBody,
  send,
  sendError,
  sendJson,
  statusFor,
} from "./boundary.mjs";
import { createCatalog } from "./catalog.mjs";
import { createCheckoutOpener, createRegistrySource } from "./scope.mjs";
import { loadAssets } from "./static.mjs";
import { bodyRoutes } from "./routes/body.mjs";
import { documentRoutes } from "./routes/documents.mjs";
import { itemRoutes } from "./routes/items.mjs";
import { noteRoutes } from "./routes/notes.mjs";
import { relationRoutes } from "./routes/relations.mjs";
import { repoRoutes } from "./routes/repos.mjs";
import { searchRoutes } from "./routes/search.mjs";

export const HOST = "127.0.0.1";

const defaultLog = (err) =>
  process.stderr.write(`docket serve: internal error: ${err.stack ?? err}
`);

function compile(routes) {
  return routes.map((r) => ({
    ...r,
    regex: new RegExp(`^${r.path.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`),
  }));
}

function match(routes, method, pathname) {
  let allowed = false;
  for (const r of routes) {
    const m = r.regex.exec(pathname);
    if (!m) continue;
    if (r.method === method) return { route: r, params: { ...m.groups } };
    allowed = true;
  }
  if (allowed) throw httpError(405, "method not allowed");
  throw httpError(404, "no such endpoint");
}

/**
 * Start the viewer. options: {registryFile, port = 0 (any free port), log (internal errors; stderr)}.
 * Resolves after binding to {url, port, token, close()}.
 */
export async function startServer({ registryFile, port = 0, log = defaultLog } = {}) {
  const token = randomBytes(24).toString("hex");
  const registrySource = createRegistrySource(registryFile);
  const openCheckout = createCheckoutOpener();
  const catalog = createCatalog({ registrySource, openCheckout });
  const deps = { registrySource, openCheckout, catalog };
  const routes = compile([
    ...repoRoutes(deps),
    ...searchRoutes(deps),
    ...itemRoutes(deps),
    ...relationRoutes(deps),
    ...bodyRoutes(deps),
    ...noteRoutes(deps),
    ...documentRoutes(deps),
  ]);
  const asset = loadAssets(token);
  let actualPort = port;

  const server = http.createServer(async (req, res) => {
    try {
      checkRequest(req, { port: actualPort, token });
      const url = new URL(req.url, `http://${HOST}`);
      if (!url.pathname.startsWith("/api/")) {
        if (req.method !== "GET" && req.method !== "HEAD") throw httpError(405, "read-only path");
        const file = asset(url.pathname);
        if (!file) throw httpError(404, "not found");
        return send(res, 200, file.body, file.type);
      }
      const { route, params } = match(routes, req.method, url.pathname);
      const body = req.method === "POST" ? await readJsonBody(req) : {};
      const out = await route.handler({ params, query: url.searchParams, body });
      sendJson(res, 200, out); // handlers return the JSON body; failures are thrown
    } catch (err) {
      if (statusFor(err) === 500) log(err);
      sendError(res, err);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  actualPort = server.address().port;
  catalog.refresh({ force: true });

  let closing = null;
  const close = () => {
    closing ??= new Promise((resolve) => {
      catalog.close();
      server.close(() => resolve());
      server.closeAllConnections();
    });
    return closing;
  };
  return { url: `http://${HOST}:${actualPort}/`, port: actualPort, token, close, catalog };
}
