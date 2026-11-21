// Tessera landing, modelled on the reference: a full-screen 3D hex field hero (three.js, hexfield.js) with a thin top bar,
// a big grotesk headline bottom-left, a small mono line and a white button. Below: manifesto, modes, pay, agents, close.
import { createHexField } from "./hexfield.js?v=14";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lines = (t) => t.split("|").map((l) => `<span class="ln"><span>${l}</span></span>`).join("");
const words = (t) => t.split(" ").map((w) => `<span class="w">${w}</span>`).join(" ");
const NE = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 9L9 3M4 3h5v5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
const ICONS = {"Websites": "<svg viewBox=\"0 0 64 64\"><rect x=\"10\" y=\"15\" width=\"44\" height=\"34\" rx=\"6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"4.5\"/><path d=\"M10 25h44\" stroke=\"currentColor\" stroke-width=\"4.5\"/></svg>", "Logos": "<svg viewBox=\"0 0 64 64\"><path d=\"M32 8c1.2 11 4.8 16.4 22 24-17.2 7.6-20.8 13-22 24-1.2-11-4.8-16.4-22-24 17.2-7.6 20.8-13 22-24z\" fill=\"currentColor\"/></svg>", "Motion": "<svg viewBox=\"0 0 64 64\"><path d=\"M8 32c5-12 10-12 16 0s11 12 16 0 11-12 16 0\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"4.5\" stroke-linecap=\"round\"/></svg>", "X posts": "<svg viewBox=\"0 0 64 64\"><g stroke=\"currentColor\" stroke-width=\"4\" stroke-linecap=\"round\"><path d=\"M40.0 32.0L54.0 32.0\"/><path d=\"M38.9 36.0L47.6 41.0\"/><path d=\"M36.0 38.9L41.0 47.6\"/><path d=\"M32.0 40.0L32.0 54.0\"/><path d=\"M28.0 38.9L23.0 47.6\"/><path d=\"M25.1 36.0L16.4 41.0\"/><path d=\"M24.0 32.0L10.0 32.0\"/><path d=\"M25.1 28.0L16.4 23.0\"/><path d=\"M28.0 25.1L23.0 16.4\"/><path d=\"M32.0 24.0L32.0 10.0\"/><path d=\"M36.0 25.1L41.0 16.4\"/><path d=\"M38.9 28.0L47.6 23.0\"/></g></svg>"};
const MODES = [
  ["Websites", "One self-contained page from a brief. Real copy, responsive, ready to host.", "Claude Opus 5.5", "#f2a48c"],
  ["Logos", "Three directions in clean vector SVG, on light and dark.", "Claude Sonnet 5.5", "#8199f2"],
  ["Motion", "A looping canvas or 3D scene for a hero, a post or a launch.", "Claude Opus 5.5", "#e9d19c"],
  ["X posts", "A thread, six posts and a bio. Plain, specific, no emoji.", "Claude Sonnet 5.5", "#ec8f80"],
];

const RUN_MODES = [["website", "Website"], ["logo", "Logo"], ["motion", "Motion"], ["xpost", "X posts"]];
const STAGES = [
  ["Brief", "One plain sentence. Pick what you want back."],
  ["Quote and hold", "The most it can cost is set aside before anything runs."],
  ["Claude makes it", "The model writes the page, the SVGs or the posts, token by token."],
  ["Output", "Rendered in a sandbox, ready to open, copy or download."],
  ["Settle", "Charged for real usage plus 30%. The rest of the hold goes back."],
];

let field = null, ctx = null, lenis = null, rafId = 0, demo = null;
export function homeCleanup() {
  if (field) { field.destroy(); field = null; }
  if (ctx) { ctx.revert(); ctx = null; }
  if (lenis) { lenis.destroy(); lenis = null; }
  if (demo) { demo.destroy(); demo = null; }
  cancelAnimationFrame(rafId);
  document.body.classList.remove("home-mode");
}

export function home(S) {
  const B = esc(S.cfg.brand);
  document.body.classList.add("home-mode");
  const view = document.getElementById("view");
  view.innerHTML = `
  <section class="x-hero" id="xHero">
    <canvas class="x-field" id="xField"></canvas>
    <header class="x-bar">
      <a class="x-brand" href="#/"><img src="mark.svg?v=14" alt=""><b>${B.toUpperCase()}.</b><span>STUDIO 001</span></a>
      <nav class="x-right"><a href="#/docs" class="x-link">HOW IT WORKS ${NE}</a><a href="#/agents" class="x-link">FOR AGENTS ${NE}</a><a href="#/studio" class="x-btn">LAUNCH ${NE}</a></nav>
    </header>
    <div class="x-copy">
      <h1 class="x-title">${lines("Make anything,|in one prompt.")}</h1>
      <div class="x-sub"><p>Websites, logos, motion and posts by Claude.<br>Paid per use, on Robinhood Chain.</p><a class="x-cta" href="#/studio">OPEN STUDIO</a></div>
    </div>
  </section>

  <section class="x-sec x-manifesto"><span class="x-label">// 01 · WHAT IT IS</span><p class="mf">${words("You write one sentence. Claude does the craft. You pay for the tokens it used, and every credit it didn't use flows straight back.")}</p></section>

  <section class="x-sec"><div class="x-head"><span class="x-label">// 02 · FOUR MODES</span><h2 class="x-h2">${lines("One brief.|Four kinds of finished.")}</h2></div>
    <div class="x-modes">${MODES.map(([t, d, m, c], i) => `<a class="x-mode" href="#/studio" style="--c:${c}"><span class="x-mi">0${i + 1}</span><div class="x-hex"><span>${ICONS[t]}</span></div><h3>${t}</h3><p>${d}</p><span class="x-mm">${m}</span></a>`).join("")}</div></section>

  <section class="x-run" id="xRun">
    <div class="x-run-in">
      <div class="x-run-l">
        <span class="x-label">// 03 · HOW IT WORKS</span>
        <h2 class="x-h2">${lines("Watch one job|run, end to end.")}</h2>
        <div class="dm-tabs" id="dmTabs">${RUN_MODES.map(([k, t], i) => `<button data-m="${k}" class="${i ? "" : "on"}">${t}</button>`).join("")}</div>
        <ol class="dm-steps" id="dmSteps">${STAGES.map(([t, d], i) => `<li><span>0${i + 1}</span><div><b>${t}</b><p>${d}</p></div></li>`).join("")}</ol>
        <p class="dm-note">A real run on ${B}: the brief, the tokens, the output and the bill below are exactly what the engine returned.</p>
      </div>
      <div class="dm" id="dm">
        <div class="dm-bar"><i></i><i></i><i></i><span>${B.toLowerCase()} / studio / new job</span><em id="dmStatus">draft</em></div>
        <div class="dm-top">
          <div class="dm-row"><label>MODE</label><div class="dm-chips" id="dmChips">${RUN_MODES.map(([k, t]) => `<span data-m="${k}">${t}</span>`).join("")}</div></div>
          <div class="dm-row dm-brief"><label>BRIEF</label><p id="dmBrief"></p></div>
          <div class="dm-row dm-quote" id="dmQuote"><label>QUOTE</label><div><b id="dmModel"></b><span>at most <b id="dmHeld">0</b> credits held</span><div class="dm-hold"><i id="dmHoldBar"></i></div></div></div>
        </div>
        <div class="dm-stage" id="dmStage">
          <div class="dm-idle"><span>MAKE</span><p id="dmIdle">Waiting for the brief</p></div>
          <div class="dm-code" id="dmCode"><div class="dm-meter"><span id="dmTok">0</span> tokens written<i id="dmTokBar"></i></div><pre id="dmPre"></pre></div>
          <div class="dm-out" id="dmOut"></div>
          <div class="dm-rc" id="dmRc">
            <div class="x-label">RECEIPT</div>
            <div class="rl"><em>tokens in / out</em><b id="rIO"></b></div>
            <div class="rl"><em>Claude cost</em><b id="rCost"></b></div>
            <div class="rl"><em>held</em><b id="rHeld"></b></div>
            <div class="rl"><em>returned</em><b class="g" id="rBack"></b></div>
            <div class="rl t"><em>charged</em><b id="rCh"></b></div>
            <div class="dm-saved">Saved to your gallery</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="x-sec x-agents"><div><span class="x-label">// 04 · FOR AGENTS</span><h2 class="x-h2">${lines("Your agent spends.|Only what you allow.")}</h2>
      <p class="x-lead">Give Claude, Cursor or your own bot a key with a mode list, a per-job cap and a daily cap. Revoke it and it stops, instantly.</p>
      <a class="x-cta" href="#/agents" style="margin-top:26px">CREATE A KEY</a></div>
    <div class="term"><div class="tb"><i></i><i></i><i></i><span>claude code</span></div><pre id="typed"></pre></div></section>

  <section class="x-final"><h2 class="x-fin">${lines("Bring the idea.|We'll finish it.")}</h2><a class="x-cta big" href="#/studio">OPEN STUDIO</a></section>
  <footer class="x-foot"><span>${B} · made by Claude, paid on Robinhood Chain</span><span><a href="#/docs">How it works</a> · <a href="#/terms">Terms</a> · <a href="#/privacy">Privacy</a> · <a href="https://github.com/brakeline-devv/tessera" target="_blank" rel="noopener">GitHub</a> · Credits are not withdrawable.</span></footer>`;

  demo = runDemo();
  try { field = createHexField(document.getElementById("xField"), { eventTarget: document.getElementById("xHero") }); }
  catch (e) { console.error(e); document.getElementById("xField").remove(); }

  const G = window.gsap, ST = window.ScrollTrigger;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!G || !ST || reduce) { view.querySelectorAll(".mf .w").forEach((w) => (w.style.opacity = 1)); demo.set(0.99); return; }
  G.registerPlugin(ST);
  lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true });
  lenis.on("scroll", ST.update);
  const tick = (t) => { lenis && lenis.raf(t); rafId = requestAnimationFrame(tick); }; rafId = requestAnimationFrame(tick);

  ctx = G.context(() => {
    G.from(".x-title .ln > span", { yPercent: 110, duration: 1.1, ease: "expo.out", stagger: 0.1, delay: 0.25 });
    G.from(".x-sub, .x-bar", { opacity: 0, y: 14, duration: 0.9, ease: "power3.out", stagger: 0.08, delay: 0.5 });
    G.from(".x-field", { opacity: 0, duration: 1.6, ease: "power2.out" });
    ST.create({ trigger: "#xHero", start: "top top", end: "bottom top", scrub: true, onUpdate: (s) => field && field.setScroll(s.progress) });
    G.to(".x-copy", { yPercent: -40, opacity: 0, ease: "none", scrollTrigger: { trigger: "#xHero", start: "35% top", end: "bottom top", scrub: true } });
    G.fromTo(".mf .w", { opacity: 0.12 }, { opacity: 1, stagger: 0.05, ease: "none", scrollTrigger: { trigger: ".x-manifesto", start: "top 75%", end: "bottom 60%", scrub: true } });
    view.querySelectorAll(".x-h2, .x-fin").forEach((h) => G.from(h.querySelectorAll(".ln > span"), { yPercent: 110, duration: 1, ease: "expo.out", stagger: 0.1, scrollTrigger: { trigger: h, start: "top 82%" } }));
    G.from(".x-mode", { y: 60, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.1, scrollTrigger: { trigger: ".x-modes", start: "top 80%" } });
    ST.create({ trigger: "#xRun", start: "top top", end: "+=" + innerHeight * 4, pin: true, scrub: 0.6, onUpdate: (s) => demo && demo.set(s.progress) });
    ST.create({ trigger: ".term", start: "top 78%", once: true, onEnter: () => typeTerm(S) });
  }, view);
  document.fonts.ready.then(() => ST.refresh());
}

function typeTerm(S) {
  const el = document.getElementById("typed"); if (!el) return;
  const url = (S.cfg.publicUrl || location.origin) + "/mcp";
  const script = [["c", "# one line, then just ask"], ["p", `$ claude mcp add --transport http tessera ${url}`], ["o", "  ✓ added MCP server tessera (7 tools)"], ["", ""],
    ["u", "you    › make three logo options for Ember, a coffee roaster"], ["a", "agent  calling create({ mode: \"logo\" }) …"], ["o", "  ✓ 3 SVG concepts · charged 4.8 of 13.07 credits held"], ["a", "agent  Saved to your gallery. Want a landing page next?"]];
  let i = 0, j = 0, out = "";
  const H = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const step = () => {
    if (i >= script.length) return;
    const [k, line] = script[i];
    if (j <= line.length) { el.innerHTML = out + `<span class="t-${k}">${H(line.slice(0, j))}</span><span class="caret"></span>`; j += k === "o" || k === "c" ? 4 : 1; setTimeout(step, k === "o" ? 8 : 22); }
    else { out += `<span class="t-${k}">${H(line)}</span>\n`; i++; j = 0; setTimeout(step, k === "a" ? 500 : 180); }
  };
  step();
}

// ---------- the live run: a studio window replaying one real job from web/showcase/meta.json, driven by scroll ----------
function runDemo() {
  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 2) => Number(n).toFixed(d);
  let meta = null, mode = "website", p = 0, codeCache = {}, outFor = "", dead = false;
  const H = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  fetch("showcase/meta.json?v=14").then((r) => r.json()).then((m) => { if (dead) return; meta = m; prep(); paint(); }).catch(() => {});

  async function prep() {
    const get = (u) => fetch(u).then((r) => r.text()).catch(() => "");
    codeCache.website = await get("showcase/website.html");
    codeCache.motion = await get("showcase/motion.html");
    codeCache.logo = (await Promise.all([1, 2, 3].map((i) => get(`showcase/logo-${i}.svg`)))).join("\n\n");
    codeCache.xpost = JSON.stringify(meta.xpost.data, null, 2);
    if (!dead) paint();
  }
  function output(m) {
    const box = $("dmOut"); if (!box || outFor === m) return; outFor = m;
    if (m === "website" || m === "motion") {
      box.innerHTML = `<div class="dm-frame"><iframe src="showcase/${m}.html" title="${m} sample" loading="lazy" tabindex="-1"></iframe></div><a class="dm-open" href="showcase/${m}.html" target="_blank" rel="noopener">OPEN FULL PAGE</a>`;
      fit();
    } else if (m === "logo") {
      box.innerHTML = `<div class="dm-logos">${[1, 2, 3].map((i) => `<figure><img src="showcase/logo-${i}.svg" alt="Logo concept ${i}"></figure>`).join("")}</div>`;
    } else {
      const d = meta.xpost.data;
      box.innerHTML = `<div class="dm-thread">${d.thread.slice(0, 4).map((t, i) => `<article><header><b>Ember</b><span>@embercoffee · ${i + 1}/${d.thread.length}</span></header><p>${H(t)}</p></article>`).join("")}</div>`;
    }
  }
  function fit() {
    const f = document.querySelector("#dmOut .dm-frame"); if (!f) return;
    const ifr = f.querySelector("iframe"), w = f.clientWidth; ifr.style.transform = `scale(${w / 1280})`; f.style.height = (w / 1280) * 800 + "px";
  }
  const ro = new ResizeObserver(fit); ro.observe($("dm"));

  function paint() {
    const st = Math.min(4, Math.floor(p * 5)), lp = p * 5 - st;    // stage and progress inside it
    document.querySelectorAll("#dmSteps li").forEach((li, i) => { li.classList.toggle("on", i === st); li.classList.toggle("done", i < st); });
    document.querySelectorAll("#dmChips span").forEach((c) => c.classList.toggle("on", c.dataset.m === mode));
    document.querySelectorAll("#dmTabs button").forEach((c) => c.classList.toggle("on", c.dataset.m === mode));
    const dm = $("dm"); if (!dm) return;
    dm.dataset.stage = st;
    $("dmIdle").textContent = st === 0 ? "Waiting for the brief" : "Credits held. Starting Claude…";
    $("dmStatus").textContent = ["draft", "quoted", "running", "done", "settled"][st];
    if (!meta) return;
    const j = meta[mode];
    const typed = st === 0 ? Math.floor(j.prompt.length * Math.min(1, lp * 1.25)) : j.prompt.length;
    $("dmBrief").innerHTML = H(j.prompt.slice(0, typed)) + (st === 0 ? '<span class="caret"></span>' : "");
    $("dmModel").textContent = j.model.replace("claude-", "Claude ").replace(/-(\d)-(\d)$/, " $1.$2").replace("opus", "Opus").replace("sonnet", "Sonnet");
    const hold = st === 0 ? 0 : st === 1 ? Math.min(1, lp * 1.6) : 1;
    $("dmHeld").textContent = fmt(j.held * hold);
    $("dmHoldBar").style.width = (st >= 4 ? (j.charged / j.held) * 100 : hold * 100) + "%";
    const w = st < 2 ? 0 : st === 2 ? Math.min(1, lp * 1.15) : 1;
    $("dmTok").textContent = Math.round(j.out * w).toLocaleString("en-US");
    $("dmTokBar").style.width = w * 100 + "%";
    const code = codeCache[mode] || "";
    if (code) { const pre = $("dmPre"); pre.textContent = code.slice(0, Math.floor(code.length * w)); pre.scrollTop = pre.scrollHeight; }
    if (st >= 3) output(mode);
    const back = j.held - j.charged;
    $("rIO").textContent = `${j.in.toLocaleString("en-US")} / ${j.out.toLocaleString("en-US")}`;
    $("rCost").textContent = "$" + fmt(j.cost, 4);
    $("rHeld").textContent = fmt(j.held);
    $("rBack").textContent = fmt(back * (st === 4 ? Math.min(1, lp * 2) : 0));
    $("rCh").textContent = fmt(j.charged);
  }
  document.querySelectorAll("#dmTabs button").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.m; outFor = ""; paint(); }));
  return { set(v) { p = Math.max(0, Math.min(0.999, v)); paint(); }, destroy() { dead = true; ro.disconnect(); } };
}
