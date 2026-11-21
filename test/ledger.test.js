// Money paths: holds, settlement, refunds on failure, limits, keys. Runs in MOCK mode against an in-memory database.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.ANTHROPIC_API_KEY = "";
const { CONFIG } = await import("../src/config.js");
const { openDb, makeLedger } = await import("../src/db.js");
const { makeService } = await import("../src/service.js");
const { chargeMc, usdCost, quote } = await import("../src/pricing.js");
const { cleanSvg, parseOutput } = await import("../src/generate.js");

const fresh = () => { const db = openDb(":memory:"); const l = makeLedger(db); return { db, l, svc: makeService(db, l) }; };
const A = "0x" + "a".repeat(40), B = "0x" + "b".repeat(40);

test("pricing: Claude list prices, 30% markup, rounded up, 1 credit minimum", () => {
  assert.equal(usdCost("claude-opus-5-5", 1_000_000, 0), 4);
  assert.equal(usdCost("claude-sonnet-5-5", 0, 1_000_000), 10);
  assert.equal(chargeMc(0.1), Math.ceil(0.1 * 1.3 / 0.01 * 1000));      // 13 credits
  assert.equal(chargeMc(0.000001), 1000);                                // minimum 1 credit
  const q = quote("claude-opus-5-5", 1000, 200, 24000);
  assert.ok(q.maxUsd > 0.48 && q.maxMc > 62000);                        // 24k output tokens of Opus ≈ $0.48 + input
});

test("ledger: reserve cannot exceed available, settle charges at most the hold", () => {
  const { l } = fresh();
  l.credit(A, 10_000, "dev", "t");
  assert.throws(() => l.reserve(A, 10_001, "j1"), /insufficient/);
  l.reserve(A, 6000, "j1");
  assert.throws(() => l.reserve(A, 5000, "j2"), /insufficient/);          // only 4000 left
  l.settle(A, 6000, 9999, "j1");                                          // charge capped at hold
  assert.deepEqual(l.balance(A), { paid_mc: 4000, reserved_mc: 0, available_mc: 4000 });
  l.reserve(A, 4000, "j3"); l.settle(A, 4000, 1500, "j3");
  assert.equal(l.balance(A).available_mc, 2500);
});

test("job in mock mode: hold, settle to usage, output stored, balance consistent", async () => {
  const { l, svc } = fresh();
  l.credit(A, 200_000, "dev", "t");                                       // 200 credits
  const r = await svc.create(A, "logo", "a logo for a coffee shop called Ember");
  assert.equal(r.job.status, "done");
  assert.ok(r.job.charged > 0 && r.job.charged <= r.job.maxCredits);
  assert.equal(r.output.data.length, 3);
  const b = l.balance(A);
  assert.equal(b.reserved_mc, 0);
  assert.equal(b.paid_mc, 200_000 - Math.round(r.job.charged * 1000));
  assert.equal(svc.output(A, r.output.id).id, r.output.id);
  assert.throws(() => svc.output(B, r.output.id), /not found/);          // other wallets can't read it
});

test("not enough credits: nothing is held or charged", async () => {
  const { l, svc } = fresh();
  l.credit(A, 1000, "dev", "t");
  await assert.rejects(svc.create(A, "website", "landing page for a bakery"), /not enough credits/);
  assert.deepEqual(l.balance(A), { paid_mc: 1000, reserved_mc: 0, available_mc: 1000 });
});

test("provider error: the hold is released in full", async () => {
  const { l, svc } = fresh();
  l.credit(A, 200_000, "dev", "t");
  const gen = await import("../src/generate.js");
  const orig = gen.MODES.logo.maxTokens;
  // force a failure by asking for an unknown model through a broken mode copy
  gen.MODES.broken = { ...gen.MODES.logo, model: "claude-sonnet-5-5" };
  CONFIG.anthropicKey = "sk-test-invalid"; process.env.KILN_MOCK = "0";
  try { await assert.rejects(svc.create(A, "logo", "a logo that will fail"), /nothing was charged/); }
  finally { CONFIG.anthropicKey = ""; delete gen.MODES.broken; gen.MODES.logo.maxTokens = orig; }
  assert.deepEqual(l.balance(A), { paid_mc: 200_000, reserved_mc: 0, available_mc: 200_000 });
});

test("agent key: mode allow-list, per-job cap and revoke", async () => {
  const { l, svc } = fresh();
  l.credit(A, 300_000, "dev", "t");
  const k = svc.createKey(A, { name: "bot", modes: ["logo", "xpost"], perJobCap: 20, dailyCap: 100 });
  const key = svc.keyAuth(k.secret);
  assert.ok(key && key.address === A);
  await assert.rejects(svc.create(A, "website", "a site", key.via, key), /may not use mode/);
  const ok = await svc.create(A, "xpost", "launch thread for a tea brand", key.via, key);
  assert.equal(ok.job.via, key.via);
  svc.revokeKey(A, k.id);
  assert.equal(svc.keyAuth(k.secret), null);
  assert.equal(svc.keyAuth("tessera_wrong"), null);
});

test("svg cleanup strips scripts, handlers and external refs", () => {
  const dirty = `<svg onload="x()"><script>alert(1)</script><a href="https://evil"><rect onclick="y()"/></a><image href="http://x/p.png"/><use href="#ok"/></svg>`;
  const c = cleanSvg(dirty);
  assert.ok(!/script|onload|onclick|evil|<image/i.test(c));
  assert.ok(c.includes('href="#ok"'));
  const p = parseOutput("xpost", '```json\n{"thread":["a"],"posts":["b"],"bio":"c"}\n```');
  assert.deepEqual(JSON.parse(p.body), { thread: ["a"], posts: ["b"], bio: "c" });
});

test("sign-in: nonce is single use and the signature must match", async () => {
  const { svc } = fresh();
  const { privateKeyToAccount } = await import("viem/accounts");
  const acct = privateKeyToAccount("0x" + "11".repeat(32));
  const n = svc.nonce();
  const sig = await acct.signMessage({ message: svc.signInMessage(acct.address, n.nonce) });
  const r = await svc.verify(acct.address, n.nonce, sig);
  assert.equal(r.address, acct.address.toLowerCase());
  assert.equal(svc.session(r.token), r.address);
  await assert.rejects(svc.verify(acct.address, n.nonce, sig), /expired|used/);
  const n2 = svc.nonce();
  await assert.rejects(svc.verify(B, n2.nonce, sig), /does not match/);
});
