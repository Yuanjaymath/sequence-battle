# Sequence Battle V5 Room Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate ghost waiting rooms by adding host heartbeat expiry, a two-second Realtime join handshake, shared room Presence topics, and best-effort page-close cancellation.

**Architecture:** Keep the existing GitHub Pages + Supabase architecture. Use a two-stage additive database rollout: `supabase-phase4.sql` installs heartbeat capabilities without blocking V4 joins; after the V5 frontend is live and sending heartbeats, `supabase-phase4-guard.sql` activates the waiting-to-playing `HOST_OFFLINE` guard. The frontend drives host heartbeats, live-room listing, join probes, and shared Presence without rewriting the already-working `join_room()` RPC.

**Tech Stack:** HTML5, JavaScript ES modules, Supabase JS v2 Realtime/PostgREST, PostgreSQL PL/pgSQL, Node.js 22 built-in test runner.

**Spec:** `docs/superpowers/specs/2026-08-31-sequence-battle-v5-room-liveness-design.md`

## Global Constraints

- Host heartbeat interval is exactly 3000 ms while seat 1 is on the waiting screen.
- A waiting room is stale after 10 seconds without a host heartbeat.
- Join probe acknowledgement timeout is exactly 2000 ms after the probe channel is subscribed.
- Waiting hosts and players use the shared Realtime topic `game-${roomId}`; Presence key remains each browser's client token.
- `pagehide` cancellation is best effort only; heartbeat expiry remains the reliability backstop.
- With the current `sb_publishable_...` key, direct REST keepalive requests put the key in the `apikey` header and do not send it as `Authorization: Bearer`.
- Do not rewrite the existing `create_room()`, `join_room()`, `cancel_room()`, or `resolve_answer()` functions.
- Expired rooms are soft-finished, not hard-deleted.
- Direct anonymous access to `room_heartbeats` is not allowed; anonymous clients use security-definer RPCs.
- Preserve the V4 gameplay layout, Unicode subscripts, cancel-room button, result presentation, sword/laser effects, and designer credit.
- `supabase-phase4.sql` MUST NOT create or activate the `HOST_OFFLINE` guard trigger.
- `supabase-phase4-guard.sql` is executed only after the V5 frontend is deployed and verified to be sending heartbeat.

---

## File Map

- `supabase-phase4.sql` — first-stage additive heartbeat table, heartbeat initialization trigger, `heartbeat_room()`, and `list_live_rooms()`; safe to install while V4 is still live.
- `supabase-phase4-guard.sql` — second-stage waiting-to-playing liveness guard; run only after V5 frontend deployment.
- `app.js` — host heartbeat lifecycle, live-room lobby refresh scheduling, 2-second join probe/ack, shared Presence topic, `HOST_OFFLINE` UX, and best-effort `pagehide` cancellation.
- `tests/sql-phase4-contract.test.mjs` — static migration safety contract, including two-stage deployment separation.
- `tests/ui-contract.test.mjs` — static client integration contract for heartbeat, probe, pagehide, live-room RPC, and shared topic.
- `.github/workflows/v4-tests.yml` — existing PR CI runs all Node tests and syntax checks on pull requests targeting `main`.

---

## Implemented TDD Tasks

### Task 1: First-stage heartbeat capability migration

- Create `room_heartbeats` with RLS and no anonymous direct table access.
- Initialize heartbeat rows for new rooms and seed current waiting rooms.
- Add secure `heartbeat_room(room_id, client_token)` RPC.
- Add secure `list_live_rooms()` RPC that soft-finishes stale waiting rooms and returns server-computed TTL.
- Verify `supabase-phase4.sql` contains no guard function, guard trigger, or `raise exception 'HOST_OFFLINE'`.

### Task 2: Live lobby and host heartbeat

- `loadLobby()` consumes `list_live_rooms()` rather than a direct `rooms` waiting query.
- Waiting host sends heartbeat every 3000 ms.
- Lobby schedules refresh at the earliest returned room TTL instead of polling continuously.
- Heartbeat and lobby expiry timers are stopped on screen/lifecycle transitions.

### Task 3: Two-second join probe and shared Presence

- `confirmHostOnline(roomId)` subscribes to `game-${roomId}`, sends `join_probe`, and waits at most 2000 ms for matching `host_ack`.
- `joinRoom()` calls `join_room` only after probe success.
- Host waiting channel replies to probes only while seat 1 is actually waiting.
- Persistent game Presence uses shared `game-${roomId}` topic and per-client Presence key.
- Friendly `HOST_OFFLINE` error maps to `房主已離開，請選其他房間。`.

### Task 4: Best-effort page exit cancellation

- Waiting seat 1 listens for `pagehide`.
- Sends direct `POST /rest/v1/rpc/cancel_room` with `keepalive: true` and `apikey` header.
- No `visibilitychange` cancellation is used.

### Task 5: Second-stage database guard

- `supabase-phase4-guard.sql` defines `guard_room_host_liveness()`.
- Trigger runs before `rooms` update from waiting toward playing / player_count 2.
- Missing or older-than-10-second heartbeat raises `HOST_OFFLINE`.
- Trigger function execute privilege is revoked from public/anon/authenticated; the database trigger itself invokes it.
- Migration is idempotent via `drop trigger if exists` then `create trigger`.

---

## Verification

Run:

```bash
node --test tests/*.test.mjs
node --check game-logic.js
node --check app.js
```

Then run the same unique HTML ID check used by CI. Expected: zero failures and no duplicate IDs.

Current local verification after the two-stage deployment adjustment: 26 tests passed, 0 failed; JavaScript syntax checks passed; 55 HTML IDs are unique.

---

## Safe Deployment Order

Use this exact order:

```text
1. Run supabase-phase4.sql in Supabase SQL Editor and confirm Success.
   - This installs heartbeat capabilities only.
   - It does NOT activate HOST_OFFLINE and therefore does not block V4 joining.

2. Confirm PR CI is green, then merge V5 PR to main.

3. Wait for GitHub Pages to serve the V5 frontend.

4. On the public URL, verify a host can wait >20 seconds and still be joinable,
   and verify the host browser is sending heartbeat / live-room behavior works.

5. Run supabase-phase4-guard.sql in Supabase SQL Editor and confirm Success.

6. Run the final two-device lifecycle matrix:
   A. Host remains waiting >20s -> room stays live.
   B. Host closes normally -> disappears immediately when pagehide succeeds, otherwise about 10s.
   C. Host is force-killed/offline -> disappears after about 10s.
   D. Guest clicks during stale <10s window -> 2s probe fails and guest stays in lobby.
   E. Online host + guest -> joins normally.
   F. Playing opponent disconnects -> shared Presence detects it after existing ~5s grace.
   G. Direct/manual stale join attempt -> DB guard returns HOST_OFFLINE and rolls back.
```

The temporary interval between steps 3 and 5 already has frontend probe + heartbeat protections; the final guard is intentionally delayed to preserve compatibility during rollout.
