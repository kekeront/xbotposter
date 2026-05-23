import "server-only";
import type { EvalOutput } from "@/agents/evaluator";
import type { FactCheckOutput } from "@/agents/fact-checker";
import { env } from "./env";

export type AutoApproveContext = {
  mode: "ai" | "manual" | "take" | "qrt";
  contentType: "single" | "thread";
  text: string;
  evaluation: Pick<EvalOutput, "overall" | "scores">;
  factCheck: Pick<FactCheckOutput, "inventedCount">;
};

export type AutoApproveVerdict =
  | { eligible: true; scheduledFor: Date; reason: string }
  | { eligible: false; reason: string };

// Detects any URL form X would auto-wrap into a t.co shortlink: explicit
// http(s)://, www., or a bare t.co/ shortlink (which can appear if the
// viral text was echoed verbatim into the draft). X charges $0.20 for URL
// tweets vs $0.015 plain — and external URLs typically link to content
// the user hasn't vetted, so auto-shipping them is the worst risk surface.
const URL_RE = /(?:https?:\/\/|www\.|t\.co\/)\S+/i;

// Strict guardrail set for auto-approve. EVERY condition must pass — single
// failure = manual approve. Order matters: cheapest checks first.
export function shouldAutoApprove(ctx: AutoApproveContext): AutoApproveVerdict {
  if (!env.AUTO_APPROVE_ENABLED) {
    return { eligible: false, reason: "auto-approve disabled (env)" };
  }
  if (ctx.contentType !== "single") {
    return { eligible: false, reason: "threads excluded from auto-approve" };
  }
  if (URL_RE.test(ctx.text)) {
    return { eligible: false, reason: "text contains URL ($0.20 fee + unvetted link)" };
  }
  const len = ctx.text.length;
  if (len < 60 || len > 270) {
    return { eligible: false, reason: `length ${len} outside [60, 270]` };
  }
  if (ctx.evaluation.overall < env.AUTO_APPROVE_MIN_EVAL) {
    return {
      eligible: false,
      reason: `eval overall ${ctx.evaluation.overall} < ${env.AUTO_APPROVE_MIN_EVAL}`,
    };
  }
  if (ctx.evaluation.scores.stance < env.AUTO_APPROVE_MIN_STANCE) {
    return {
      eligible: false,
      reason: `eval stance ${ctx.evaluation.scores.stance} < ${env.AUTO_APPROVE_MIN_STANCE}`,
    };
  }
  if (ctx.factCheck.inventedCount > 0) {
    return {
      eligible: false,
      reason: `fact-check found ${ctx.factCheck.inventedCount} invented claim(s)`,
    };
  }

  const scheduledFor = new Date(
    Date.now() + env.AUTO_APPROVE_DELAY_MINUTES * 60 * 1000,
  );
  return {
    eligible: true,
    scheduledFor,
    reason: `all gates passed; scheduled in ${env.AUTO_APPROVE_DELAY_MINUTES}m`,
  };
}
