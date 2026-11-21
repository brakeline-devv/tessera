// Deposits: a user sends ETH to the treasury on Robinhood Chain, then gives us the tx hash. We read the chain and credit once.
import { CONFIG } from "./config.js";

async function rpc(method, params) {
  const r = await fetch(CONFIG.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

// ETH/USD: Coinbase, then CoinGecko; cached 60 s
let px = { v: 0, at: 0 };
export async function ethUsd() {
  if (Date.now() - px.at < 60_000 && px.v) return px.v;
  const tries = [
    async () => Number((await (await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: AbortSignal.timeout(8000) })).json()).data.amount),
    async () => Number((await (await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { signal: AbortSignal.timeout(8000) })).json()).ethereum.usd),
  ];
  for (const t of tries) { try { const v = await t(); if (v > 0) { px = { v, at: Date.now() }; return v; } } catch {} }
  if (px.v) return px.v;
  throw new Error("ETH price unavailable, try again in a minute");
}

// returns { ok, reason?, from, value(wei bigint), block, confirmations }
export async function checkDeposit(hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return { ok: false, reason: "not a transaction hash" };
  if (!CONFIG.treasury) return { ok: false, reason: "deposits are not open yet" };
  const [tx, rc, head] = await Promise.all([rpc("eth_getTransactionByHash", [hash]), rpc("eth_getTransactionReceipt", [hash]), rpc("eth_blockNumber", [])]);
  if (!tx) return { ok: false, reason: "transaction not found yet, wait a few seconds" };
  if (!rc) return { ok: false, pending: true, reason: "transaction is still pending" };
  if (rc.status !== "0x1") return { ok: false, reason: "transaction failed on chain" };
  if ((tx.to || "").toLowerCase() !== CONFIG.treasury) return { ok: false, reason: "this transaction was not sent to the deposit address" };
  if (Number(tx.chainId) && Number(tx.chainId) !== CONFIG.chainId) return { ok: false, reason: "wrong chain" };
  const block = Number(rc.blockNumber), confirmations = Number(head) - block + 1;
  if (confirmations < CONFIG.confirmations) return { ok: false, pending: true, reason: `waiting for confirmations (${confirmations}/${CONFIG.confirmations})` };
  return { ok: true, from: tx.from.toLowerCase(), value: BigInt(tx.value), block, confirmations };
}
