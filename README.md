# Molten

Make anything, in one prompt. Claude makes a website, three logo concepts, a looping animation or a set of X posts.
Users pay per use with credits bought in ETH on Robinhood Chain; agents use the same credits over MCP or REST, within caps.

## How it works

1. **Sign in** with a wallet (signed message, no transaction). Session cookie, 7 days.
2. **Top up**: send ETH on Robinhood Chain (chain id 4663) to `KILN_TREASURY` from the same wallet, then the tx hash is checked on chain
   (recipient, sender, success, 3 confirmations) and converted to credits at the live ETH price. Each tx credits once. Pilot cap $50 per wallet.
3. **Quote**: the worst case for the job (estimated input + all max output tokens) at Claude's list price + 30%.
4. **Hold → make → settle**: the quote is held, Claude runs, the real usage is charged (never more than the hold), the rest is released.
   Errors on our side charge nothing; a refusal or unreadable answer charges at most 1 credit.
5. **Output** saved to the wallet's gallery. HTML runs in an opaque-origin sandbox (CSP `sandbox allow-scripts`), SVGs are stripped of scripts and links.

1 credit = $0.01. Balances are integer millicredits; every change is a ledger row written in the same SQLite transaction.

| mode | model | max output |
| --- | --- | --- |
| website | Claude Opus 5.5 | 24,000 |
| logo | Claude Sonnet 5.5 | 10,000 |
| motion | Claude Opus 5.5 | 16,000 |
| xpost | Claude Sonnet 5.5 | 6,000 |

## Agents

Keys (`molten_…`, shown once, stored as SHA-256) carry a mode allow-list, a per-job cap, a daily cap and an expiry.
Tools: get_balance, list_modes, quote, create, get_job, list_outputs, get_output.

- MCP (streamable HTTP, stateless): `POST /mcp` with `Authorization: Bearer molten_…`
- REST: `POST /api/agent/<tool>` with the same header and a JSON body

## Run

```
npm install
cp .env.example .env      # fill in; without ANTHROPIC_API_KEY it runs in MOCK mode (sample outputs, nothing billed)
npm test                  # ledger, pricing, keys, sign-in
npm start                 # http://127.0.0.1:6700
```

Local UI test: `KILN_DEV_FAUCET=1 KILN_TREASURY= node src/server.js` (deposits stay closed, the dev faucet adds test credits),
then `node test/e2e-ui.cjs <outdir>`. Never run the faucet on a public server; the deploy script refuses to.

## Safety limits

- `KILN_DAILY_BUDGET_USD` (default 20): the most Claude may cost in any rolling 24 hours, all users together. Before a job starts,
  the server adds what jobs already cost, the worst case of the jobs still running and the worst case of the new one; past the
  budget the job is refused and nothing is held. Also set a monthly limit on the key in the Anthropic console.
- Per-wallet and studio-wide job counts per day, two running jobs per wallet, prompts up to 4,000 characters, a $50 pilot deposit cap.

## Operations

```
npm run costs [days]      # per day: jobs, tokens, Claude cost, charged, margin, deposits
npm run backup            # consistent copy to data/backups/molten-YYYY-MM-DD.db (VACUUM INTO), keeps 14
```

On the server a systemd timer runs the backup every night.

## Landing samples

`web/showcase/` holds one real run per mode (made by this engine with Claude). The landing replays them step by step;
the HTML samples are served with the same sandbox CSP as user previews.
