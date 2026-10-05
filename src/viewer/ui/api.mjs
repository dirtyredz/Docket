// HTTP client for the viewer API. Mutations send the per-process CSRF token from the shell's meta tag
// and a JSON body; errors become ApiError with the server's status, code and details.

const token = document.querySelector('meta[name="docket-token"]')?.content ?? "";

export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message ?? `HTTP ${status}`);
    this.status = status;
    this.code = error?.code;
    this.details = error?.details;
  }
}

async function request(method, path, body) {
  const init = { method, headers: { accept: "application/json" }, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.headers["x-docket-token"] = token;
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.error);
  return json;
}

const enc = encodeURIComponent;
const co = (repo, checkout) => `/api/repos/${enc(repo)}/checkouts/${enc(checkout)}`;

export const api = {
  overview: (refresh = false) => request("GET", `/api/repos${refresh ? "?refresh=1" : ""}`),
  search: (q, closed) => request("GET", `/api/search?q=${enc(q)}${closed ? "&closed=1" : ""}`),
  board: (repo, checkout) => request("GET", `${co(repo, checkout)}/items`),
  item: (repo, checkout, id) => request("GET", `${co(repo, checkout)}/items/${enc(id)}`),
  relations: (repo, checkout, id) =>
    request("GET", `${co(repo, checkout)}/items/${enc(id)}/relations`),
  documents: (repo, checkout) => request("GET", `${co(repo, checkout)}/documents`),
  document: (repo, checkout, name, source) =>
    request("GET", `${co(repo, checkout)}/documents/${enc(name)}${source ? "?view=source" : ""}`),
  worktrees: (repo) => request("GET", `/api/repos/${enc(repo)}/worktrees`),
  save: (repo, checkout, id, body) =>
    request("POST", `${co(repo, checkout)}/items/${enc(id)}`, body),
  saveBody: (repo, checkout, id, body) =>
    request("POST", `${co(repo, checkout)}/items/${enc(id)}/body`, body),
  addNote: (repo, checkout, id, body) =>
    request("POST", `${co(repo, checkout)}/items/${enc(id)}/notes`, body),
  resolveNote: (repo, checkout, id, ref, body) =>
    request("POST", `${co(repo, checkout)}/items/${enc(id)}/notes/${enc(ref)}/resolve`, body),
  relate: (repo, checkout, id, body) =>
    request("POST", `${co(repo, checkout)}/items/${enc(id)}/relations`, body),
};
