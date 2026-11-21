// Turns Claude token usage into credits. A quote is the worst case (all max_tokens used); the charge is the real usage.
import { CONFIG, MODELS } from "./config.js";

export const MC_PER_CREDIT = 1000;
export const toCredits = (mc) => Math.round(mc) / MC_PER_CREDIT;

// rough input size before the call: system prompt + user prompt, ~3.5 characters per token, plus a margin
export const estimateInputTokens = (systemChars, promptChars) => Math.ceil((systemChars + promptChars) / 3.5 * 1.15) + 50;

export function usdCost(model, inputTokens, outputTokens) {
  const p = MODELS[model]; if (!p) throw new Error("unknown model " + model);
  return (inputTokens * p.in + outputTokens * p.out) / 1e6;
}

// usd → millicredits with markup, rounded up so we never undercharge by a fraction
export function chargeMc(usd) {
  const credits = (usd * (1 + CONFIG.markup)) / CONFIG.usdPerCredit;
  return Math.max(CONFIG.minCharge * MC_PER_CREDIT, Math.ceil(credits * MC_PER_CREDIT));
}

export function quote(model, systemChars, promptChars, maxTokens) {
  const inTok = estimateInputTokens(systemChars, promptChars);
  const usd = usdCost(model, inTok, maxTokens);
  return { model, estInputTokens: inTok, maxOutputTokens: maxTokens, maxUsd: usd, maxMc: chargeMc(usd) };
}

export function settleFromUsage(model, usage) {
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  const usd = usdCost(model, inTok, usage.output_tokens || 0);
  return { usd, mc: chargeMc(usd) };
}
