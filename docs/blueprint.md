# LuftRegBot — Bot specification

**Archetype:** finance

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot for Lufthansa Virtual Airlines that assigns region-based LH flight numbers on pilot registration, matches and validates pilot reports within a ±10 minute tolerance, marks approved flights, records virtual EUR payroll transactions to a LuftBank ledger, and answers pilots' balance and hours queries.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Lufthansa Virtual pilots
- VA administrators

## Success criteria

- A unique LHxxx flight number is assigned on every valid /register and persisted as a Registered Flight
- Pilot-submitted Reports are automatically matched to the pilot's Registered Flight when scheduled vs actual times differ by ≤10 minutes
- Approved Reports create a Transaction in EUR and update the pilot's LuftBank balance and total hours immediately
- ADMIN_CHAT_ID receives notifications for new registrations, conflicts, and manual-review requests
- Pilots can request /balance or send "мой баланс" and receive an accurate current EUR balance, total hours, and recent flights

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu (shows quick actions: Register flight, Submit report, My balance, Help)
- **Register flight** (button, actor: user, callback: register:start) — Begin structured flight registration via guided prompts
  - inputs: route (ICAO/route text), scheduled_departure (YYYY-MM-DD HH:MM), scheduled_arrival (YYYY-MM-DD HH:MM), optional: callsign or note
  - outputs: Registration confirmation with assigned LHxxx flight number, Admin notification
- **/register** (command, actor: user, command: /register) — Slash command alternative to start registration; accepts structured parameters or enters a guided ForceReply
  - inputs: route, scheduled_departure, scheduled_arrival
  - outputs: Assigned flight number, Registered Flight entity
- **/report** (command, actor: user, command: /report) — Submit a flight report; used for typed actual times and notes (or reply to a message in the Reports thread)
  - inputs: actual_departure (YYYY-MM-DD HH:MM), actual_arrival (YYYY-MM-DD HH:MM), optional: flight number/callsign, notes, screenshot/media
  - outputs: Report entity, Auto-match attempt result (linked/flagged)
- **/balance** (command, actor: user, command: /balance) — Returns pilot's current EUR balance, total accumulated hours, and recent flights
  - outputs: Balance summary message, Recent flights list

## Flows

### Register flight
_Trigger:_ /register command or register:start callback

1. Collect structured registration inputs (route, scheduled_departure, scheduled_arrival, optional callsign)
2. Validate inputs and resolve route -> region to pick flight-number range
3. Assign next available unique LHxxx number in region range (prevent race/duplicates via DB lock)
4. Create Flight entity with status=Registered and associate with pilot (Telegram id)
5. Confirm to pilot with assigned flight number and schedule
6. Notify ADMIN_CHAT_ID with registration details

_Data touched:_ Flight, PilotAccount

### Submit report and auto-match
_Trigger:_ /report command or report message in Reports thread

1. Accept report with actual times and optional flight number/callsign or media
2. Normalize times, infer pilot identity via Telegram id
3. Find pilot's most recent Registered Flight(s) within matching window (±10 minutes tolerance) comparing scheduled vs reported times
4. If single confident match: create Report entity, link to Flight, change Flight.status=Reported, notify pilot of linkage
5. If multiple matches or no match within tolerance: create Report entity, mark Unmatched, notify ADMIN_CHAT_ID for manual review and inform pilot

_Data touched:_ Report, Flight, PilotAccount

### Approval and payroll posting
_Trigger:_ Auto-match success or admin manual approval event

1. Validate that Report and Flight times meet tolerance and uniqueness rules
2. If auto-approved: mark Flight.status=Approved and create Transaction with calculated salary in EUR
3. Update PilotAccount.balance and total_hours, and update LuftBank ledger totals
4. Send pilot a confirmation of approval with salary credited and new balance
5. If failed validation: set Flight.status=RequiresReview and send manual-review notification to ADMIN_CHAT_ID

_Data touched:_ Flight, Report, Transaction, PilotAccount, LuftBankLedger

### Manual review / conflict resolution
_Trigger:_ Admin inspects Unmatched/Conflicting Report or duplicate registration detected

1. Admin views linked entities and timeline
2. Admin can reassign Report->Flight, override approval/deny, or reassign flight number
3. When admin approves: follow Approval and payroll posting steps; when denied: mark Report rejected and notify pilot

_Data touched:_ Flight, Report, Transaction, PilotAccount

### Balance inquiry
_Trigger:_ /balance command or text 'мой баланс'

1. Lookup PilotAccount and LuftBank totals for the Telegram user
2. Return current EUR balance, total flight hours, and list of recent flights (status and date)
3. If pilot has no account yet: create empty PilotAccount with zero balance and explain how to register a flight

_Data touched:_ PilotAccount, Flight, LuftBankLedger

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — where new registration/conflict/manual-review notifications are sent
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **Flight** _(retention: persistent)_ — Registered flight with region-assigned LHxxx number and lifecycle status
  - fields: flight_id (internal), flight_number (LHxxx), route, region, pilot_telegram_id, scheduled_departure (ISO datetime), scheduled_arrival (ISO datetime), status (Registered|Reported|Approved|Completed|RequiresReview), created_at, updated_at
- **Report** _(retention: persistent)_ — Pilot-submitted actual times and optional media, linked to a Flight when matched
  - fields: report_id, pilot_telegram_id, submitted_at, actual_departure (ISO datetime), actual_arrival (ISO datetime), linked_flight_id (nullable), match_confidence (automatic|manual), media_refs (optional), status (Linked|Unmatched|Rejected|UnderReview)
- **PilotAccount** _(retention: persistent)_ — Per-pilot ledger and profile used to record balances and hours
  - fields: pilot_telegram_id, display_name, balance_eur (decimal), total_hours (hours, decimal), registered_flight_ids (list), recent_transaction_ids (list), created_at, updated_at
- **Transaction** _(retention: persistent)_ — A payroll credit or adjustment posted to a PilotAccount when a report is approved
  - fields: txn_id, pilot_telegram_id, flight_id, amount_eur (decimal), hours_credited (decimal), reason (auto_approval|admin_adjustment), timestamp
- **LuftBankLedger** _(retention: persistent)_ — Aggregate ledger keeping per-pilot totals for balance and hours (single source of truth mirror)
  - fields: pilot_telegram_id, balance_eur, total_hours, last_updated

## Integrations

- **Telegram** (required) — Bot API messaging, callbacks, and group/thread monitoring
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Set ADMIN_CHAT_ID (environment) to receive notifications
- Adjust payroll rate model (per-minute or per-hour coefficients) and rounding policy
- Override or manually approve/reject reports and reassign flight numbers
- Configure time tolerance (default ±10 minutes) and enable/disable auto-approval
- Export ledger or trigger manual recompute of per-pilot balances

## Notifications

- To admin (ADMIN_CHAT_ID): new registration details, duplicate/assignment conflicts, unmatched reports requiring manual review, manual override outcomes
- To pilot: registration confirmation with assigned LHxxx, report match/link confirmation, approval confirmation with salary credited and new balance, rejection or manual-review instructions
- To group (optional): summary messages for approved flights if owner enables public announcements

## Permissions & privacy

- Store Telegram user id, display name, and submitted report media for matching and auditing
- Pilot balances and detailed transaction lists are visible only to the pilot and to ADMIN_CHAT_ID (admins)
- No external payment providers or third-party sharing — payroll stays internal and virtual
- Retention policy: data persisted indefinitely until owner chooses export/cleanup; owner should configure retention if required by regulations

## Edge cases

- Report times provided in a different timezone than scheduled times (timezone must be normalized) — may cause false mismatches
- Two pilots attempt to register the same route at near-simultaneous times causing race on flight-number assignment — require DB-level unique constraint and retry/notify
- Pilot submits a report but their Registered Flight was deleted or already Approved — treat as Unmatched and notify admin
- Multiple potential Registered Flights within tolerance for the same pilot — flag for manual review
- Deleted or edited Telegram messages that remove registration or report content — system must rely on persisted stored entities, not message text only
- Large clock skew or incorrect pilot device time leading to incorrect matching
- Media-only reports without times — mark Unmatched and request structured times

## Required tests

- Dialog-level acceptance test: /register flow assigns a unique LHxxx within the correct region range and persists Flight with status=Registered
- Report matching test: submitting /report with actual times within ±10 minutes links to the correct Registered Flight and sets status=Reported
- Approval + payroll test: when a Report is linked and approved, a Transaction is created, PilotAccount.balance and LuftBank totals increment correctly, and pilot receives confirmation
- Unmatched path test: submitting a report outside tolerance creates an Unmatched Report and sends a manual-review notification to ADMIN_CHAT_ID
- /balance test: /balance returns correct balance, total hours, and recent flights for a pilot with several transactions
- Duplicate registration race test: concurrent registration attempts for same region/slot must not produce duplicate flight numbers; one succeeds and the others are blocked and notified

## Assumptions

- Flight-number ranges by region use the owner's mapping: internal 100–199, Europe 200–499, MENA 500–699, Asia 700–899, N.A. 900–999
- Pilot identity is mapped to Telegram user id (unique) and is sufficient to link Flights, Reports, and PilotAccount
- Times are submitted in an agreed ISO format and must be normalized to a single timezone (UTC recommended) unless owner configures otherwise
- Default matching tolerance is ±10 minutes unless owner updates via owner_controls
- Salary is calculated from flight duration using a configurable per-hour (or per-minute) rate — specific rates not provided in brief
