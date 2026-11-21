// What Claude cost per day versus what users were charged. npm run costs [days]
import { DatabaseSync } from "node:sqlite";
import { CONFIG } from "../src/config.js";

const days = Number(process.argv[2] || 14);
const since = Date.now() - days * 86400_000;
const db = new DatabaseSync(CONFIG.dbFile, { readOnly: true });
const rows = db.prepare(`SELECT date(created_at / 1000, 'unixepoch') day, COUNT(*) jobs,
    SUM(status = 'done') ok, SUM(status NOT IN ('done', 'running')) bad,
    SUM(input_tokens) tin, SUM(output_tokens) tout, SUM(cost_usd) cost, SUM(charged_mc) mc
  FROM jobs WHERE mock = 0 AND created_at > ? GROUP BY day ORDER BY day DESC`).all(since);
const depCols = db.prepare("PRAGMA table_info(deposits)").all().map((c) => c.name);
const depBy = {};
if (depCols.includes("usd")) for (const d of db.prepare(`SELECT date(created_at / 1000, 'unixepoch') day, SUM(usd) usd FROM deposits WHERE created_at > ? GROUP BY day`).all(since)) depBy[d.day] = d.usd || 0;
const usd = (mc) => (mc / 1000) * CONFIG.usdPerCredit;
const pad = (s, n) => String(s ?? 0).padStart(n);
console.log(`budget: $${CONFIG.dailyBudgetUsd} per 24h · db ${CONFIG.dbFile}\n`);
console.log("day          jobs  ok  bad   tokens in /   out     claude $  charged $  margin $  deposits $");
const T = { cost: 0, ch: 0, dep: 0 };
for (const r of rows) {
  const cost = r.cost || 0, ch = usd(r.mc || 0), dep = depBy[r.day] || 0;
  T.cost += cost; T.ch += ch; T.dep += dep;
  console.log(`${r.day}  ${pad(r.jobs, 5)} ${pad(r.ok, 3)} ${pad(r.bad, 4)}   ${pad(r.tin, 9)} / ${pad(r.tout, 7)}   ${pad(cost.toFixed(3), 8)}  ${pad(ch.toFixed(3), 9)}  ${pad((ch - cost).toFixed(3), 8)}  ${pad(dep.toFixed(2), 10)}`);
}
if (!rows.length) console.log("(no real jobs in this window)");
console.log(`\ntotal ${days}d: Claude $${T.cost.toFixed(2)} · charged $${T.ch.toFixed(2)} · margin $${(T.ch - T.cost).toFixed(2)} · deposits $${T.dep.toFixed(2)}`);
