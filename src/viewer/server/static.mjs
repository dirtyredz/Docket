// Packaged UI assets. Only the files listed here are served; there is no general file serving. The
// shell (index.html) carries the per-process CSRF token in a meta tag (no inline script under the CSP).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");

/** Every served asset, relative to src/viewer/ui/ (also the packaging contract). */
export const ASSETS = Object.freeze([
  "index.html",
  "styles.css",
  "app.mjs",
  "api.mjs",
  "dom.mjs",
  "drafts.mjs",
  "views/repo-picker.mjs",
  "views/overview.mjs",
  "views/board.mjs",
  "views/item-editor.mjs",
  "views/item/conflict-save.mjs",
  "views/item/scalar-editor.mjs",
  "views/item/body-editor.mjs",
  "views/item/notes.mjs",
  "views/relations.mjs",
  "views/documents.mjs",
  "views/search.mjs",
  "views/worktree-hints.mjs",
]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

/** Load every asset once. Returns get(urlPath) -> {body, type} | null. */
export function loadAssets(token, dir = UI_DIR) {
  const files = new Map();
  for (const rel of ASSETS) {
    let body = fs.readFileSync(path.join(dir, rel), "utf8");
    if (rel === "index.html") body = body.replace("__DOCKET_TOKEN__", token);
    files.set(rel === "index.html" ? "/" : `/ui/${rel}`, {
      body,
      type: TYPES[path.extname(rel)],
    });
  }
  return (urlPath) => files.get(urlPath) ?? null;
}
