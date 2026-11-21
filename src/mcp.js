// Agent tools, reachable two ways with the same API key (Bearer molten_...):
//   MCP over streamable HTTP at POST /mcp      (Claude Desktop, Claude Code, Cursor)
//   REST at POST /api/agent/<tool> with a JSON body
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CONFIG } from "./config.js";

const MODE_ENUM = ["website", "logo", "motion", "xpost"];
export const TOOLS = [
  { name: "get_balance", description: "Credits available on the wallet behind this key (1 credit = $0.01), plus this key's caps.", inputSchema: { type: "object", properties: {} } },
  { name: "list_modes", description: "What the studio can make: website (one HTML page), logo (three SVG concepts), motion (looping HTML animation), xpost (X thread, posts and bio as JSON). With the model and max output for each.", inputSchema: { type: "object", properties: {} } },
  { name: "quote", description: "Most a job could cost in credits before running it. You are charged the real usage, never more than the quote.", inputSchema: { type: "object", properties: { mode: { type: "string", enum: MODE_ENUM }, prompt: { type: "string" } }, required: ["mode", "prompt"] } },
  { name: "create", description: "Run a job and wait for it (website/motion can take 1-3 minutes). Returns the output: SVG strings for logo, JSON for xpost, and a link to the HTML for website/motion. Credits are held up front and settled to the real usage.", inputSchema: { type: "object", properties: { mode: { type: "string", enum: MODE_ENUM }, prompt: { type: "string", description: "The brief: what to make, for whom, style, colours, copy." } }, required: ["mode", "prompt"] } },
  { name: "get_job", description: "Status, tokens and charge of one job.", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  { name: "list_outputs", description: "Recent outputs of this wallet (id, mode, title, time).", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "get_output", description: "One output with its content (SVG list, JSON, or a link to the HTML).", inputSchema: { type: "object", properties: { output_id: { type: "string" } }, required: ["output_id"] } },
];

export async function callTool(svc, key, name, a = {}) {
  const addr = key.address;
  const abs = (o) => (o && o.previewUrl ? { ...o, previewUrl: CONFIG.publicUrl + o.previewUrl, downloadUrl: CONFIG.publicUrl + o.downloadUrl } : o);
  switch (name) {
    case "get_balance": return { ...svc.me(addr), key: { name: key.name, modes: key.modes, perJobCap: key.per_job_cap_mc / 1000, dailyCap: key.daily_cap_mc / 1000 } };
    case "list_modes": return svc.modes();
    case "quote": return svc.quote(a.mode, a.prompt);
    case "create": { const r = await svc.create(addr, a.mode, a.prompt, key.via, key); return { job: r.job, output: abs(r.output), truncated: r.truncated }; }
    case "get_job": return svc.job(addr, a.job_id);
    case "list_outputs": return svc.outputs(addr, Number(a.limit) || 20);
    case "get_output": return abs(svc.output(addr, a.output_id));
    default: { const e = new Error("unknown tool " + name); e.status = 404; throw e; }
  }
}

// one stateless MCP server per request, bound to the key that made it
export async function handleMcp(svc, key, req, res, body) {
  const server = new Server({ name: CONFIG.brand.toLowerCase(), version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (r) => {
    try { const out = await callTool(svc, key, r.params.name, r.params.arguments || {}); return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] }; }
    catch (e) { return { isError: true, content: [{ type: "text", text: e.message || String(e) }] }; }
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
