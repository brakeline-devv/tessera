// One real, cheap job (xpost on Sonnet) against the local server with the real key: proves the Claude call, usage and settlement.
const { privateKeyToAccount } = require("viem/accounts");
const BASE = "http://127.0.0.1:6700", acct = privateKeyToAccount("0x" + "33".repeat(32));
(async () => {
  const H = { "content-type": "application/json", "x-molten": "1" };
  const n = await (await fetch(BASE + "/api/auth/nonce", { method: "POST", headers: H, body: JSON.stringify({ address: acct.address }) })).json();
  const v = await fetch(BASE + "/api/auth/verify", { method: "POST", headers: H, body: JSON.stringify({ address: acct.address, nonce: n.nonce, signature: await acct.signMessage({ message: n.message }) }) });
  const cookie = v.headers.get("set-cookie").split(";")[0], C = { ...H, cookie };
  await fetch(BASE + "/api/dev/credit", { method: "POST", headers: C });
  const cfg = await (await fetch(BASE + "/api/config")).json(); console.log("mock:", cfg.mock);
  const t0 = Date.now();
  const r = await (await fetch(BASE + "/api/create", { method: "POST", headers: C, body: JSON.stringify({ mode: process.argv[2] || "xpost", prompt: process.argv[3] || "Launch thread for Embargo, an open-source MCP server that checks every buy and sell against the IRS 30-day wash-sale rule before an AI agent places it. Read-only, never trades. Site embargomcp.trade." }) })).json();
  if (r.error) return console.log("ERROR", r.error);
  console.log(JSON.stringify({ secs: ((Date.now() - t0) / 1000).toFixed(1), status: r.job.status, model: r.job.model, in: r.job.inputTokens, out: r.job.outputTokens, costUsd: r.job.costUsd, held: r.job.maxCredits, charged: r.job.charged, truncated: r.truncated }));
  console.log(JSON.stringify(r.output.data || r.output.previewUrl, null, 1).slice(0, 1500));
})();
