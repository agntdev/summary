import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { createFlight, parseTime } from "../flight-data.js";
import { adminChatId } from "../toolkit/index.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.

type Flow = { step?: string; route?: string; departure?: string; arrival?: string };
const composer = new Composer<Ctx>();

const name = (ctx: Ctx) => ctx.from?.first_name ?? "Pilot";
const tellAdmin = async (ctx: Ctx, text: string) => { const admin = adminChatId(ctx as { env?: Record<string, unknown> }); if (admin) { try { await ctx.api.sendMessage(admin, text); } catch { /* an unavailable admin must not lose the record */ } } };
async function finish(ctx: Ctx, route: string, departure: string, arrival: string) {
  const f = await createFlight(ctx.from!.id, name(ctx), route.toUpperCase(), departure, arrival);
  if (f === "duplicate") { await tellAdmin(ctx, "Duplicate flight registration needs review."); await ctx.reply("That flight is already registered for this schedule. It has been sent for review."); return; }
  if (f === "full") { await tellAdmin(ctx, "A flight-number region is full and needs review."); await ctx.reply("That flight-number range is full. The administrator has been notified."); return; }
  await ctx.reply(`Flight ${f.flight_number} is registered.\n${f.route}\nScheduled: ${f.scheduled_departure.slice(0,16).replace("T", " ")} to ${f.scheduled_arrival.slice(11,16)} UTC.`);
  await tellAdmin(ctx, `New registration: ${f.flight_number} ${f.route}, scheduled ${f.scheduled_departure}.`);
}

composer.command("register", async (ctx) => {
  const parts = ctx.match.trim().split(/\s+/);
  // /register EDDF-EGLL 2026-09-12 10:00 2026-09-12 11:30
  if (parts.length >= 5) { const d = parseTime(`${parts[1]} ${parts[2]}`), a = parseTime(`${parts[3]} ${parts[4]}`); if (!d || !a || Date.parse(a) <= Date.parse(d)) { await ctx.reply("Use a valid route and times: /register EDDF-EGLL 2026-09-12 10:00 2026-09-12 11:30"); return; } await finish(ctx, parts[0], d, a); return; }
  (ctx.session as Flow).step = "register_route";
  await ctx.reply("Send your route in ICAO format, for example EDDF-EGLL.", { reply_markup: { force_reply: true, input_field_placeholder: "EDDF-EGLL" } });
});

composer.on("message:text", async (ctx, next) => {
  const flow = ctx.session as Flow; const text = ctx.message.text.trim();
  if (flow.step === "register_route") { if (!/^[A-Za-z]{4}\s*[-–>]\s*[A-Za-z]{4}$/.test(text)) { await ctx.reply("Use two ICAO airports, for example EDDF-EGLL."); return; } flow.route = text.replace(/\s/g, "").replace(/[–>]/g, "-").toUpperCase(); flow.step = "register_departure"; await ctx.reply("Send scheduled departure in YYYY-MM-DD HH:MM UTC.", { reply_markup: { force_reply: true, input_field_placeholder: "2026-09-12 10:00" } }); return; }
  if (flow.step === "register_departure") { const d = parseTime(text); if (!d) { await ctx.reply("Use YYYY-MM-DD HH:MM UTC, for example 2026-09-12 10:00."); return; } flow.departure = d; flow.step = "register_arrival"; await ctx.reply("Send scheduled arrival in YYYY-MM-DD HH:MM UTC.", { reply_markup: { force_reply: true, input_field_placeholder: "2026-09-12 11:30" } }); return; }
  if (flow.step === "register_arrival") { const a = parseTime(text); if (!a || Date.parse(a) <= Date.parse(flow.departure!)) { await ctx.reply("Arrival must be after departure. Send it as YYYY-MM-DD HH:MM UTC."); return; } const { route, departure } = flow; delete flow.step; await finish(ctx, route!, departure!, a); return; }
  return next();
});

export default composer;
