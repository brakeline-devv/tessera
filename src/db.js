// SQLite (built into Node) for accounts, the credit ledger, jobs, outputs, deposits and agent keys.
// Money is integer millicredits (mc): 1 credit = 1000 mc = $0.01. Every balance change writes a ledger row in the same transaction.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG } from "./config.js";

export function openDb(file = CONFIG.dbFile) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;
  CREATE TABLE IF NOT EXISTS accounts (address TEXT PRIMARY KEY, created_at INTEGER NOT NULL,
    paid_mc INTEGER NOT NULL DEFAULT 0, reserved_mc INTEGER NOT NULL DEFAULT 0, deposited_usd REAL NOT NULL DEFAULT 0,
    CHECK (paid_mc >= 0), CHECK (reserved_mc >= 0), CHECK (reserved_mc <= paid_mc));
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, address TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, address TEXT NOT NULL, kind TEXT NOT NULL,
    amount_mc INTEGER NOT NULL, ref TEXT, paid_after INTEGER NOT NULL, reserved_after INTEGER NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS deposits (tx TEXT PRIMARY KEY, address TEXT NOT NULL, wei TEXT NOT NULL, eth_usd REAL NOT NULL, usd REAL NOT NULL,
    credited_mc INTEGER NOT NULL, block INTEGER NOT NULL, over_cap INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, address TEXT NOT NULL, via TEXT NOT NULL, mode TEXT NOT NULL, prompt TEXT NOT NULL,
    model TEXT NOT NULL, status TEXT NOT NULL, max_mc INTEGER NOT NULL, charged_mc INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
    error TEXT, output_id TEXT, mock INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, finished_at INTEGER);
  CREATE INDEX IF NOT EXISTS jobs_addr ON jobs(address, created_at);
  CREATE TABLE IF NOT EXISTS outputs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, address TEXT NOT NULL, mode TEXT NOT NULL,
    kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS outputs_addr ON outputs(address, created_at);
  CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, address TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
    modes TEXT NOT NULL, per_job_cap_mc INTEGER NOT NULL, daily_cap_mc INTEGER NOT NULL, expires_at INTEGER, revoked_at INTEGER,
    created_at INTEGER NOT NULL, last_used INTEGER);`);
  return db;
}

export const now = () => Date.now();

export function makeLedger(db) {
  const tx = (fn) => { db.exec("BEGIN IMMEDIATE"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  const getAcct = db.prepare("SELECT * FROM accounts WHERE address = ?");
  const insAcct = db.prepare("INSERT OR IGNORE INTO accounts (address, created_at) VALUES (?, ?)");
  const setBal = db.prepare("UPDATE accounts SET paid_mc = ?, reserved_mc = ? WHERE address = ?");
  const addLedger = db.prepare("INSERT INTO ledger (address, kind, amount_mc, ref, paid_after, reserved_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");

  const account = (address) => { insAcct.run(address, now()); return getAcct.get(address); };
  const write = (a, kind, amount, ref, paid, reserved) => { setBal.run(paid, reserved, a.address); addLedger.run(a.address, kind, amount, ref ?? null, paid, reserved, now()); return { paid_mc: paid, reserved_mc: reserved }; };

  return {
    tx, account,
    balance(address) { const a = account(address); return { paid_mc: a.paid_mc, reserved_mc: a.reserved_mc, available_mc: a.paid_mc - a.reserved_mc }; },
    // add money (deposit, welcome, dev faucet)
    credit(address, mc, kind, ref) { return tx(() => this.creditInTx(address, mc, kind, ref)); },
    // same, for a caller that already holds a transaction
    creditInTx(address, mc, kind, ref) {
      if (!(Number.isInteger(mc) && mc > 0)) throw new Error("credit must be a positive integer");
      const a = account(address); return write(a, kind, mc, ref, a.paid_mc + mc, a.reserved_mc);
    },
    // hold money for a job; throws when the available balance is too low
    reserve(address, mc, ref) {
      return tx(() => {
        const a = account(address);
        if (a.paid_mc - a.reserved_mc < mc) { const e = new Error("insufficient balance"); e.code = "BALANCE"; throw e; }
        return write(a, "reserve", mc, ref, a.paid_mc, a.reserved_mc + mc);
      });
    },
    // finish a job: release the hold, take the real charge (never more than the hold)
    settle(address, heldMc, chargeMc, ref) {
      return tx(() => {
        const a = account(address);
        const charge = Math.min(heldMc, Math.max(0, chargeMc));
        if (a.reserved_mc < heldMc) throw new Error("ledger: reserved below hold");
        const r = write(a, "release", heldMc, ref, a.paid_mc, a.reserved_mc - heldMc);
        if (charge > 0) return write(getAcct.get(address), "charge", -charge, ref, r.paid_mc - charge, r.reserved_mc);
        return r;
      });
    },
  };
}
