// Every setting in one place. Values come from .env (see .env.example); the defaults are safe for local work.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// tiny .env loader (no dependency): KEY=value lines, # comments
const envFile = ROOT + ".env";
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const E = process.env;
const num = (v, d) => (v === undefined || v === "" ? d : Number(v));

export const CONFIG = {
  root: ROOT,
  brand: E.KILN_BRAND || "Molten",
  port: num(E.PORT, 6700),
  host: E.HOST || "127.0.0.1",
  publicUrl: E.PUBLIC_URL || "http://127.0.0.1:6700",
  dbFile: E.KILN_DB || ROOT + "data/kiln.db",
  secureCookies: (E.PUBLIC_URL || "").startsWith("https://"),

  // Claude. Without a key the server runs in MOCK mode: canned outputs, fake usage, nothing is billed by Anthropic.
  anthropicKey: E.ANTHROPIC_API_KEY || "",
  get mock() { return !this.anthropicKey || E.KILN_MOCK === "1"; },

  // money: 1 credit = $0.01. Balances are stored in millicredits (1/1000 credit) so settlement is exact.
  usdPerCredit: 0.01,
  markup: num(E.KILN_MARKUP, 0.3),            // 30% on top of the Claude cost
  minCharge: num(E.KILN_MIN_CHARGE, 1),       // credits per finished job, at least
  welcomeCredits: num(E.KILN_WELCOME, 0),     // free credits for a new wallet (0 = off)

  // Robinhood Chain mainnet
  chainId: 4663,
  rpc: E.KILN_RPC || "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  treasury: (E.KILN_TREASURY || "").toLowerCase(),   // where users send ETH
  confirmations: num(E.KILN_CONFIRMATIONS, 3),
  depositCapUsd: num(E.KILN_DEPOSIT_CAP_USD, 50),    // per wallet, lifetime, during the pilot
  minDepositUsd: num(E.KILN_MIN_DEPOSIT_USD, 1),

  // limits
  jobsPerDayPerAccount: num(E.KILN_JOBS_PER_DAY, 40),
  jobsPerDayTotal: num(E.KILN_JOBS_PER_DAY_TOTAL, 400),
  dailyBudgetUsd: num(E.KILN_DAILY_BUDGET_USD, 20),     // max Claude spend per rolling 24h, all users together (0 = off)
  promptMaxChars: 4000,
  devFaucet: E.KILN_DEV_FAUCET === "1",               // local testing only: /api/dev/credit
};

// Claude prices per million tokens (from the Claude API docs, Nov 2026)
export const MODELS = {
  "claude-opus-5-5": { in: 4, out: 20, label: "Claude Opus 5.5" },
  "claude-sonnet-5-5": { in: 2, out: 10, label: "Claude Sonnet 5.5" },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, label: "Claude Haiku 5.5" },
};
