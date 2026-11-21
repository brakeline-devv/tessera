// Daily database backup: a consistent copy via VACUUM INTO (safe while the server runs, WAL included).
// Keeps the last KEEP copies in data/backups. Run by the tessera-backup systemd timer on the VPS, or by hand: npm run backup
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, unlinkSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { CONFIG } from "../src/config.js";

const KEEP = Math.max(1, Number(process.env.KILN_BACKUP_KEEP || 14));
const dir = join(dirname(CONFIG.dbFile), "backups");
mkdirSync(dir, { recursive: true });
const day = new Date().toISOString().slice(0, 10);
const file = join(dir, `tessera-${day}.db`);
if (existsSync(file)) unlinkSync(file);                 // re-running the same day replaces that day's copy
const db = new DatabaseSync(CONFIG.dbFile);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
// prune: only files this script made (tessera-YYYY-MM-DD.db), oldest first, keeping the newest KEEP
const old = readdirSync(dir).filter((f) => /^tessera-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(KEEP);
for (const f of old) unlinkSync(join(dir, f));
console.log(`backup ${file} (${(statSync(file).size / 1024).toFixed(0)} KB), pruned ${old.length}`);
