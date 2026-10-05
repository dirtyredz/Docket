// Viewer shell: hash routing, navigation composition, refresh scheduling and keyboard shortcuts.
// Routes: #/ (overview), #/search?q=..&closed=1, #/r/<repo>/<checkout>/<board|docs|worktrees>/...
import { api } from "./api.mjs";
import { h, replace } from "./dom.mjs";
import { renderOverview } from "./views/overview.mjs";
import { renderRepoPicker } from "./views/repo-picker.mjs";
import { renderSearch } from "./views/search.mjs";

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
  replace(els.main, h("p", { class: "muted" }, "This view is not available yet."));
}

function navigateSearch() {
  const q = els.searchInput.value.trim();
  location.hash = `#/search?q=${encodeURIComponent(q)}${els.searchClosed.checked ? "&closed=1" : ""}`;
}

function wire() {
  window.addEventListener("hashchange", () => render());
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
  });
}

export async function refreshAll() {
  await loadOverview({ refresh: true });
  if (state.route.view !== "overview") await render();
}

wire();
render();
