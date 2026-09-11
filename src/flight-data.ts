import { resolveSessionStorage } from "./toolkit/index.js";

export type FlightStatus = "Registered" | "Reported" | "Approved" | "RequiresReview" | "Completed";
export interface Flight { flight_id: string; flight_number: string; route: string; region: string; pilot_telegram_id: number; scheduled_departure: string; scheduled_arrival: string; status: FlightStatus; created_at: string; updated_at: string; }
export interface Report { report_id: string; pilot_telegram_id: number; submitted_at: string; actual_departure?: string; actual_arrival?: string; linked_flight_id: string | null; match_confidence: "automatic" | "manual"; media_refs?: string[]; status: "Linked" | "Unmatched" | "Rejected" | "UnderReview"; }
export interface Account { pilot_telegram_id: number; display_name: string; balance_eur: number; total_hours: number; registered_flight_ids: string[]; recent_transaction_ids: string[]; created_at: string; updated_at: string; }
export interface Transaction { txn_id: string; pilot_telegram_id: number; flight_id: string; amount_eur: number; hours_credited: number; reason: "auto_approval" | "admin_adjustment"; timestamp: string; }
export interface Ledger { pilot_telegram_id: number; balance_eur: number; total_hours: number; last_updated: string; }

// This adapter is Redis-backed whenever REDIS_URL is configured (the deployment
// default); the harness gets a fresh toolkit adapter for its isolated process.
const storage = resolveSessionStorage<{ value: unknown }>(undefined);
const get = async <T>(key: string): Promise<T | undefined> => (await storage.read(key))?.value as T | undefined;
const put = async <T>(key: string, value: T): Promise<void> => storage.write(key, { value });
const id = (kind: string) => `${kind}_${crypto.randomUUID()}`;
let clockSource: () => Date = () => new Date();
/** Single clock seam for deterministic schedule and audit-time tests. */
export const now = () => clockSource().toISOString();
export function setClockForTests(source: () => Date): void { clockSource = source; }

export function parseTime(value: string): string | undefined {
  const plain = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}:00Z` : value;
  const ms = Date.parse(plain);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}
export function regionFor(route: string): string | undefined {
  const airports = route.toUpperCase().match(/[A-Z]{4}/g) ?? [];
  if (airports.length < 2) return undefined;
  const a = airports[0]!, b = airports[1]!;
  if (a.startsWith("ED") && b.startsWith("ED")) return "Internal";
  if (/^[KC]/.test(a) || /^[KC]/.test(b)) return "N.A.";
  if (/^[ORH]/.test(a) || /^[ORH]/.test(b)) return "MENA";
  if (/^[VWRZ]/.test(a) || /^[VWRZ]/.test(b)) return "Asia";
  if (/^[ELUG]/.test(a) || /^[ELUG]/.test(b)) return "Europe";
  return "Europe";
}
const range = (region: string): [number, number] => {
  switch (region) { case "Internal": return [100,199]; case "MENA": return [500,699]; case "Asia": return [700,899]; case "N.A.": return [900,999]; default: return [200,499]; }
};

export async function account(pilot: number, name: string): Promise<Account> {
  const existing = await get<Account>(`pilot:${pilot}`);
  if (existing) return existing;
  const timestamp = now(); const created: Account = { pilot_telegram_id: pilot, display_name: name, balance_eur: 0, total_hours: 0, registered_flight_ids: [], recent_transaction_ids: [], created_at: timestamp, updated_at: timestamp };
  await put(`pilot:${pilot}`, created); await put(`ledger:${pilot}`, { pilot_telegram_id: pilot, balance_eur: 0, total_hours: 0, last_updated: timestamp } satisfies Ledger); return created;
}
export async function saveAccount(value: Account) { value.updated_at = now(); await put(`pilot:${value.pilot_telegram_id}`, value); }
export async function flight(flightId: string) { return get<Flight>(`flight:${flightId}`); }
export async function report(reportId: string) { return get<Report>(`report:${reportId}`); }
export async function pilotFlights(pilot: number): Promise<Flight[]> { const ids = (await account(pilot, "Pilot")).registered_flight_ids; return (await Promise.all(ids.map(flight))).filter((x): x is Flight => !!x); }
export async function pendingReports(): Promise<Report[]> { const ids = (await get<string[]>("reports:review")) ?? []; return (await Promise.all(ids.map(report))).filter((x): x is Report => !!x && x.status !== "Rejected"); }
export async function createFlight(pilot: number, name: string, route: string, departure: string, arrival: string): Promise<Flight | "duplicate" | "full"> {
  const region = regionFor(route); if (!region) throw new Error("route");
  const existing = await pilotFlights(pilot);
  if (existing.some((f) => f.route === route && f.scheduled_departure === departure && f.status === "Registered")) return "duplicate";
  const [low, high] = range(region); const used = (await get<number[]>(`numbers:${region}`)) ?? [];
  const number = Array.from({ length: high-low+1 }, (_, i) => low+i).find((n) => !used.includes(n)); if (number === undefined) return "full";
  const timestamp = now(); const value: Flight = { flight_id: id("flt"), flight_number: `LH${number}`, route, region, pilot_telegram_id: pilot, scheduled_departure: departure, scheduled_arrival: arrival, status: "Registered", created_at: timestamp, updated_at: timestamp };
  // The region index is the durable allocation record; it is never discovered by scanning keys.
  await put(`numbers:${region}`, [...used, number]); await put(`flight:${value.flight_id}`, value);
  const a = await account(pilot, name); a.registered_flight_ids.push(value.flight_id); await saveAccount(a); return value;
}
export async function saveFlight(value: Flight) { value.updated_at = now(); await put(`flight:${value.flight_id}`, value); }
export async function createReport(pilot: number, departure?: string, arrival?: string, media?: string[]): Promise<Report> { const value: Report = { report_id: id("rpt"), pilot_telegram_id: pilot, submitted_at: now(), actual_departure: departure, actual_arrival: arrival, linked_flight_id: null, match_confidence: "automatic", media_refs: media, status: "Unmatched" }; await put(`report:${value.report_id}`, value); return value; }
export async function saveReport(value: Report) { await put(`report:${value.report_id}`, value); }
export async function queueReview(value: Report) { const ids = (await get<string[]>("reports:review")) ?? []; if (!ids.includes(value.report_id)) await put("reports:review", [...ids, value.report_id]); }
export async function match(pilot: number, departure: string, arrival: string): Promise<Flight[]> { const d = Date.parse(departure), a = Date.parse(arrival); return (await pilotFlights(pilot)).filter((f) => f.status === "Registered" && Math.abs(Date.parse(f.scheduled_departure)-d) <= 600000 && Math.abs(Date.parse(f.scheduled_arrival)-a) <= 600000); }
export async function approve(value: Report, reason: Transaction["reason"] = "auto_approval"): Promise<{ flight: Flight; amount: number; balance: number; hours: number } | undefined> { if (!value.linked_flight_id) return undefined; const f = await flight(value.linked_flight_id); if (!f || f.status === "Approved" || !value.actual_departure || !value.actual_arrival) return undefined; const hours = Math.max(0, (Date.parse(value.actual_arrival)-Date.parse(value.actual_departure))/3600000); if (hours <= 0) return undefined; const amount = Math.round(hours * 25 * 100) / 100; f.status = "Approved"; await saveFlight(f); const tx: Transaction = { txn_id: id("txn"), pilot_telegram_id: f.pilot_telegram_id, flight_id: f.flight_id, amount_eur: amount, hours_credited: hours, reason, timestamp: now() }; await put(`txn:${tx.txn_id}`, tx); const a = await account(f.pilot_telegram_id, "Pilot"); a.balance_eur += amount; a.total_hours += hours; a.recent_transaction_ids = [tx.txn_id, ...a.recent_transaction_ids].slice(0, 20); await saveAccount(a); await put(`ledger:${a.pilot_telegram_id}`, { pilot_telegram_id: a.pilot_telegram_id, balance_eur: a.balance_eur, total_hours: a.total_hours, last_updated: now() } satisfies Ledger); return { flight: f, amount, balance: a.balance_eur, hours };
}
