import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { account, pilotFlights } from "../flight-data.js";
import { registerMainMenuItem } from "../toolkit/index.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.

const composer = new Composer<Ctx>();
registerMainMenuItem({ label: "My balance", data: "balance:show", order: 30 });
async function show(ctx: Ctx) { const a = await account(ctx.from!.id, ctx.from?.first_name ?? "Pilot"); const flights = (await pilotFlights(a.pilot_telegram_id)).slice(-5).reverse(); const recent = flights.length ? flights.map((f) => `${f.flight_number} — ${f.status} (${f.scheduled_departure.slice(0,10)})`).join("\n") : "No flights yet — tap Register flight to add one."; await ctx.reply(`Your LuftBank balance: €${a.balance_eur.toFixed(2)}\nTotal hours: ${a.total_hours.toFixed(2)}\n\nRecent flights\n${recent}`); }

composer.command("balance", show);
composer.hears("мой баланс", show);
composer.callbackQuery("balance:show", async (ctx) => { await ctx.answerCallbackQuery(); await show(ctx); });

export default composer;
