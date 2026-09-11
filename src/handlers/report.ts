import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { approve, createReport, match, parseTime, queueReview, saveFlight, saveReport } from "../flight-data.js";
import { adminChatId, inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.

type Flow = { step?: string };
const composer = new Composer<Ctx>();
registerMainMenuItem({ label: "Submit report", data: "report:start", order: 20 });
const adminNote = async (ctx: Ctx, text: string) => { const admin = adminChatId(ctx as { env?: Record<string, unknown> }); if (admin) { try { await ctx.api.sendMessage(admin, text); } catch { /* keep processing when Telegram cannot reach the owner */ } } };
async function submit(ctx: Ctx, departure?: string, arrival?: string, media?: string[]) {
  const r = await createReport(ctx.from!.id, departure, arrival, media);
  if (!departure || !arrival) { await queueReview(r); await adminNote(ctx, "A media-only report needs manual review."); await ctx.reply("Your report needs the actual departure and arrival times. Send /report with both times."); return; }
  const candidates = await match(ctx.from!.id, departure, arrival);
  if (candidates.length !== 1) { await queueReview(r); await adminNote(ctx, `Report ${r.report_id} needs manual review: ${candidates.length === 0 ? "no matching flight" : "multiple matching flights"}.`); await ctx.reply("Your report is saved and needs manual review. The administrator has been notified."); return; }
  const f = candidates[0]; r.linked_flight_id = f.flight_id; r.status = "Linked"; await saveReport(r); f.status = "Reported"; await saveFlight(f);
  const result = await approve(r);
  if (!result) { f.status = "RequiresReview"; await saveFlight(f); await queueReview(r); await adminNote(ctx, `Report ${r.report_id} could not be approved automatically.`); await ctx.reply("Your report is linked and needs manual review."); return; }
  await ctx.reply(`Your report matched ${result.flight.flight_number} and was approved. €${result.amount.toFixed(2)} was credited. New balance: €${result.balance.toFixed(2)}.`);
}
function prompt(ctx: Ctx) { (ctx.session as Flow).step = "report_times"; return ctx.reply("Send actual departure and arrival in one line: YYYY-MM-DD HH:MM, YYYY-MM-DD HH:MM UTC.", { reply_markup: { force_reply: true, input_field_placeholder: "2026-09-12 10:05, 2026-09-12 11:35" } }); }

composer.command("report", async (ctx) => { const value = ctx.match.trim(); if (!value) { await prompt(ctx); return; } const times = value.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*[,;]\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/); if (!times) { await ctx.reply("Send both actual times: /report 2026-09-12 10:05, 2026-09-12 11:35"); return; } const d = parseTime(times[1]), a = parseTime(times[2]); if (!d || !a || Date.parse(a) <= Date.parse(d)) { await ctx.reply("Arrival must be after departure. Check both UTC times and try again."); return; } await submit(ctx, d, a); });
composer.callbackQuery("report:start", async (ctx) => { await ctx.answerCallbackQuery(); await prompt(ctx); });
composer.on("message:text", async (ctx, next) => { if ((ctx.session as Flow).step !== "report_times") return next(); const times = ctx.message.text.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*[,;]\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/); if (!times) { await ctx.reply("Send both times in one line, separated by a comma."); return; } const d = parseTime(times[1]), a = parseTime(times[2]); if (!d || !a || Date.parse(a) <= Date.parse(d)) { await ctx.reply("Arrival must be after departure. Check both UTC times and try again."); return; } delete (ctx.session as Flow).step; await submit(ctx, d, a); });
composer.on(["message:photo", "message:document"], async (ctx, next) => { const media = ctx.message.photo?.at(-1)?.file_id ?? ctx.message.document?.file_id; if (!media) return next(); await submit(ctx, undefined, undefined, [media]); });

export default composer;
