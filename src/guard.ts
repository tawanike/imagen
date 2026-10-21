import type { RequestHandler } from 'express';

const LOOPBACK_BINDS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '::1'];

export function isLoopbackBind(host: string): boolean {
  return LOOPBACK_BINDS.has(host);
}

/** Extracts the lowercase hostname from a Host header value ("localhost:4747", "[::1]:4747"). */
export function hostnameFromHostHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v.startsWith('[')) {
    const end = v.indexOf(']');
    return end > 0 ? v.slice(1, end) : undefined;
  }
  return v.split(':')[0] || undefined;
}

/**
 * DNS-rebinding and cross-site protection for a server that has no authentication.
 * Rejects requests whose Host header, or Origin header when present, is not a known
 * local name. Browsers always send Origin on cross-site requests, so this blocks a
 * malicious web page from driving the server (and spending your API credits).
 */
export function localOnlyGuard(extraHostnames: string[] = []): RequestHandler {
  const allowed = new Set([...LOOPBACK_NAMES, ...extraHostnames.map((h) => h.toLowerCase())]);
  return (req, res, next) => {
    const host = hostnameFromHostHeader(req.headers.host);
    if (!host || !allowed.has(host)) {
      res.status(403).type('text/plain').send(`Forbidden: unexpected Host header "${req.headers.host ?? ''}"`);
      return;
    }
    const origin = req.headers.origin;
    if (origin) {
      let originHost: string | undefined;
      try {
        originHost = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase();
      } catch {
        originHost = undefined;
      }
      if (!originHost || !allowed.has(originHost)) {
        res.status(403).type('text/plain').send(`Forbidden: cross-origin request from "${origin}"`);
        return;
      }
    }
    next();
  };
}
