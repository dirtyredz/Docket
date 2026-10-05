// Transient per-checkout summaries for the overview and title search. Built from each checkout's own
// `.docket/index.json` through loadIndex (the per-checkout cache stays the only persisted index).
// Preferred checkouts load progressively, yielding between repos; alternate checkouts load on demand.
// Holds summaries and freshness only: no bodies, never a write path.
import { CLOSED_STATUSES, ENUMS } from "../../core/format/schema.mjs";
import { countBy, listItems } from "../../core/items/query.mjs";
import { loadIndex } from "../../state/index/build.mjs";

const OPEN = ["todo", "wip"];
const MIN_REFRESH_MS = 1000;
const SEARCH_LIMIT = 200;

/** Overview counts for one checkout's complete item list: open totals by priority and by status. */
export function overviewCounts(items) {
  const open = items.filter((i) => !CLOSED_STATUSES.includes(i.status));
  const byStatus = countBy(open, "status");
  return {
    ...countBy(open, "priority"),
    todo: byStatus.todo,
    wip: byStatus.wip,
    open: open.length,
  };
}

/**
 * catalog = createCatalog({registrySource, openCheckout}). Entries are keyed by checkout id:
 * {state: loading | ready | unavailable, items?, invalid?, reason?, loadedAt}.
 */
export function createCatalog({ registrySource, openCheckout, yieldTurn = defaultYield }) {
  const entries = new Map();
  let running = null;
  let lastStart = 0;
  let closed = false;

  function load(repo, checkout, { fresh = false } = {}) {
    try {
      const ctx = openCheckout(repo, checkout, { fresh });
      const { records } = loadIndex(ctx);
      const { items, invalid } = listItems(records, { all: true });
      const entry = { state: "ready", items, invalid, loadedAt: Date.now(), path: checkout.path };
      entries.set(checkout.id, entry);
      return entry;
    } catch (err) {
      const entry = { state: "unavailable", reason: err.message, loadedAt: Date.now() };
      entries.set(checkout.id, entry);
      return entry;
    }
  }

  /** Start (or join) a progressive refresh of every preferred checkout. */
  function refresh({ force = false } = {}) {
    if (running) return running;
    if (!force && Date.now() - lastStart < MIN_REFRESH_MS) return Promise.resolve();
    lastStart = Date.now();
    const { registry } = registrySource.get();
    for (const repo of registry.repos) {
      if (!entries.has(repo.preferred)) entries.set(repo.preferred, { state: "loading" });
    }
    running = (async () => {
      for (const repo of registry.repos) {
        if (closed) break;
        const checkout = repo.checkouts.find((c) => c.id === repo.preferred);
        load(repo, checkout, { fresh: true });
        await yieldTurn();
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  /** The entry for a checkout, loading it now when absent (or always, with `reload`). */
  function ensure(repo, checkout, { reload = false } = {}) {
    const entry = entries.get(checkout.id);
    if (!reload && entry && entry.state !== "loading") return entry;
    return load(repo, checkout);
  }

  const invalidate = (checkoutId) => entries.delete(checkoutId);

  function overview() {
    const { registry, error } = registrySource.get();
    const coverage = { total: registry.repos.length, ready: 0, loading: 0, unavailable: 0 };
    const repos = registry.repos.map((repo) => {
      const entry = entries.get(repo.preferred) ?? { state: "loading" };
      coverage[entry.state] += 1;
      return {
        id: repo.id,
        alias: repo.alias,
        preferred: repo.preferred,
        checkouts: repo.checkouts.map((c) => ({
          id: c.id,
          path: c.path,
          preferred: c.id === repo.preferred,
        })),
        state: entry.state,
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.state === "ready"
          ? { counts: overviewCounts(entry.items), invalid: entry.invalid.length }
          : {}),
        loadedAt: entry.loadedAt ?? null,
      };
    });
    return { repos, coverage, loading: Boolean(running), registryError: error };
  }

  /** Title search over preferred checkouts (open items unless `closed`), with coverage. */
  function search(query, { closed: includeClosed = false } = {}) {
    const q = String(query ?? "")
      .trim()
      .toLowerCase();
    const { registry } = registrySource.get();
    const statuses = includeClosed ? ENUMS.status : OPEN;
    const coverage = { total: registry.repos.length, ready: 0, loading: 0, unavailable: 0 };
    const results = [];
    let matched = 0;
    for (const repo of registry.repos) {
      const entry = entries.get(repo.preferred) ?? { state: "loading" };
      coverage[entry.state] += 1;
      if (entry.state !== "ready" || !q) continue;
      for (const item of entry.items) {
        if (!statuses.includes(item.status)) continue;
        if (!(item.title ?? "").toLowerCase().includes(q)) continue;
        matched += 1;
        if (results.length < SEARCH_LIMIT) {
          results.push({
            repoId: repo.id,
            alias: repo.alias,
            checkoutId: repo.preferred,
            id: item.id,
            title: item.title,
            status: item.status,
            priority: item.priority,
            type: item.type,
          });
        }
      }
    }
    const complete = coverage.ready === coverage.total;
    return { query: q, results, matched, truncated: matched > results.length, coverage, complete };
  }

  function close() {
    closed = true;
  }

  return { refresh, ensure, invalidate, overview, search, close, entries };
}

function defaultYield() {
  return new Promise((resolve) => setImmediate(resolve));
}
