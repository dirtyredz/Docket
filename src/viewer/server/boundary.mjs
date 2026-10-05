// Request and response safety for the loopback viewer. Every request must name the exact loopback host
// and port (DNS-rebinding defence); a present Origin must be this server's own (never "null"); browser
// cross-site fetches are refused. Mutations additionally need the exact Origin, a JSON body and the
// per-process CSRF token. Responses carry no CORS headers, a strict CSP, nosniff and no framing; errors
// are JSON with a stable code and no stack.
import { CODES, docketError } from "../../core/errors.mjs";

export const BODY_LIMIT = 64 * 1024;
export const TOKEN_HEADER = "x-docket-token";

const SECURITY_HEADERS = Object.freeze({
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "cache-control": "no-store",
});

/** HTTP status for a thrown error (docketError codes; anything else is a 500). */
export function statusFor(err) {
  switch (err?.code) {
    case CODES.USAGE:
    case CODES.NOT_A_REPO:
      return 400;
    case CODES.NOT_FOUND:
      return 404;
    case CODES.CONFLICT:
    case CODES.EXISTS:
    case CODES.CLAIMED:
    case CODES.LOCKED:
      return 409;
    case CODES.INVALID:
    case CODES.RANK_GAP:
      return 422;
    default:
      return err?.httpStatus ?? 500;
  }
}

export const httpError = (status, message) =>
  Object.assign(docketError(CODES.USAGE, message), { httpStatus: status, code: "DOCKET_HTTP" });

/** The host:port spellings this server answers to. */
export const allowedHosts = (port) => [`127.0.0.1:${port}`, `localhost:${port}`];

/**
 * Throw an HTTP error unless the request is acceptable. Reads only headers. `mutating` requests (any
 * method but GET/HEAD) need Origin, JSON content type and the token.
 */
export function checkRequest(req, { port, token }) {
  const host = String(req.headers.host ?? "").toLowerCase();
  if (!allowedHosts(port).includes(host)) throw httpError(421, "unexpected Host header");
  const origin = req.headers.origin;
  const own = `http://${host}`;
  if (origin !== undefined && origin !== own) throw httpError(403, "foreign origin refused");
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") {
    throw httpError(403, "cross-site request refused");
  }
  const mutating = req.method !== "GET" && req.method !== "HEAD";
  if (!mutating) return;
  if (origin !== own) throw httpError(403, "mutations need this server's Origin");
  const type = String(req.headers["content-type"] ?? "");
  if (!/^application\/json(\s*;|$)/i.test(type)) throw httpError(415, "JSON body required");
  if (req.headers[TOKEN_HEADER] !== token) throw httpError(403, "missing or wrong CSRF token");
}

/** Read a bounded JSON object body. */
export function readJsonBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(httpError(413, "request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!size) return resolve({});
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return reject(httpError(400, "body must be a JSON object"));
        }
        resolve(body);
      } catch {
        reject(httpError(400, "body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function send(res, status, body, type) {
  res.writeHead(status, { ...SECURITY_HEADERS, "content-type": type });
  res.end(body);
}

export const sendJson = (res, status, value) =>
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8");

/** Error response: {error: {code, message, details?}}; internal errors never leak their message. */
export function sendError(res, err) {
  const status = statusFor(err);
  const internal = status >= 500 && status !== 503;
  const error = internal
    ? { code: CODES.INTERNAL, message: "internal error" }
    : {
        code: err.code,
        message: err.message,
        ...(err.details && status === 409 ? { details: err.details } : {}),
      };
  sendJson(res, status, { error });
}
