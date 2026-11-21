// Drives the local MOCK server like a user: sign in with a test wallet, add dev credits, make one of each mode, screenshot every page.
//   server: KILN_DEV_FAUCET=1 KILN_TREASURY=0x...dead node src/server.js   (no API key = mock)
//   NODE_PATH=<puppeteer modules> node test/e2e-ui.cjs <outDir>
const puppeteer = require("puppeteer-core");
const { privateKeyToAccount } = require("viem/accounts");
const BASE = "http://127.0.0.1:6700", OUT = process.argv[2] || ".";
const acct = privateKeyToAccount("0x" + "22".repeat(32));
(async () => {
  const H = { "content-type": "application/json", "x-molten": "1" };
  const n = await (await fetch(BASE + "/api/auth/nonce", { method: "POST", headers: H, body: JSON.stringify({ address: acct.address }) })).json();
  const signature = await acct.signMessage({ message: n.message });
  const v = await fetch(BASE + "/api/auth/verify", { method: "POST", headers: H, body: JSON.stringify({ address: acct.address, nonce: n.nonce, signature }) });
  const cookie = v.headers.get("set-cookie").split(";")[0];
  await fetch(BASE + "/api/dev/credit", { method: "POST", headers: { ...H, cookie } });
  const b = await puppeteer.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: "new" });
  const p = await b.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.setCookie({ name: "molten_s", value: cookie.split("=")[1], domain: "127.0.0.1", path: "/" });
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(BASE + "/#/studio", { waitUntil: "networkidle0" });
  await p.screenshot({ path: OUT + "/k-studio-empty.png" });
  for (const mode of ["website", "logo", "motion", "xpost"]) {
    await p.click(`.mode[data-m="${mode}"]`); await p.waitForSelector("#chips .chip");
    await p.click("#chips .chip"); await new Promise((r) => setTimeout(r, 500));
    await p.click("#go"); await p.waitForFunction(() => !document.querySelector(".working"), { timeout: 30000 }); await new Promise((r) => setTimeout(r, 1200));
    await p.screenshot({ path: OUT + `/k-${mode}.png` });
  }
  for (const r of ["gallery", "account", "agents", "docs"]) { await p.goto(BASE + "/#/" + r, { waitUntil: "networkidle0" }); await new Promise((x) => setTimeout(x, 900)); await p.screenshot({ path: OUT + `/k-${r}.png`, fullPage: r === "docs" }); }
  await p.goto(BASE + "/#/agents", { waitUntil: "networkidle0" }); await p.click("#mk"); await new Promise((x) => setTimeout(x, 700));
  const secret = await p.$eval(".secret .addr span", (e) => e.textContent);
  await p.screenshot({ path: OUT + "/k-agents-key.png" });
  await p.setViewport({ width: 390, height: 844, isMobile: true }); await p.goto(BASE + "/#/studio", { waitUntil: "networkidle0" }); await p.screenshot({ path: OUT + "/k-mobile.png" });
  console.log("errors:", JSON.stringify(errs));
  // agent paths: REST and MCP with the new key
  const A = { "content-type": "application/json", authorization: "Bearer " + secret };
  console.log("rest balance:", JSON.stringify(await (await fetch(BASE + "/api/agent/get_balance", { method: "POST", headers: A, body: "{}" })).json()).slice(0, 160));
  const mcpH = { ...A, accept: "application/json, text/event-stream" };
  const init = await fetch(BASE + "/mcp", { method: "POST", headers: mcpH, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
  console.log("mcp init:", init.status, (await init.text()).slice(0, 120));
  const tl = await fetch(BASE + "/mcp", { method: "POST", headers: mcpH, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
  console.log("mcp tools:", (await tl.json()).result.tools.map((t) => t.name).join(","));
  const call = await fetch(BASE + "/mcp", { method: "POST", headers: mcpH, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "create", arguments: { mode: "xpost", prompt: "thread for a tea shop" } } }) });
  console.log("mcp create:", JSON.stringify(await call.json()).slice(0, 220));
  const bad = await fetch(BASE + "/mcp", { method: "POST", headers: { ...mcpH, authorization: "Bearer molten_nope" }, body: "{}" });
  console.log("bad key:", bad.status);
  const csrf = await fetch(BASE + "/api/create", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ mode: "logo", prompt: "xxxx" }) });
  console.log("no x-molten header:", csrf.status);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
