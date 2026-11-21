// Tessera front-end: hash router, wallet sign-in, studio, gallery, credits, agent keys, docs. No framework, no bundler.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 2) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: d });
const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : new Date(t).toLocaleDateString(); };
const short = (a) => a ? a.slice(0, 6) + "…" + a.slice(-4) : "";

async function api(path, body, method) {
  const r = await fetch(path, { method: method || (body ? "POST" : "GET"), headers: body ? { "content-type": "application/json", "x-tessera": "1" } : { "x-tessera": "1" }, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.statusText); e.status = r.status; e.code = j.code; throw e; }
  return j;
}
function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = "toast on" + (bad ? " bad" : ""); clearTimeout(t._h); t._h = setTimeout(() => (t.className = "toast"), 4200); }

const ICON = {
  website: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/></svg>`,
  logo: `<svg viewBox="0 0 64 64"><path d="M32 8c1.2 11 4.8 16.4 22 24-17.2 7.6-20.8 13-22 24-1.2-11-4.8-16.4-22-24 17.2-7.6 20.8-13 22-24z" fill="currentColor"/></svg>`,
  motion: `<svg viewBox="0 0 64 64"><path d="M8 32c5-12 10-12 16 0s11 12 16 0 11-12 16 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>`,
  xpost: `<svg viewBox="0 0 64 64"><g stroke="currentColor" stroke-width="4.5" stroke-linecap="round">${Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6, c = Math.cos(a), n = Math.sin(a); return `<path d="M${32 + c * 8} ${32 + n * 8}L${32 + c * 22} ${32 + n * 22}"/>`; }).join("")}</g></svg>`,
};
const EXAMPLES = {
  website: ["Landing page for a night-only ramen bar in Jakarta, moody and warm", "One-page site for a crypto MCP server that checks wash sales", "Portfolio for a ceramic artist, lots of whitespace, serif type"],
  logo: ["Logo for 'Ember', a small-batch coffee roaster", "Mark for a Robinhood Chain AI agent called Vesta", "Monogram for 'North & Pine' outdoor gear"],
  motion: ["Slow aurora ribbons in teal and violet behind a hero", "Glowing particles forming a lattice that breathes, ember colours", "3D floating glass cubes catching orange light"],
  xpost: ["Launch thread for an open-source tool that checks wash sales for AI agents", "Hype-free posts for a coffee shop opening its second location", "Thread explaining a token buyback and burn, plain and factual"],
};

const S = { cfg: null, me: null, mode: "website", prompt: "", quote: null, result: null, busy: false };

/* ---------------- wallet ---------------- */
const eth = () => window.ethereum;
async function signIn() {
  if (!eth()) return toast("No wallet found. Install MetaMask or Rabby, then reload.", true);
  try {
    const [address] = await eth().request({ method: "eth_requestAccounts" });
    const n = await api("/api/auth/nonce", { address });
    const signature = await eth().request({ method: "personal_sign", params: [n.message, address] });
    await api("/api/auth/verify", { address, nonce: n.nonce, signature });
    await refreshMe(); toast("Signed in as " + short(address)); route();
  } catch (e) { toast(e.code === 4001 ? "Signature cancelled" : e.message, true); }
}
async function signOut() { await api("/api/auth/logout", {}); S.me = null; paintWho(); route(); }
async function refreshMe() { S.me = await api("/api/me").catch(() => ({ address: null })); if (!S.me.address) S.me = null; paintWho(); }
function paintWho() {
  const c = $("#connect"), b = $("#bal");
  if (S.me) { c.textContent = short(S.me.address); c.onclick = () => (confirm("Sign out?") ? signOut() : 0); b.hidden = false; $("#balN").textContent = fmt(S.me.credits); }
  else { c.textContent = "Connect wallet"; c.onclick = signIn; b.hidden = true; }
}
async function ensureChain() {
  const hex = "0x" + S.cfg.deposit.chainId.toString(16);
  try { await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
  catch (e) {
    if (e.code !== 4902) throw e;
    await eth().request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [S.cfg.deposit.rpc], blockExplorerUrls: [S.cfg.deposit.explorer] }] });
  }
}

/* ---------------- router ---------------- */
import { home as homeView, homeCleanup } from "./home.js?v=13";
const home = () => homeView(S);
const VIEWS = { home, studio, gallery, account, agents, docs, terms, privacy };
function route() {
  const [r, arg] = (location.hash.replace(/^#\/?/, "") || "home").split("/");
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.r === r));
  homeCleanup();
  $("#view").className = r === "home" || !VIEWS[r] ? "home" : "";
  $("#launch").hidden = r !== "home" && !!VIEWS[r];
  $("#appFoot").hidden = r === "home" || !VIEWS[r];
  (VIEWS[r] || home)(arg);
  window.scrollTo(0, 0);
}
addEventListener("hashchange", route);

/* ---------------- studio ---------------- */
function studio(outId) {
  const modes = S.cfg.modes;
  $("#view").innerHTML = `<div class="studio">
    <section class="card compose">
      <div class="modes" role="tablist">${modes.map((m) => `<button class="mode${m.id === S.mode ? " on" : ""}" data-m="${m.id}">${ICON[m.id]}${esc(m.label)}</button>`).join("")}</div>
      <div class="field"><label><span>Brief</span><span id="cnt">0 / 4000</span></label>
        <textarea id="prompt" maxlength="4000" placeholder="Describe what to make: who it's for, the feeling, colours, the words it should say."></textarea>
        <div class="chips" id="chips"></div></div>
      <div class="quote"><span id="qModel">—</span><span>up to <b id="qMax">—</b> credits</span></div>
      <button class="btn go" id="go">Make it</button>
      <p class="fine" id="fine">You pay the real usage, never more than the quote. Unused credits return to your balance right after.</p>
    </section>
    <section class="card stage"><div class="stage-bar" id="bar"><span class="t mono" style="color:var(--mute)">Output</span></div><div class="stage-body" id="out"></div><div id="rcpt"></div></section>
  </div>`;
  document.querySelectorAll(".mode").forEach((b) => b.onclick = () => { S.mode = b.dataset.m; S.quote = null; studio(); });
  const ta = $("#prompt"); ta.value = S.prompt;
  ta.oninput = () => { S.prompt = ta.value; $("#cnt").textContent = `${ta.value.length} / 4000`; requote(); };
  $("#chips").innerHTML = EXAMPLES[S.mode].map((x) => `<button class="chip">${esc(x)}</button>`).join("");
  $("#chips").querySelectorAll(".chip").forEach((c) => c.onclick = () => { ta.value = c.textContent; ta.oninput(); ta.focus(); });
  $("#go").onclick = make;
  ta.oninput();
  if (outId) loadOutput(outId); else if (S.result && S.result.output && S.result.output.mode === S.mode) showResult(S.result); else showEmpty();
}
let qTimer;
function requote() {
  const m = S.cfg.modes.find((x) => x.id === S.mode);
  $("#qModel").textContent = m.modelLabel;
  clearTimeout(qTimer);
  if (S.prompt.trim().length < 4) { $("#qMax").textContent = "—"; $("#go").disabled = true; return; }
  $("#go").disabled = S.busy;
  qTimer = setTimeout(async () => { try { S.quote = await api("/api/quote", { mode: S.mode, prompt: S.prompt }); $("#qMax").textContent = fmt(S.quote.maxCredits); } catch (e) { $("#qMax").textContent = "—"; } }, 250);
}
function showEmpty() {
  const m = S.cfg.modes.find((x) => x.id === S.mode);
  const copy = { website: ["A finished page, not a mockup", "One self-contained HTML file you can open, download and host anywhere."], logo: ["Three directions at once", "Vector SVG logos, shown on light and dark, ready to download."], motion: ["Something that moves", "A looping canvas or 3D scene for a hero background or a post."], xpost: ["Words for X", "A thread, six standalone posts and a bio, plain and specific."] }[S.mode];
  $("#out").innerHTML = `<div class="empty"><div class="ill">${ICON[S.mode]}</div><h3>${copy[0]}</h3><p>${copy[1]}</p><p class="fine mono">${esc(m.modelLabel)} · up to ${fmt(m.maxTokens, 0)} tokens</p></div>`;
  $("#bar").innerHTML = `<span class="t mono" style="color:var(--mute)">Output</span>`; $("#rcpt").innerHTML = "";
}
async function make() {
  if (!S.me) { toast("Connect your wallet to start"); return signIn(); }
  if (S.busy) return;
  S.busy = true; $("#go").disabled = true; $("#go").textContent = "Working…";
  const t0 = Date.now();
  $("#out").innerHTML = `<div class="working"><div class="crucible"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="mono" id="el" style="color:var(--sub)">0s</div>
    <div class="wsteps"><div class="ok">credits held</div><div class="on" id="s2">Claude is making it</div><div id="s3">settle to real usage</div></div>
    <p class="fine" style="margin-top:18px">${S.mode === "website" || S.mode === "motion" ? "Pages usually take one to three minutes." : "Usually under a minute."}</p></div>`;
  $("#rcpt").innerHTML = "";
  const tick = setInterval(() => { const e = $("#el"); if (e) e.textContent = Math.floor((Date.now() - t0) / 1000) + "s"; }, 500);
  try {
    const r = await api("/api/create", { mode: S.mode, prompt: S.prompt });
    S.result = r; showResult(r); await refreshMe();
    toast(`Done. Charged ${fmt(r.job.charged)} of ${fmt(r.job.maxCredits)} credits held.`);
  } catch (e) {
    showEmpty();
    toast(e.message, true);
    if (e.code === "BALANCE") setTimeout(() => (location.hash = "#/account"), 1200);
  } finally { clearInterval(tick); S.busy = false; const g = $("#go"); if (g) { g.textContent = "Make it"; g.disabled = false; } refreshMe(); }
}
async function loadOutput(id) {
  try { const o = await api("/api/outputs/" + id); S.mode = o.mode; showResult({ output: o, job: null }); document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("on", b.dataset.m === o.mode)); }
  catch (e) { toast(e.message, true); showEmpty(); }
}
function showResult(r) {
  const o = r.output;
  $("#bar").innerHTML = `<span class="t">${esc(o.title)}</span><span class="pill">${esc(o.mode)}</span>${r.truncated ? `<span class="pill hot">hit length limit</span>` : ""}<span class="sp">${o.previewUrl ? `<a class="btn ghost xs" href="${o.previewUrl}" target="_blank" rel="noopener">Open</a>` : ""}<a class="btn ghost xs" href="${o.downloadUrl}">Download</a></span>`;
  if (o.kind === "html") $("#out").innerHTML = `<iframe class="pv" src="${o.previewUrl}" sandbox="allow-scripts allow-pointer-lock" referrerpolicy="no-referrer" title="Preview"></iframe>`;
  else if (o.kind === "svg") $("#out").innerHTML = `<div class="logos">${o.data.map((_, i) => `<div class="logo-tile"><img src="/v/${o.id}?i=${i}" alt="Concept ${i + 1}"><div class="acts"><a class="btn ghost xs" href="/v/${o.id}?i=${i}&download=1">SVG</a></div></div>`).join("")}${o.data.map((_, i) => `<div class="logo-tile dark"><img src="/v/${o.id}?i=${i}" alt=""></div>`).join("")}</div>`;
  else {
    const d = o.data, post = (p, i, lab) => `<div class="xpost"><div class="n"><span>${lab}${i + 1} · ${p.length}/280</span><button data-c="${esc(p)}">copy</button></div>${esc(p)}</div>`;
    $("#out").innerHTML = `<div class="xout"><div class="xcol"><h4>Thread</h4>${d.thread.map((p, i) => post(p, i, "")).join("")}</div><div class="xcol"><h4>Posts</h4>${d.posts.map((p, i) => post(p, i, "#")).join("")}<h4 style="margin-top:16px">Bio</h4>${post(d.bio, 0, "bio ")}</div></div>`;
    $("#out").querySelectorAll("[data-c]").forEach((b) => b.onclick = async () => { await navigator.clipboard.writeText(b.dataset.c).catch(() => {}); b.textContent = "copied"; setTimeout(() => (b.textContent = "copy"), 1200); });
  }
  const j = r.job;
  $("#rcpt").innerHTML = j ? `<div class="receipt"><div><span>held</span><b>${fmt(j.maxCredits)}</b></div><div><span>charged</span><b style="color:var(--ember2)">${fmt(j.charged)}</b></div><div><span>returned</span><b style="color:var(--ok)">${fmt(j.maxCredits - j.charged)}</b></div><div><span>tokens in / out</span><b>${fmt(j.inputTokens, 0)} / ${fmt(j.outputTokens, 0)}</b></div></div>` : "";
}

/* ---------------- gallery ---------------- */
async function gallery() {
  $("#view").innerHTML = `<div class="page-head"><div class="h-eyebrow">Gallery</div><h1 class="h1">Everything you <em>made.</em></h1></div><div class="grid" id="g"></div>`;
  if (!S.me) return ($("#g").innerHTML = signInCard("Your outputs live on your wallet."));
  const list = await api("/api/outputs").catch(() => []);
  if (!list.length) return ($("#g").innerHTML = `<div class="card box" style="grid-column:1/-1"><h3>Nothing yet</h3><p class="lead">Make something in the studio and it shows up here.</p><a class="btn" href="#/studio" style="margin-top:16px">Open the studio</a></div>`);
  $("#g").innerHTML = list.map((o) => `<a class="card tile" href="#/studio/${o.id}"><div class="thumb">${o.kind === "html" ? `<iframe src="/v/${o.id}" sandbox="allow-scripts" loading="lazy" tabindex="-1" title=""></iframe>` : o.kind === "svg" ? `<img src="/v/${o.id}?i=0" alt="">` : `<div class="txt">${esc(o.title)}</div>`}</div><div class="meta"><b>${esc(o.title)}</b><span class="pill">${o.mode}</span></div></a>`).join("");
}
const signInCard = (why) => `<div class="card box" style="grid-column:1/-1"><h3>Connect your wallet</h3><p class="lead">${why} Signing in is free and sends no transaction.</p><button class="btn" style="margin-top:16px" data-signin>Connect wallet</button></div>`;

/* ---------------- credits ---------------- */
async function account() {
  const d = S.cfg.deposit;
  $("#view").innerHTML = `<div class="page-head"><div class="h-eyebrow">Credits</div><h1 class="h1">Pay in ETH. <em>Spend by the token.</em></h1><p class="lead">1 credit = $0.01. Top up with ETH on Robinhood Chain; each job holds its maximum, then charges only what Claude actually used.</p></div><div id="acc"></div>`;
  if (!S.me) return ($("#acc").innerHTML = `<div class="grid">${signInCard("Credits belong to your wallet.")}</div>`);
  await refreshMe();
  $("#acc").innerHTML = `<div class="two">
    <section class="card box"><div class="h-eyebrow">Balance</div><div class="big">${fmt(S.me.credits)} <small>credits</small></div>
      <p class="fine">${S.me.reserved ? fmt(S.me.reserved) + " held for a running job · " : ""}≈ $${fmt(S.me.credits * 0.01)}</p>
      ${S.cfg.devFaucet ? `<button class="btn ghost sm" id="faucet" style="margin-top:14px">Dev: add 500 test credits</button>` : ""}</section>
    <section class="card box"><h3>Top up</h3>
      ${d.open ? `<p class="fine" style="margin:8px 0 14px">Send ETH on <b>Robinhood Chain</b> from this wallet. Credited after ${d.confirmations} confirmations. Pilot cap: $${d.capUsd} per wallet in total.</p>
      <div class="row"><input type="number" id="usd" min="${d.minUsd}" step="1" value="5" style="width:120px"><span class="mono" style="color:var(--sub)">USD ≈ <b id="ethAmt" style="color:var(--ink)">…</b> ETH</span></div>
      <div class="row" style="margin-top:12px"><button class="btn" id="send">Send with wallet</button></div>
      <p class="fine" style="margin-top:18px">Or send manually to this address, then paste the transaction hash:</p>
      <div class="addr" style="margin-top:8px"><span style="flex:1">${esc(d.treasury)}</span><button class="btn ghost xs" id="cpAddr">Copy</button></div>
      <div class="row" style="margin-top:10px"><input type="text" id="txh" placeholder="0x… transaction hash" style="flex:1"><button class="btn ghost sm" id="claim">Check</button></div>
      <p class="fine" id="claimMsg"></p>` : `<p class="lead">Deposits open soon.</p>`}
    </section></div>
    <section class="card box" style="margin-top:18px"><h3>Activity</h3><div id="act" style="margin-top:14px"></div></section>`;
  if ($("#faucet")) $("#faucet").onclick = async () => { await api("/api/dev/credit", {}); toast("500 test credits added"); account(); };
  if (!d.open) return activity();
  let price = 0;
  const upd = () => { const v = Number($("#usd").value) || 0; $("#ethAmt").textContent = price ? (v / price).toFixed(6) : "…"; };
  api("/api/price").then((p) => { price = p.ethUsd; upd(); }).catch(() => ($("#ethAmt").textContent = "price unavailable"));
  $("#usd").oninput = upd;
  $("#cpAddr").onclick = () => navigator.clipboard.writeText(d.treasury).then(() => toast("Address copied"));
  $("#claim").onclick = () => claim($("#txh").value.trim());
  $("#send").onclick = async () => {
    if (!eth()) return toast("No wallet found", true);
    if (!price) return toast("ETH price unavailable, try again in a minute", true);
    const usd = Number($("#usd").value);
    if (!(usd >= d.minUsd)) return toast(`Minimum is $${d.minUsd}`, true);
    try {
      await ensureChain();
      const wei = BigInt(Math.floor((usd / price) * 1e18));
      const hash = await eth().request({ method: "eth_sendTransaction", params: [{ from: S.me.address, to: d.treasury, value: "0x" + wei.toString(16) }] });
      $("#txh").value = hash; toast("Sent. Waiting for confirmations…");
      claim(hash, true);
    } catch (e) { toast(e.code === 4001 ? "Transaction cancelled" : e.message, true); }
  };
  activity();
}
async function claim(hash, poll) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return toast("That doesn't look like a transaction hash", true);
  const msg = $("#claimMsg");
  for (let i = 0; i < (poll ? 40 : 1); i++) {
    try {
      const r = await api("/api/deposits/claim", { tx: hash });
      if (r.status === "credited") { msg.textContent = `Credited ${fmt(r.credits)} credits${r.usd ? ` ($${r.usd})` : ""}.${r.overCap ? " This wallet passed the pilot cap; contact us for a refund of the excess." : ""}`; await refreshMe(); toast(`+${fmt(r.credits)} credits`); return account(); }
      msg.textContent = r.reason;
      if (r.status === "rejected") return;
    } catch (e) { msg.textContent = e.message; return; }
    if (poll) await new Promise((res) => setTimeout(res, 4000));
  }
}
async function activity() {
  const a = await api("/api/activity").catch(() => null); if (!a) return;
  const kinds = { deposit: "deposit", reserve: "held", release: "released", charge: "charged", welcome: "welcome", dev: "test credits" };
  $("#act").innerHTML = a.ledger.length ? `<table class="t"><tr><th>when</th><th>what</th><th>credits</th><th>balance after</th><th>ref</th></tr>${a.ledger.map((l) => `<tr><td>${ago(l.created_at)}</td><td>${kinds[l.kind] || l.kind}</td><td><b style="color:${l.amount < 0 ? "var(--bad)" : l.kind === "reserve" ? "var(--sub)" : "var(--ok)"}">${l.kind === "reserve" ? "" : l.amount > 0 ? "+" : ""}${fmt(l.amount)}</b></td><td>${fmt(l.paid_after / 1000)}</td><td>${esc((l.ref || "").slice(0, 14))}</td></tr>`).join("")}</table>` : `<p class="fine">No activity yet.</p>`;
}

/* ---------------- agents ---------------- */
async function agents() {
  const url = (S.cfg.publicUrl || location.origin) + "/mcp";
  $("#view").innerHTML = `<div class="page-head"><div class="h-eyebrow">Agents</div><h1 class="h1">Let your agent <em>spend, within limits.</em></h1><p class="lead">Give Claude, Cursor or your own bot a key with an allow-list of modes, a per-job cap and a daily cap. It uses your credits over MCP or REST and can never go past the caps.</p></div><div id="ag"></div>`;
  if (!S.me) return ($("#ag").innerHTML = `<div class="grid">${signInCard("Keys spend the credits of your wallet.")}</div>`);
  const keys = await api("/api/keys").catch(() => []);
  $("#ag").innerHTML = `<div class="two">
    <section class="card box"><h3>New key</h3>
      <div class="field"><label>Name</label><input type="text" id="kn" value="my agent" maxlength="40"></div>
      <div class="field"><label>Modes it may use</label><div class="checks">${S.cfg.modes.map((m) => `<label><input type="checkbox" value="${m.id}" checked> ${esc(m.label)}</label>`).join("")}</div></div>
      <div class="field fields3"><div><label>Per job cap</label><input type="number" id="kp" value="100" min="1"></div><div><label>Daily cap</label><input type="number" id="kd" value="300" min="1"></div><div><label>Expires (days)</label><input type="number" id="kx" value="30" min="0"></div></div>
      <button class="btn" id="mk" style="margin-top:16px">Create key</button><div id="sec"></div></section>
    <section class="card box"><h3>Connect it</h3>
      <p class="fine" style="margin-top:8px">Claude Code</p><pre class="code">claude mcp add --transport http tessera ${esc(url)} \\
  --header "Authorization: Bearer tessera_…"</pre>
      <p class="fine" style="margin-top:14px">Claude Desktop / Cursor (mcp.json)</p><pre class="code">{ "mcpServers": { "tessera": {
  "url": "${esc(url)}",
  "headers": { "Authorization": "Bearer tessera_…" } } } }</pre>
      <p class="fine" style="margin-top:14px">REST</p><pre class="code">curl -X POST ${esc((S.cfg.publicUrl || location.origin) + "/api/agent/create")} \\
  -H "Authorization: Bearer tessera_…" -H "content-type: application/json" \\
  -d '{"mode":"logo","prompt":"logo for Ember coffee"}'</pre>
      <p class="fine" style="margin-top:12px">Tools: ${S.cfg.tools.map((t) => `<span class="pill">${t}</span>`).join(" ")}</p></section></div>
    <section class="card box" style="margin-top:18px"><h3>Your keys</h3><div style="margin-top:14px">${keys.length ? `<table class="t"><tr><th>name</th><th>key</th><th>modes</th><th>caps</th><th>last used</th><th></th></tr>${keys.map((k) => `<tr><td><b>${esc(k.name)}</b></td><td>${esc(k.prefix)}…</td><td>${k.modes.join(", ")}</td><td>${fmt(k.perJobCap)} / job · ${fmt(k.dailyCap)} / day</td><td>${k.revoked_at ? `<span class="pill bad">revoked</span>` : k.expires_at && k.expires_at < Date.now() ? `<span class="pill">expired</span>` : k.last_used ? ago(k.last_used) : "never"}</td><td>${k.revoked_at ? "" : `<button class="btn ghost xs" data-rv="${k.id}">Revoke</button>`}</td></tr>`).join("")}</table>` : `<p class="fine">No keys yet.</p>`}</div></section>`;
  $("#mk").onclick = async () => {
    try {
      const modes = [...document.querySelectorAll(".checks input:checked")].map((i) => i.value);
      const k = await api("/api/keys", { name: $("#kn").value, modes, perJobCap: Number($("#kp").value), dailyCap: Number($("#kd").value), days: Number($("#kx").value) });
      $("#sec").innerHTML = `<div class="secret"><div class="h-eyebrow" style="color:var(--ember2)">Copy it now, it won't be shown again</div><div class="addr" style="margin-top:10px"><span style="flex:1">${esc(k.secret)}</span><button class="btn ghost xs" id="cpk">Copy</button></div></div>`;
      $("#cpk").onclick = () => navigator.clipboard.writeText(k.secret).then(() => toast("Key copied"));
      setTimeout(() => agents().then(() => {}), 60000);
    } catch (e) { toast(e.message, true); }
  };
  document.querySelectorAll("[data-rv]").forEach((b) => b.onclick = async () => { if (!confirm("Revoke this key? Agents using it stop working immediately.")) return; await api(`/api/keys/${b.dataset.rv}/revoke`, {}); toast("Key revoked"); agents(); });
}

/* ---------------- docs ---------------- */
function docs() {
  const rows = S.cfg.modes.map((m) => `<tr><td><b>${esc(m.label)}</b></td><td>${esc(m.modelLabel)}</td><td>${fmt(m.maxTokens, 0)}</td></tr>`).join("");
  $("#view").innerHTML = `<div class="docs"><div class="h-eyebrow">How it works</div><h1 class="h1">Prompt in. <em>Finished work out.</em></h1>
    <p class="lead">${esc(S.cfg.brand)} turns a short brief into a website, three logo concepts, a looping animation or a set of X posts. Claude does the work; you pay for exactly what it used.</p>
    <div class="flow"><div><b>01 · quote</b>The most a job can cost, before anything runs.</div><div><b>02 · hold</b>That amount is held from your credits.</div><div><b>03 · make</b>Claude writes the page, the SVGs or the posts.</div><div><b>04 · settle</b>You're charged the real token usage, the rest returns.</div><div><b>05 · keep</b>The output is saved to your wallet's gallery.</div></div>
    <h2>Pricing</h2><p>1 credit = $0.01. A job costs Claude's list price for the tokens it used, plus 30%, with a 1-credit minimum. If Claude fails or errors on our side, nothing is charged.</p>
    <table class="t" style="margin-top:14px"><tr><th>mode</th><th>model</th><th>max output tokens</th></tr>${rows}</table>
    <h2>Paying</h2><ol><li>Connect a wallet and sign a message (free, no transaction).</li><li>Send ETH on Robinhood Chain to the deposit address, from the same wallet.</li><li>After ${S.cfg.deposit.confirmations} confirmations the ETH is converted to credits at the current price.</li></ol>
    <p style="margin-top:10px">During the pilot each wallet can deposit up to $${S.cfg.deposit.capUsd} in total. Credits are for use in ${esc(S.cfg.brand)} and are not withdrawable.</p>
    <h2>Safety</h2><ul><li>Generated pages run in a sandbox with no access to your session or wallet.</li><li>Logos are cleaned of scripts and external links before they're shown.</li><li>Agent keys are shown once and stored only as a hash. Revoking one stops it at once.</li></ul>
    <h2>For agents</h2><p>Seven tools over MCP (streamable HTTP) or REST: get_balance, list_modes, quote, create, get_job, list_outputs, get_output. Set it up on the <a href="#/agents" style="color:var(--ember2)">Agents</a> page.</p></div>`;
}

/* ---------------- terms + privacy ---------------- */
function terms() {
  const B = esc(S.cfg.brand), d = S.cfg.deposit;
  $("#view").innerHTML = `<div class="docs"><div class="page-head"><div class="h-eyebrow">Terms</div><h1 class="h1">Terms of use</h1><p class="lead">Short and plain. By connecting a wallet or using an agent key you agree to this.</p></div>
    <h2>The service</h2><p>${B} sends your brief to Claude, a model made by Anthropic, and returns what it writes: a web page, logo concepts, an animation or X posts. Outputs are generated by AI and can contain mistakes. Check them before you publish or rely on them.</p>
    <h2>Credits</h2><ul><li>1 credit is $0.01 of usage. Credits are bought with ETH on Robinhood Chain and converted at the ETH price when the deposit is confirmed.</li><li>Credits are for use in ${B} only. They are not money, not an investment, not transferable and not withdrawable.</li><li>Each job holds its maximum cost first and is charged real usage plus 30%, with a 1-credit minimum. If a job fails on our side, nothing is charged.</li><li>During the pilot each wallet can deposit up to $${d.capUsd} in total. Deposits above the cap can be refunded on request, minus network fees.</li><li>Sending the wrong token, sending on the wrong network or sending from a different wallet may not be recoverable.</li></ul>
    <h2>Your outputs</h2><p>As far as we are concerned, what you make is yours to use, including commercially. You are responsible for checking that it does not copy someone else's name, logo or trademark before you use it.</p>
    <h2>Acceptable use</h2><p>Do not use ${B} to make content that is illegal, that impersonates a real person or company, that deceives people into sending money or credentials, or that harasses anyone. We may refuse jobs and close access for abuse. Anthropic's usage policy applies to everything sent to Claude.</p>
    <h2>Agent keys</h2><p>A key spends the credits of the wallet that created it, within the caps you set. Keep it secret. Revoke it on the Agents page if it leaks; spending made with a key before it is revoked is yours.</p>
    <h2>No warranty</h2><p>${B} is provided as is, during a pilot, without any warranty. To the extent the law allows, our total liability to you is limited to the unused credits on your wallet.</p>
    <h2>Changes</h2><p>We may update these terms. The version on this page is the one that applies.</p></div>`;
}
function privacy() {
  const B = esc(S.cfg.brand);
  $("#view").innerHTML = `<div class="docs"><div class="page-head"><div class="h-eyebrow">Privacy</div><h1 class="h1">Privacy</h1><p class="lead">We keep what the service needs to work and nothing else. No ads, no trackers, no analytics scripts.</p></div>
    <h2>What we store</h2><ul><li><b>Your wallet address</b>, which is your account. No email, no name, no password.</li><li><b>Your briefs and outputs</b>, so they show up in your gallery.</li><li><b>Credit activity</b>: deposits with their transaction hashes, holds and charges.</li><li><b>Agent keys</b>, stored only as a hash, plus the name and caps you gave them.</li><li><b>A session cookie</b> to keep you signed in. It is the only cookie we set.</li></ul>
    <h2>Who else sees it</h2><p>Your brief is sent to Anthropic to generate the output. Under Anthropic's commercial terms, API inputs and outputs are not used to train their models. Deposits are public on Robinhood Chain, like any blockchain transaction. We do not sell or share data with anyone else.</p>
    <h2>Generated pages</h2><p>Previews run in a sandbox on an opaque origin, with no access to your session or your wallet.</p>
    <h2>Deleting</h2><p>Ask us to delete your account and we remove your briefs, outputs and keys. Ledger entries tied to on-chain deposits are kept for accounting.</p></div>`;
}

document.addEventListener("click", (e) => { if (e.target.closest("[data-signin]")) signIn(); });

/* ---------------- boot ---------------- */
(async () => {
  S.cfg = await api("/api/config");
  document.title = `${S.cfg.brand} · Make anything, in one prompt`;
  $("#brandName").textContent = S.cfg.brand;
  $("#mockbar").hidden = !S.cfg.mock;
  await refreshMe();
  if (eth()) eth().on?.("accountsChanged", (a) => { if (S.me && a[0]?.toLowerCase() !== S.me.address) signOut(); });
  route();
})();
