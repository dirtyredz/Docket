// Viewer shell: hash routing, navigation composition, refresh scheduling and keyboard shortcuts.
// Routes: #/ (overview), #/search?q=..&closed=1, #/r/<repo>/<checkout>/<board|docs|worktrees>/...
import { api } from "./api.mjs";
import { h, replace } from "./dom.mjs";
import { anyDirty } from "./drafts.mjs";
import { renderBoard } from "./views/board.mjs";
import { renderDocuments } from "./views/documents.mjs";
import { renderItemDetail } from "./views/item-editor.mjs";
import { renderOverview } from "./views/overview.mjs";
import { renderRepoPicker, repoHeader } from "./views/repo-picker.mjs";
import { renderSearch } from "./views/search.mjs";
import { renderWorktreeHints } from "./views/worktree-hints.mjs";

const POLL_LOADING_MS = 400;
const VISIBLE_REFRESH_MS = 30000;

const els = {
  main: document.getElementById("main"),
  sidebar: document.getElementById("sidebar"),
  detail: document.getElementById("detail"),
  status: document.getElementById("status"),
  searchForm: document.getElementById("search-form"),
  searchInput: document.getElementById("search-input"),
  searchClosed: document.getElementById("search-closed"),
  refresh: document.getElementById("refresh"),
};

const state = { overview: null, route: { view: "overview" }, pollTimer: null };

export function parseRoute(hash = location.hash) {
  const [path, qs = ""] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "search") {
    const params = new URLSearchParams(qs);
    return { view: "search", q: params.get("q") ?? "", closed: params.get("closed") === "1" };
  }
  if (parts[0] === "r" && parts[1] && parts[2]) {
    return { view: parts[3] ?? "board", repo: parts[1], checkout: parts[2], rest: parts.slice(4) };
  }
  return { view: "overview" };
}

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = kind || "muted";
}

export function showError(err) {
  setStatus(err.message, "error");
}

async function loadOverview({ refresh = false } = {}) {
  try {
    state.overview = await api.overview(refresh);
  } catch (err) {
    showError(err);
    return;
  }
  renderRepoPicker(els.sidebar, state.overview, state.route.repo);
  if (state.route.view === "overview") renderOverview(els.main, state.overview);
  clearTimeout(state.pollTimer);
  const pending = state.overview.loading || state.overview.coverage.loading > 0;
  if (pending) state.pollTimer = setTimeout(() => loadOverview(), POLL_LOADING_MS);
  setStatus(pending ? "loading…" : `updated ${new Date().toLocaleTimeString()}`);
}

async function renderSearchRoute(route) {
  els.searchInput.value = route.q;
  els.searchClosed.checked = route.closed;
  try {
    renderSearch(els.main, await api.search(route.q, route.closed));
  } catch (err) {
    showError(err);
  }
}

async function render() {
  state.route = parseRoute();
  const route = state.route;
  if (route.view === "overview") {
    els.detail.hidden = true;
    if (state.overview) renderOverview(els.main, state.overview);
    return loadOverview({ refresh: true });
  }
  if (route.view === "search") {
    els.detail.hidden = true;
    return renderSearchRoute(route);
  }
  return renderRepoRoute(route);
}

const baseOf = (route) => `#/r/${route.repo}/${route.checkout}`;

async function renderRepoRoute(route) {
  if (!state.overview) await loadOverview();
  const repo = state.overview?.repos.find((r) => r.id === route.repo);
  if (!repo) {
    els.detail.hidden = true;
    return replace(
      els.main,
      h("p", { class: "error" }, "Unknown repo (removed from the registry?)."),
    );
  }
  renderRepoPicker(els.sidebar, state.overview, repo.id);
  const view = h("div", { class: "view" });
  const header = repoHeader(repo, route, (checkout) => {
    location.hash = `#/r/${repo.id}/${checkout}/${route.view}`;
  });
  replace(els.main, header, view);
  try {
    if (route.view === "board") await renderBoardRoute(view, route);
    else if (route.view === "docs") await renderDocsRoute(view, route);
    else if (route.view === "worktrees") {
      els.detail.hidden = true;
      renderWorktreeHints(view, await api.worktrees(route.repo), { repoId: route.repo });
    }
  } catch (err) {
    replace(view, h("p", { class: "error", "data-testid": "view-error" }, err.message));
  }
}

async function renderBoardRoute(view, route) {
  const base = baseOf(route);
  const selected = route.rest[0];
  const board = await api.board(route.repo, route.checkout);
  const rerender = () => renderBoard(view, board, { base, selected, rerender });
  rerender();
  if (!selected) {
    els.detail.hidden = true;
    return;
  }
  els.detail.hidden = false;
  // A background refresh never re-renders the editor under the user's cursor (drafts survive anyway).
  const shown = els.detail.dataset.item === `${route.checkout}/${selected}`;
  if (shown && els.detail.contains(document.activeElement)) return;
  await renderDetail(route, base, selected);
}

export async function renderDetail(route, base, id) {
  const [item, relations] = await Promise.all([
    api.item(route.repo, route.checkout, id),
    api.relations(route.repo, route.checkout, id).catch(() => null),
  ]);
  els.detail.dataset.item = `${route.checkout}/${id}`;
  renderItemDetail(els.detail, {
    item,
    relations,
    base,
    route,
    reload: () => renderDetail(route, base, id),
    onSaved: async (warnings) => {
      els.detail.dataset.item = ""; // force the detail to re-read the saved item
      await render();
      if (warnings.length) showError({ message: warnings.map((w) => w.message).join("; ") });
      else setStatus("saved");
    },
  });
}

async function renderDocsRoute(view, route) {
  els.detail.hidden = true;
  const [name, mode] = route.rest;
  const list = await api.documents(route.repo, route.checkout);
  const doc = name ? await api.document(route.repo, route.checkout, name, mode === "source") : null;
  renderDocuments(view, { list, doc, base: baseOf(route), name, source: mode === "source" });
}

function navigateSearch() {
  const q = els.searchInput.value.trim();
  location.hash = `#/search?q=${encodeURIComponent(q)}${els.searchClosed.checked ? "&closed=1" : ""}`;
}

function wire() {
  window.addEventListener("hashchange", () => render());
  window.addEventListener("beforeunload", (e) => {
    if (!anyDirty()) return;
    e.preventDefault();
    e.returnValue = ""; // drafts are session-only: reload or close loses them
  });
  els.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    navigateSearch();
  });
  els.searchClosed.addEventListener("change", () => {
    if (state.route.view === "search") navigateSearch();
  });
  els.refresh.addEventListener("click", () => refreshAll());
  window.addEventListener("focus", () => refreshAll());
  setInterval(() => {
    if (document.visibilityState === "visible") refreshAll();
  }, VISIBLE_REFRESH_MS);
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "");
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") {
      e.preventDefault();
      els.searchInput.focus();
    } else if (e.key === "r") refreshAll();
    else if (e.key === "Escape" && state.route.view === "board" && state.route.rest[0]) {
      location.hash = `${baseOf(state.route)}/board`;
    }
  });
}

export async function refreshAll() {
  await loadOverview({ refresh: true });
  if (state.route.view !== "overview") await render();
}

wire();
render();
