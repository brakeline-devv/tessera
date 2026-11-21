// The business rules shared by the website API and the agent tools: auth, deposits, quotes, jobs, outputs, agent keys.
import { randomBytes, createHash } from "node:crypto";
import { verifyMessage, getAddress } from "viem";
import { CONFIG, MODELS } from "./config.js";
import { now } from "./db.js";
import { MODES, runClaude, parseOutput } from "./generate.js";
import { quote as priceQuote, settleFromUsage, MC_PER_CREDIT, toCredits } from "./pricing.js";
import { checkDeposit, ethUsd } from "./chain.js";

const id = (p, n = 12) => p + randomBytes(n).toString("base64url");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const DAY = 86_400_000;
export class UserError extends Error { constructor(msg, status = 400, code) { super(msg); this.status = status; this.code = code; } }

export function makeService(db, ledger) {
  const q = (sql) => db.prepare(sql);
  const S = {
    nonceIns: q("INSERT INTO nonces (nonce, expires) VALUES (?, ?)"), nonceGet: q("SELECT * FROM nonces WHERE nonce = ?"), nonceUse: q("UPDATE nonces SET used = 1 WHERE nonce = ? AND used = 0"),
    sessIns: q("INSERT INTO sessions (token, address, expires) VALUES (?, ?, ?)"), sessGet: q("SELECT * FROM sessions WHERE token = ? AND expires > ?"), sessDel: q("DELETE FROM sessions WHERE token = ?"),
    depGet: q("SELECT * FROM deposits WHERE tx = ?"), depIns: q("INSERT INTO deposits (tx, address, wei, eth_usd, usd, credited_mc, block, over_cap, created_at) VALUES (?,?,?,?,?,?,?,?,?)"),
    depAdd: q("UPDATE accounts SET deposited_usd = deposited_usd + ? WHERE address = ?"),
    jobIns: q("INSERT INTO jobs (id, address, via, mode, prompt, model, status, max_mc, mock, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"),
    jobDone: q("UPDATE jobs SET status = ?, charged_mc = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?, error = ?, output_id = ?, finished_at = ? WHERE id = ?"),
    jobGet: q("SELECT * FROM jobs WHERE id = ? AND address = ?"),
    jobsToday: q("SELECT COUNT(*) n FROM jobs WHERE address = ? AND created_at > ?"), jobsTodayAll: q("SELECT COUNT(*) n FROM jobs WHERE created_at > ?"),
    claudeSpent: q("SELECT COALESCE(SUM(cost_usd), 0) usd FROM jobs WHERE created_at > ? AND mock = 0"),
    claudeRunning: q("SELECT COALESCE(SUM(max_mc), 0) mc FROM jobs WHERE status = 'running' AND mock = 0"),
    jobsRunning: q("SELECT COUNT(*) n FROM jobs WHERE address = ? AND status = 'running'"),
    outIns: q("INSERT INTO outputs (id, job_id, address, mode, kind, title, body, created_at) VALUES (?,?,?,?,?,?,?,?)"),
    outGet: q("SELECT * FROM outputs WHERE id = ?"),
    outList: q("SELECT id, job_id, mode, kind, title, created_at FROM outputs WHERE address = ? ORDER BY created_at DESC LIMIT ?"),
    jobList: q("SELECT id, via, mode, model, status, max_mc, charged_mc, input_tokens, output_tokens, cost_usd, error, output_id, mock, created_at, finished_at FROM jobs WHERE address = ? ORDER BY created_at DESC LIMIT ?"),
    ledgerList: q("SELECT kind, amount_mc, ref, paid_after, reserved_after, created_at FROM ledger WHERE address = ? ORDER BY id DESC LIMIT ?"),
    depList: q("SELECT tx, wei, eth_usd, usd, credited_mc, block, over_cap, created_at FROM deposits WHERE address = ? ORDER BY created_at DESC LIMIT 50"),
    keyIns: q("INSERT INTO api_keys (id, address, name, hash, prefix, modes, per_job_cap_mc, daily_cap_mc, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)"),
    keyByHash: q("SELECT * FROM api_keys WHERE hash = ?"), keyList: q("SELECT id, name, prefix, modes, per_job_cap_mc, daily_cap_mc, expires_at, revoked_at, created_at, last_used FROM api_keys WHERE address = ? ORDER BY created_at DESC"),
    keyRevoke: q("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND address = ? AND revoked_at IS NULL"), keyUsed: q("UPDATE api_keys SET last_used = ? WHERE id = ?"),
    keySpentToday: q("SELECT COALESCE(SUM(CASE WHEN status = 'running' THEN max_mc ELSE charged_mc END), 0) s FROM jobs WHERE via = ? AND created_at > ?"),
  };

  const svc = {
    // ---------- auth: sign-in with an Ethereum wallet ----------
    nonce() {
      const nonce = randomBytes(16).toString("hex");
      S.nonceIns.run(nonce, now() + 10 * 60_000);
      return { nonce, message: (address) => svc.signInMessage(address, nonce) };
    },
    signInMessage(address, nonce) {
      return `${CONFIG.brand} wants you to sign in with your wallet.\n\nAddress: ${address}\nChain: Robinhood Chain (${CONFIG.chainId})\nNonce: ${nonce}\n\nThis only proves you own the wallet. It costs nothing and sends no transaction.`;
    },
    async verify(address, nonce, signature) {
      let addr; try { addr = getAddress(address); } catch { throw new UserError("bad address"); }
      const n = S.nonceGet.get(String(nonce));
      if (!n || n.used || n.expires < now()) throw new UserError("sign-in expired, try again", 401);
      const ok = await verifyMessage({ address: addr, message: svc.signInMessage(addr, n.nonce), signature }).catch(() => false);
      if (!ok) throw new UserError("signature does not match the wallet", 401);
      if (S.nonceUse.run(n.nonce).changes !== 1) throw new UserError("sign-in already used", 401);
      const token = randomBytes(32).toString("base64url");
      S.sessIns.run(sha(token), addr.toLowerCase(), now() + 7 * DAY);
      const a = ledger.account(addr.toLowerCase());
      if (CONFIG.welcomeCredits > 0 && a.created_at > now() - 60_000 && a.paid_mc === 0) ledger.credit(a.address, CONFIG.welcomeCredits * MC_PER_CREDIT, "welcome", null);
      return { token, address: addr.toLowerCase() };
    },
    session(token) { if (!token) return null; const s = S.sessGet.get(sha(token), now()); return s ? s.address : null; },
    logout(token) { if (token) S.sessDel.run(sha(token)); },

    // ---------- account ----------
    me(address) {
      const b = ledger.balance(address);
      const a = ledger.account(address);
      return { address, credits: toCredits(b.available_mc), reserved: toCredits(b.reserved_mc), depositedUsd: a.deposited_usd, depositCapUsd: CONFIG.depositCapUsd };
    },
    activity(address) {
      return { ledger: S.ledgerList.all(address, 100).map((r) => ({ ...r, amount: toCredits(r.amount_mc) })), deposits: S.depList.all(address).map((d) => ({ ...d, credits: toCredits(d.credited_mc) })), jobs: S.jobList.all(address, 100).map(jobView) };
    },

    // ---------- deposits ----------
    depositInfo() { return { treasury: CONFIG.treasury, chainId: CONFIG.chainId, rpc: CONFIG.rpc, explorer: CONFIG.explorer, confirmations: CONFIG.confirmations, capUsd: CONFIG.depositCapUsd, minUsd: CONFIG.minDepositUsd, usdPerCredit: CONFIG.usdPerCredit, open: !!CONFIG.treasury }; },
    async claimDeposit(address, hash) {
      hash = String(hash || "").toLowerCase();
      const seen = S.depGet.get(hash);
      if (seen) { if (seen.address !== address) throw new UserError("this deposit belongs to another wallet", 409); return { status: "credited", credits: toCredits(seen.credited_mc), already: true }; }
      const c = await checkDeposit(hash);
      if (!c.ok) return { status: c.pending ? "pending" : "rejected", reason: c.reason };
      if (c.from !== address) throw new UserError("sent from a different wallet than the one signed in", 403);
      const price = await ethUsd();
      const usd = Number(c.value) / 1e18 * price;
      if (usd < CONFIG.minDepositUsd) return { status: "rejected", reason: `below the $${CONFIG.minDepositUsd} minimum` };
      const mc = Math.floor((usd / CONFIG.usdPerCredit) * MC_PER_CREDIT);
      const acct = ledger.account(address);
      const overCap = acct.deposited_usd + usd > CONFIG.depositCapUsd ? 1 : 0;
      // record the deposit and add the credits in one transaction: both happen or neither
      ledger.tx(() => {
        if (S.depGet.get(hash)) throw new UserError("already credited", 409);
        S.depIns.run(hash, address, c.value.toString(), price, usd, mc, c.block, overCap, now());
        S.depAdd.run(usd, address);
        ledger.creditInTx(address, mc, "deposit", hash);
      });
      return { status: "credited", credits: toCredits(mc), usd: Math.round(usd * 100) / 100, ethUsd: price, overCap: !!overCap };
    },

    // ---------- studio ----------
    modes() { return Object.entries(MODES).map(([k, m]) => ({ id: k, label: m.label, kind: m.kind, model: m.model, modelLabel: MODELS[m.model].label, maxTokens: m.maxTokens })); },
    quote(mode, prompt) {
      const m = MODES[mode]; if (!m) throw new UserError("unknown mode");
      prompt = String(prompt || "").trim();
      if (prompt.length < 4) throw new UserError("write a longer prompt");
      if (prompt.length > CONFIG.promptMaxChars) throw new UserError(`prompt is over ${CONFIG.promptMaxChars} characters`);
      const p = priceQuote(m.model, m.system.length, prompt.length, m.maxTokens);
      return { mode, model: m.model, maxCredits: toCredits(p.maxMc), maxMc: p.maxMc, note: "You pay the real usage, at most this. Unused credits go back to your balance." };
    },
    // run one job end to end: limits, hold, Claude, settle, store output. via = "web" or "key:<id>"
    async create(address, mode, prompt, via = "web", policy = null) {
      const qt = svc.quote(mode, prompt);
      const since = now() - DAY;
      if (S.jobsTodayAll.get(since).n >= CONFIG.jobsPerDayTotal) throw new UserError("the studio is at today's capacity, try again later", 429);
      if (S.jobsToday.get(address, since).n >= CONFIG.jobsPerDayPerAccount) throw new UserError(`daily limit of ${CONFIG.jobsPerDayPerAccount} jobs reached`, 429);
      // hard ceiling on what the Anthropic key can spend in 24h: what jobs used, plus the worst case of the ones running and this one
      if (!CONFIG.mock && CONFIG.dailyBudgetUsd > 0) {
        const worstUsd = (mc) => (mc / MC_PER_CREDIT) * CONFIG.usdPerCredit / (1 + CONFIG.markup);
        const exposure = S.claudeSpent.get(since).usd + worstUsd(S.claudeRunning.get().mc + qt.maxMc);
        if (exposure > CONFIG.dailyBudgetUsd) { console.warn(`[budget] refused a ${mode} job: 24h exposure $${exposure.toFixed(2)} > $${CONFIG.dailyBudgetUsd}`); throw new UserError("the studio is at today's capacity, try again later", 429); }
      }
      if (S.jobsRunning.get(address).n >= 2) throw new UserError("two jobs are already running, wait for one to finish", 429);
      if (policy) {
        if (!policy.modes.includes(mode)) throw new UserError(`this key may not use mode ${mode}`, 403);
        if (qt.maxMc > policy.per_job_cap_mc) throw new UserError(`job could cost up to ${qt.maxCredits} credits, over this key's per-job cap`, 403);
        const spent = S.keySpentToday.get(via, since).s;
        if (spent + qt.maxMc > policy.daily_cap_mc) throw new UserError("this key's daily cap would be exceeded", 403);
      }
      const jobId = id("job_");
      try { ledger.reserve(address, qt.maxMc, jobId); } catch (e) { if (e.code === "BALANCE") throw new UserError(`not enough credits: this job needs up to ${qt.maxCredits}`, 402, "BALANCE"); throw e; }
      S.jobIns.run(jobId, address, via, mode, String(prompt).trim(), qt.model, "running", qt.maxMc, CONFIG.mock ? 1 : 0, now());
      let r;
      try { r = await runClaude(mode, String(prompt).trim()); }
      catch (e) {
        // the provider may or may not have done the work; the user is never charged for an error on our side
        ledger.settle(address, qt.maxMc, 0, jobId);
        S.jobDone.run("failed", 0, 0, 0, 0, String(e.message || e).slice(0, 300), null, now(), jobId);
        throw new UserError("generation failed, nothing was charged: " + String(e.message || e).slice(0, 160), 502);
      }
      const cost = settleFromUsage(r.model, r.usage);
      let out = null, err = null, status = "done";
      if (r.stopReason === "refusal") { status = "refused"; err = "Claude declined this request"; }
      else { try { out = parseOutput(mode, r.text); } catch (e) { status = "failed"; err = "the answer could not be read: " + e.message; } }
      // refused or unreadable answers: charge only the minimum the provider billed us, capped by the hold
      const charge = status === "done" ? cost.mc : Math.min(cost.mc, MC_PER_CREDIT);
      const outId = out ? id("out_", 16) : null;
      if (out) S.outIns.run(outId, jobId, address, mode, MODES[mode].kind, out.title, out.body, now());
      ledger.settle(address, qt.maxMc, charge, jobId);
      S.jobDone.run(status, Math.min(charge, qt.maxMc), r.usage.input_tokens || 0, r.usage.output_tokens || 0, cost.usd, err, outId, now(), jobId);
      if (status !== "done") throw new UserError(err + `. Charged ${toCredits(Math.min(charge, qt.maxMc))} credits.`, 422);
      return { job: jobView(S.jobGet.get(jobId, address)), output: outputView(S.outGet.get(outId)), truncated: r.stopReason === "max_tokens" };
    },
    job(address, jobId) { const j = S.jobGet.get(String(jobId), address); if (!j) throw new UserError("job not found", 404); return jobView(j); },
    outputs(address, limit = 60) { return S.outList.all(address, Math.min(200, limit)); },
    output(address, outId) { const o = S.outGet.get(String(outId)); if (!o || o.address !== address) throw new UserError("output not found", 404); return outputView(o); },
    // public read for the sandboxed preview: the id itself is the secret (128-bit random)
    outputRaw(outId) { return S.outGet.get(String(outId)); },

    // ---------- agent keys ----------
    createKey(address, { name, modes, perJobCap, dailyCap, days }) {
      const ms = (Array.isArray(modes) && modes.length ? modes : Object.keys(MODES)).filter((m) => MODES[m]);
      const per = Math.max(1, Math.min(500, Number(perJobCap) || 100)), daily = Math.max(per, Math.min(5000, Number(dailyCap) || 300));
      const secret = "molten_" + randomBytes(24).toString("base64url");
      const keyId = id("key_", 8);
      const exp = Number(days) > 0 ? now() + Math.min(365, Number(days)) * DAY : null;
      S.keyIns.run(keyId, address, String(name || "agent").slice(0, 40), sha(secret), secret.slice(0, 11), ms.join(","), per * MC_PER_CREDIT, daily * MC_PER_CREDIT, exp, now());
      return { id: keyId, secret, note: "Shown once. Store it now; only a hash is kept." };
    },
    keys(address) { return S.keyList.all(address).map((k) => ({ ...k, modes: k.modes.split(","), perJobCap: toCredits(k.per_job_cap_mc), dailyCap: toCredits(k.daily_cap_mc) })); },
    revokeKey(address, keyId) { if (S.keyRevoke.run(now(), String(keyId), address).changes !== 1) throw new UserError("key not found or already revoked", 404); return { revoked: true }; },
    keyAuth(secret) {
      if (!secret || !String(secret).startsWith("molten_")) return null;
      const k = S.keyByHash.get(sha(String(secret)));
      if (!k || k.revoked_at || (k.expires_at && k.expires_at < now())) return null;
      S.keyUsed.run(now(), k.id);
      return { ...k, modes: k.modes.split(","), via: "key:" + k.id };
    },
  };
  return svc;
}

function jobView(j) {
  if (!j) return null;
  return { id: j.id, via: j.via, mode: j.mode, model: j.model, status: j.status, maxCredits: toCredits(j.max_mc), charged: toCredits(j.charged_mc),
    inputTokens: j.input_tokens, outputTokens: j.output_tokens, costUsd: Math.round(j.cost_usd * 1e5) / 1e5, error: j.error, outputId: j.output_id, mock: !!j.mock, createdAt: j.created_at, finishedAt: j.finished_at };
}
function outputView(o) {
  if (!o) return null;
  const body = o.kind === "html" ? undefined : JSON.parse(o.body);
  return { id: o.id, jobId: o.job_id, mode: o.mode, kind: o.kind, title: o.title, createdAt: o.created_at, previewUrl: o.kind === "html" ? `/v/${o.id}` : undefined, downloadUrl: `/v/${o.id}?download=1`, data: body };
}
