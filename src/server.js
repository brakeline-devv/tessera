// Tessera HTTP server: static site, JSON API for the studio, sandboxed previews, MCP + REST for agents.
//   node src/server.js        (reads .env; without ANTHROPIC_API_KEY it runs in MOCK mode)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { CONFIG } from "./config.js";
import { openDb, makeLedger } from "./db.js";
import { makeService, UserError } from "./service.js";
import { handleMcp, callTool, TOOLS } from "./mcp.js";
import { MC_PER_CREDIT } from "./pricing.js";
import { ethUsd } from "./chain.js";

const db = openDb();
const ledger = makeLedger(db);
const svc = makeService(db, ledger);
const WEB = join(CONFIG.root, "web");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json", ".mp4": "video/mp4" };

const SITE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
// generated pages run in an opaque origin (CSP sandbox, no allow-same-origin): no cookies, no access to the studio
const PREVIEW_CSP = "sandbox allow-scripts allow-pointer-lock; default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; media-src data: blob:; connect-src https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; frame-ancestors 'self'";

const send = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
const setCookie = (token, maxAge) => `tessera_s=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${CONFIG.secureCookies ? "; Secure" : ""}`;
async function readBody(req, limit = 64 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new UserError("request too large", 413); chunks.push(c); }
  const s = Buffer.concat(chunks).toString("utf8");
  if (!s) return {};
  try { return JSON.parse(s); } catch { throw new UserError("body must be JSON"); }
}
// tiny per-IP rate limiter
const hits = new Map();
function limited(req, bucket, max, windowMs) {
  const ip = (req.headers["x-real-ip"] || req.socket.remoteAddress || "?") + ":" + bucket;
  const t = Date.now(), h = hits.get(ip) || { n: 0, t };
  if (t - h.t > windowMs) { h.n = 0; h.t = t; }
  h.n++; hits.set(ip, h);
  return h.n > max;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (t - v.t > 3600_000) hits.delete(k); }, 600_000).unref();

function serveStatic(req, res, path) {
  let f = normalize(join(WEB, path === "/" ? "index.html" : path));
  if (!f.startsWith(WEB)) return send(res, 403, { error: "forbidden" });
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(WEB, "index.html");     // SPA fallback
  const ext = extname(f);
  // real sample outputs shown on the landing page: framed like any generated page (sandboxed, opaque origin)
  if (ext === ".html" && f.startsWith(join(WEB, "showcase"))) {
    res.writeHead(200, { "content-type": TYPES[ext], "cache-control": "public, max-age=300", "content-security-policy": PREVIEW_CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
    return res.end(readFileSync(f));
  }
  res.writeHead(200, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": ext === ".html" ? "no-cache" : "public, max-age=300",
    "content-security-policy": SITE_CSP, "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY" });
  // the page's share tags need absolute URLs
  res.end(f.endsWith("index.html") ? readFileSync(f, "utf8").replaceAll("__SITE__", CONFIG.publicUrl.replace(/\/$/, "")) : readFileSync(f));
}

function servePreview(req, res, outId, url) {
  const o = svc.outputRaw(outId);
  if (!o) return send(res, 404, { error: "not found" });
  const base = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "private, max-age=600", "content-security-policy": PREVIEW_CSP };
  const dl = url.searchParams.get("download") === "1";
  const fname = (o.title || o.mode).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || o.mode;
  if (o.kind === "html") { res.writeHead(200, { ...base, "content-type": "text/html; charset=utf-8", ...(dl ? { "content-disposition": `attachment; filename="${fname}.html"` } : {}) }); return res.end(o.body); }
  if (o.kind === "svg") {
    const list = JSON.parse(o.body), i = Math.max(0, Math.min(list.length - 1, Number(url.searchParams.get("i")) || 0));
    res.writeHead(200, { ...base, "content-type": "image/svg+xml", ...(dl ? { "content-disposition": `attachment; filename="${fname}-${i + 1}.svg"` } : {}) }); return res.end(list[i]);
  }
  const d = JSON.parse(o.body);
  const txt = `THREAD\n\n${d.thread.map((p, i) => `${i + 1}/ ${p}`).join("\n\n")}\n\nPOSTS\n\n${d.posts.join("\n\n")}\n\nBIO\n\n${d.bio}\n`;
  res.writeHead(200, { ...base, "content-type": "text/plain; charset=utf-8", ...(dl ? { "content-disposition": `attachment; filename="${fname}.txt"` } : {}) }); res.end(txt);
}

async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  const ck = cookies(req), me = svc.session(ck.tessera_s);
  const needAuth = () => { if (!me) throw new UserError("sign in with your wallet first", 401); return me; };
  // state-changing calls from the browser must carry this header (blocks cross-site form posts; there is no CORS)
  if (m === "POST" && !p.startsWith("/api/agent/") && req.headers["x-tessera"] !== "1") throw new UserError("missing x-tessera header", 403);

  if (p === "/api/config" && m === "GET") return send(res, 200, { brand: CONFIG.brand, mock: CONFIG.mock, modes: svc.modes(), deposit: svc.depositInfo(), devFaucet: CONFIG.devFaucet, publicUrl: CONFIG.publicUrl, tools: TOOLS.map((t) => t.name) });
  if (p === "/api/auth/nonce" && m === "POST") { if (limited(req, "nonce", 30, 600_000)) throw new UserError("too many attempts, wait a few minutes", 429); const n = svc.nonce(); const b = await readBody(req); return send(res, 200, { nonce: n.nonce, message: svc.signInMessage(b.address || "", n.nonce) }); }
  if (p === "/api/auth/verify" && m === "POST") { if (limited(req, "verify", 30, 600_000)) throw new UserError("too many attempts", 429); const b = await readBody(req); const r = await svc.verify(b.address, b.nonce, b.signature); return send(res, 200, { address: r.address }, { "set-cookie": setCookie(r.token, 7 * 86400) }); }
  if (p === "/api/auth/logout" && m === "POST") { svc.logout(ck.tessera_s); return send(res, 200, { ok: true }, { "set-cookie": setCookie("", 0) }); }
  if (p === "/api/price" && m === "GET") { try { return send(res, 200, { ethUsd: await ethUsd() }); } catch (e) { throw new UserError(e.message, 503); } }
  if (p === "/api/me" && m === "GET") return send(res, 200, me ? svc.me(me) : { address: null });
  if (p === "/api/activity" && m === "GET") return send(res, 200, svc.activity(needAuth()));
  if (p === "/api/quote" && m === "POST") { const b = await readBody(req); return send(res, 200, svc.quote(b.mode, b.prompt)); }
  if (p === "/api/create" && m === "POST") { const a = needAuth(); if (limited(req, "create", 20, 600_000)) throw new UserError("slow down a little", 429); const b = await readBody(req); return send(res, 200, await svc.create(a, b.mode, b.prompt, "web")); }
  if (p.startsWith("/api/jobs/") && m === "GET") return send(res, 200, svc.job(needAuth(), p.slice(10)));
  if (p === "/api/outputs" && m === "GET") return send(res, 200, svc.outputs(needAuth(), Number(url.searchParams.get("limit")) || 60));
  if (p.startsWith("/api/outputs/") && m === "GET") return send(res, 200, svc.output(needAuth(), p.slice(13)));
  if (p === "/api/deposits/claim" && m === "POST") { const a = needAuth(); if (limited(req, "claim", 40, 600_000)) throw new UserError("too many checks, wait a minute", 429); const b = await readBody(req); return send(res, 200, await svc.claimDeposit(a, b.tx)); }
  if (p === "/api/keys" && m === "GET") return send(res, 200, svc.keys(needAuth()));
  if (p === "/api/keys" && m === "POST") { const a = needAuth(); const b = await readBody(req); return send(res, 200, svc.createKey(a, b)); }
  if (p.startsWith("/api/keys/") && p.endsWith("/revoke") && m === "POST") return send(res, 200, svc.revokeKey(needAuth(), p.split("/")[3]));
  if (p === "/api/dev/credit" && m === "POST") { if (!CONFIG.devFaucet) throw new UserError("not found", 404); const a = needAuth(); ledger.credit(a, 500 * MC_PER_CREDIT, "dev", "faucet"); return send(res, 200, svc.me(a)); }
  // agents: REST with a Bearer key
  if (p.startsWith("/api/agent/") && m === "POST") {
    const key = svc.keyAuth((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    if (!key) throw new UserError("invalid or revoked API key", 401);
    if (limited(req, "agent", 60, 600_000)) throw new UserError("rate limited", 429);
    return send(res, 200, await callTool(svc, key, p.slice(11), await readBody(req)));
  }
  throw new UserError("not found", 404);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/mcp") {
      if (req.method !== "POST") return send(res, 405, { error: "POST only (stateless streamable HTTP)" }, { allow: "POST" });
      const key = svc.keyAuth((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
      if (!key) return send(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "invalid or revoked API key" }, id: null });
      if (limited(req, "mcp", 120, 600_000)) return send(res, 429, { jsonrpc: "2.0", error: { code: -32002, message: "rate limited" }, id: null });
      return await handleMcp(svc, key, req, res, await readBody(req, 256 * 1024));
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (url.pathname.startsWith("/v/")) return servePreview(req, res, url.pathname.slice(3), url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method not allowed" });
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    const status = e instanceof UserError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? "server error" : e.message, code: e.code });
  }
});
server.listen(CONFIG.port, CONFIG.host, () => console.log(`${CONFIG.brand} on http://${CONFIG.host}:${CONFIG.port}${CONFIG.mock ? "  (MOCK mode: no Claude key, outputs are samples)" : ""}${CONFIG.treasury ? "" : "  (deposits closed: set KILN_TREASURY)"}`));
