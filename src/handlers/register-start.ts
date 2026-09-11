import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem } from "../toolkit/index.js";

// SCAFFOLD — generated from the bot blueprint BEFORE the agent runs.
// Keep a LIVE registration (.command / .callbackQuery / …) so this feature is
// never an empty stub. Replace the reply body with real logic + copy; if you
// change the user-facing text, update tests/specs to match EXACTLY.
// Do NOT rewrite src/bot.ts — buildBot() already auto-loads this module.
// Menu: wire this into /start via registerMainMenuItem({ label: "Register flight", data: "register:start" }) if the toolkit exposes it.

type Flow = { step?: string; route?: string; departure?: string; arrival?: string };
const composer = new Composer<Ctx>();
registerMainMenuItem({ label: "Register flight", data: "register:start", order: 10 });

composer.callbackQuery("register:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  (ctx.session as Flow).step = "register_route";
  await ctx.reply("Send your route in ICAO format, for example EDDF-EGLL.", { reply_markup: { force_reply: true, input_field_placeholder: "EDDF-EGLL" } });
});

export default composer;
