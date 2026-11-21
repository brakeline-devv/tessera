// The four studio modes: what Claude is asked to make, which model, how much it may write, and how the answer is cleaned up.
import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config.js";

export const MODES = {
  website: {
    label: "Website", kind: "html", model: "claude-opus-5-5", maxTokens: 24000, effort: "medium",
    system: `You build one complete, production-quality web page from the user's brief.
Output a single self-contained HTML document and nothing else: start with <!doctype html>, end with </html>, no Markdown fences, no commentary.
Rules:
- All CSS and JavaScript inline. External scripts only from https://cdnjs.cloudflare.com or https://cdn.jsdelivr.net/npm/ with an exact version. Fonts only from Google Fonts.
- No external images: draw with CSS, inline SVG or canvas.
- No forms that submit anywhere, no tracking, no network calls besides the allowed CDNs.
- Responsive from 360px phones to wide desktops. Real, specific copy written for the brief, never lorem ipsum.
- A distinctive visual direction that fits the subject; avoid generic templates.`,
  },
  logo: {
    label: "Logo", kind: "svg", model: "claude-sonnet-5-5", maxTokens: 10000, effort: "medium",
    system: `You design logos as SVG. From the user's brief, produce exactly three distinct logo concepts.
Output only the three SVG elements one after another, nothing else: no Markdown fences, no commentary.
Each one: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"> ... </svg>, a <title> naming the concept, flat shapes and gradients only.
No <script>, no event attributes, no <foreignObject>, no external references, no raster images. Text, if any, uses font-family="Inter, Helvetica, Arial, sans-serif".
Make the three genuinely different (for example: a monogram, a symbol, a wordmark). Each must still read at 32px.`,
  },
  motion: {
    label: "Motion", kind: "html", model: "claude-opus-5-5", maxTokens: 16000, effort: "medium",
    system: `You create one looping visual animation (a hero background, generative art or a 3D scene) from the user's brief.
Output a single self-contained HTML document and nothing else: start with <!doctype html>, end with </html>, no Markdown fences, no commentary.
Rules:
- Full-viewport canvas (2D or WebGL). It resizes with the window and runs smoothly at 60 fps on a laptop.
- three.js is allowed only from https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js via an import map; anything else inline.
- No text unless the brief asks for it, no external images, no network calls besides that CDN.
- It loops forever and reacts gently to the pointer when that suits the piece. Respect prefers-reduced-motion by slowing down.`,
  },
  xpost: {
    label: "X content", kind: "json", model: "claude-sonnet-5-5", maxTokens: 6000, effort: "medium",
    system: `You write X (Twitter) content for a project from the user's brief.
Output only JSON, no Markdown fences, in this shape:
{"thread": ["post 1", "post 2", ...], "posts": ["standalone post", ...], "bio": "profile bio"}
Rules: thread of 4 to 7 posts, 6 standalone posts, bio under 160 characters. Every post under 280 characters.
English, plain text, no emoji, no hashtags unless the brief asks. Concrete and specific; no hype words like "revolutionary" or "game-changer".
Never promise returns, never call anything guaranteed, never give financial advice.`,
  },
};

const client = () => new Anthropic({ apiKey: CONFIG.anthropicKey, timeout: 5 * 60 * 1000, maxRetries: 1 });

// ---------- cleanup ----------
const stripFences = (s) => s.replace(/^\s*```[a-z]*\s*/i, "").replace(/\s*```\s*$/i, "").trim();
export function cleanSvg(svg) {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("|')\s*(?!#)[^"']*\2/gi, "")
    .replace(/<image\b[^>]*>/gi, "");
}
export function parseOutput(mode, text) {
  const t = stripFences(text);
  if (MODES[mode].kind === "html") {
    const i = t.search(/<!doctype html|<html[\s>]/i), j = t.toLowerCase().lastIndexOf("</html>");
    const html = i >= 0 ? t.slice(i, j > i ? j + 7 : undefined) : t;
    const title = (html.match(/<title>([^<]{1,120})<\/title>/i) || [])[1] || MODES[mode].label;
    return { body: html, title: title.trim() };
  }
  if (mode === "logo") {
    const svgs = (t.match(/<svg[\s\S]*?<\/svg>/gi) || []).slice(0, 3).map(cleanSvg);
    if (!svgs.length) throw new Error("no SVG in the answer");
    const title = (svgs[0].match(/<title>([^<]{1,80})<\/title>/i) || [])[1] || "Logo concepts";
    return { body: JSON.stringify(svgs), title: title.trim() };
  }
  // xpost
  const j = t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
  const data = JSON.parse(j);
  const clip = (a) => (Array.isArray(a) ? a.map(String).map((s) => s.slice(0, 280)) : []);
  const out = { thread: clip(data.thread), posts: clip(data.posts), bio: String(data.bio || "").slice(0, 160) };
  return { body: JSON.stringify(out), title: (out.thread[0] || out.posts[0] || "X content").slice(0, 60) };
}

// ---------- the call ----------
export async function runClaude(mode, prompt) {
  const m = MODES[mode];
  if (CONFIG.mock) return mockRun(mode, prompt);
  const stream = client().messages.stream({
    model: m.model, max_tokens: m.maxTokens, system: m.system,
    output_config: { effort: m.effort },
    messages: [{ role: "user", content: prompt }],
  });
  const msg = await stream.finalMessage();
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, usage: msg.usage, stopReason: msg.stop_reason, model: m.model, mock: false };
}

// MOCK mode: no API key. Deterministic sample outputs so the whole flow (quote, hold, settle, preview) can be tested for free.
function mockRun(mode, prompt) {
  const safe = prompt.replace(/[<>&"]/g, "").slice(0, 60);
  const samples = {
    website: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe || "Sample site"}</title>
<style>body{margin:0;font-family:system-ui;background:#120d0a;color:#f6efe8;display:grid;place-items:center;min-height:100vh}h1{font-size:clamp(40px,8vw,96px);font-weight:300;margin:0;background:linear-gradient(90deg,#ff7a3d,#ffd36e);-webkit-background-clip:text;color:transparent}p{color:#b9aca0;max-width:520px;text-align:center}</style></head>
<body><main><h1>${safe || "Sample site"}</h1><p>Mock output. Add an Anthropic API key to generate real pages.</p></main></body></html>`,
    logo: ["#ff7a3d", "#ffd36e", "#f6efe8"].map((c, i) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>Mock concept ${i + 1}</title><rect width="512" height="512" rx="96" fill="#120d0a"/><circle cx="256" cy="256" r="${120 + i * 30}" fill="none" stroke="${c}" stroke-width="40"/></svg>`).join("\n"),
    motion: `<!doctype html><html><head><meta charset="utf-8"><title>Mock motion</title><style>html,body{margin:0;height:100%;background:#000}canvas{display:block;width:100%;height:100%}</style></head><body><canvas id="c"></canvas><script>
const c=document.getElementById('c'),x=c.getContext('2d');function f(t){c.width=innerWidth;c.height=innerHeight;for(let i=0;i<40;i++){const a=t/1500+i*.3;x.fillStyle='hsl('+(20+i*2)+',90%,'+(40+i)+'%)';x.beginPath();x.arc(c.width/2+Math.cos(a)*i*12,c.height/2+Math.sin(a*1.3)*i*8,6,0,7);x.fill()}requestAnimationFrame(f)}requestAnimationFrame(f)</script></body></html>`,
    xpost: JSON.stringify({ thread: [`Mock thread for: ${safe}`, "Post two of the sample thread.", "Post three.", "Post four."], posts: ["Sample standalone post one.", "Two.", "Three.", "Four.", "Five.", "Six."], bio: "Mock bio. Add an API key for real content." }),
  };
  const m = MODES[mode];
  return { text: samples[mode], usage: { input_tokens: 900 + prompt.length, output_tokens: Math.round(m.maxTokens * 0.35) }, stopReason: "end_turn", model: m.model, mock: true };
}
