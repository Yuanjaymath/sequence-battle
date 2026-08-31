# Sequence Battle V5 Room Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate ghost waiting rooms by adding host heartbeat expiry, a two-second Realtime join handshake, shared room Presence topics, and best-effort page-close cancellation.

**Architecture:** Keep the existing GitHub Pages + Supabase architecture. Add one additive phase-4 migration with an isolated `room_heartbeats` table, secure RPCs, and a waiting-to-playing guard trigger; update `app.js` to drive host heartbeats, live-room listing, join probes, and shared Presence without rewriting the already-working `join_room()` RPC.

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

---

## File Map

- `supabase-phase4.sql` — additive heartbeat table, heartbeat initialization trigger, `heartbeat_room()`, `list_live_rooms()`, and waiting-to-playing liveness guard.
- `app.js` — host heartbeat lifecycle, live-room lobby refresh scheduling, 2-second join probe/ack, shared Presence topic, `HOST_OFFLINE` UX, and best-effort `pagehide` cancellation.
- `tests/sql-phase4-contract.test.mjs` — static migration safety contract.
- `tests/ui-contract.test.mjs` — static client integration contract for heartbeat, probe, pagehide, live-room RPC, and shared topic.
- `.github/workflows/v4-tests.yml` — preserve existing PR CI; no behavior change is required because it already runs on pull requests targeting `main`.

---

### Task 1: Add the phase-4 heartbeat data model and secure RPCs

**Files:**
- Create: `supabase-phase4.sql`
- Create: `tests/sql-phase4-contract.test.mjs`

**Interfaces:**
- Produces table: `public.room_heartbeats(room_id uuid primary key, host_last_seen_at timestamptz, updated_at timestamptz)`
- Produces RPC: `public.heartbeat_room(p_room_id uuid, p_client_token uuid) returns jsonb`
- Produces RPC: `public.list_live_rooms() returns table(id uuid, host_nickname text, status text, player_count integer, created_at timestamptz, host_last_seen_at timestamptz, expires_in_ms bigint)`
- Produces error token: `HOST_OFFLINE`
- Preserves all phase-1 through phase-3 RPC signatures unchanged.

- [ ] **Step 1: Write the failing phase-4 SQL contract test**

Create `tests/sql-phase4-contract.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase-phase4.sql', import.meta.url), 'utf8');

test('phase 4 creates an isolated heartbeat table with no anonymous direct access', () => {
  assert.match(sql, /create table if not exists public\.room_heartbeats/i);
  assert.match(sql, /room_id\s+uuid\s+primary key/i);
  assert.match(sql, /host_last_seen_at\s+timestamptz\s+not null/i);
  assert.match(sql, /alter table public\.room_heartbeats enable row level security/i);
  assert.match(sql, /revoke all on table public\.room_heartbeats from public, anon, authenticated/i);
});

test('phase 4 initializes a heartbeat whenever a room is inserted', () => {
  assert.match(sql, /create or replace function public\.init_room_heartbeat/i);
  assert.match(sql, /after insert on public\.rooms/i);
  assert.match(sql, /insert into public\.room_heartbeats/i);
});

test('heartbeat_room verifies host seat and waiting state', () => {
  assert.match(sql, /create or replace function public\.heartbeat_room/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /NOT_ROOM_HOST/);
  assert.match(sql, /ROOM_ALREADY_STARTED/);
  assert.match(sql, /host_last_seen_at\s*=\s*now\(\)/i);
  assert.match(sql, /grant execute on function public\.heartbeat_room\(uuid, uuid\)/i);
});

test('list_live_rooms soft-finishes stale rooms and returns server TTL', () => {
  assert.match(sql, /create or replace function public\.list_live_rooms/i);
  assert.match(sql, /interval '10 seconds'/i);
  assert.match(sql, /status\s*=\s*'finished'/i);
  assert.match(sql, /expires_in_ms/i);
  assert.match(sql, /grant execute on function public\.list_live_rooms\(\)/i);
});

test('waiting-to-playing guard raises HOST_OFFLINE for stale hosts', () => {
  assert.match(sql, /create or replace function public\.guard_room_host_liveness/i);
  assert.match(sql, /before update on public\.rooms/i);
  assert.match(sql, /HOST_OFFLINE/);
  assert.match(sql, /interval '10 seconds'/i);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test tests/sql-phase4-contract.test.mjs
```

Expected: test process errors because `supabase-phase4.sql` does not exist yet.

- [ ] **Step 3: Implement the heartbeat table and initialization trigger**

Start `supabase-phase4.sql` with:

```sql
create table if not exists public.room_heartbeats (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  host_last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.room_heartbeats enable row level security;
revoke all on table public.room_heartbeats from public, anon, authenticated;

create or replace function public.init_room_heartbeat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.room_heartbeats(room_id, host_last_seen_at, updated_at)
  values (new.id, now(), now())
  on conflict (room_id) do update
    set host_last_seen_at = excluded.host_last_seen_at,
        updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists rooms_init_heartbeat on public.rooms;
create trigger rooms_init_heartbeat
after insert on public.rooms
for each row execute function public.init_room_heartbeat();

insert into public.room_heartbeats(room_id, host_last_seen_at, updated_at)
select id, now(), now()
from public.rooms
where status = 'waiting'
on conflict (room_id) do nothing;
```

This seed gives already-waiting rooms one 10-second grace period when the migration is first run.

- [ ] **Step 4: Implement `heartbeat_room()`**

Append:

```sql
create or replace function public.heartbeat_room(
  p_room_id uuid,
  p_client_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seat smallint;
  v_status text;
begin
  if p_room_id is null or p_client_token is null then
    raise exception 'INVALID_REQUEST';
  end if;

  select p.seat
    into v_seat
  from public.players p
  where p.room_id = p_room_id
    and p.client_token = p_client_token
  limit 1;

  if not found then raise exception 'PLAYER_NOT_IN_ROOM'; end if;
  if v_seat <> 1 then raise exception 'NOT_ROOM_HOST'; end if;

  select r.status::text
    into v_status
  from public.rooms r
  where r.id = p_room_id
  for update;

  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_status <> 'waiting' then raise exception 'ROOM_ALREADY_STARTED'; end if;

  insert into public.room_heartbeats(room_id, host_last_seen_at, updated_at)
  values (p_room_id, now(), now())
  on conflict (room_id) do update
    set host_last_seen_at = excluded.host_last_seen_at,
        updated_at = excluded.updated_at;

  return jsonb_build_object('success', true, 'room_id', p_room_id);
end;
$$;

revoke execute on function public.heartbeat_room(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.heartbeat_room(uuid, uuid)
to anon, authenticated;
```

- [ ] **Step 5: Implement `list_live_rooms()` with soft cleanup**

Append:

```sql
create or replace function public.list_live_rooms()
returns table (
  id uuid,
  host_nickname text,
  status text,
  player_count integer,
  created_at timestamptz,
  host_last_seen_at timestamptz,
  expires_in_ms bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
begin
  for v_room_id in
    select r.id
    from public.rooms r
    left join public.room_heartbeats h on h.room_id = r.id
    where r.status = 'waiting'
      and (
        h.room_id is null
        or h.host_last_seen_at < now() - interval '10 seconds'
      )
    for update of r
  loop
    update public.game_state gs
    set status = 'finished',
        finished_at = coalesce(gs.finished_at, now()),
        updated_at = now()
    where gs.room_id = v_room_id
      and gs.status = 'waiting';

    update public.rooms r
    set status = 'finished',
        updated_at = now(),
        last_activity_at = now()
    where r.id = v_room_id
      and r.status = 'waiting';
  end loop;

  return query
  select
    r.id,
    r.host_nickname::text,
    r.status::text,
    r.player_count::integer,
    r.created_at,
    h.host_last_seen_at,
    greatest(
      0,
      floor(extract(epoch from ((h.host_last_seen_at + interval '10 seconds') - now())) * 1000)::bigint
    ) as expires_in_ms
  from public.rooms r
  join public.room_heartbeats h on h.room_id = r.id
  where r.status = 'waiting'
    and h.host_last_seen_at >= now() - interval '10 seconds'
  order by r.created_at asc;
end;
$$;

revoke execute on function public.list_live_rooms()
from public, anon, authenticated;

grant execute on function public.list_live_rooms()
to anon, authenticated;
```

- [ ] **Step 6: Implement the waiting-to-playing guard trigger**

Append:

```sql
create or replace function public.guard_room_host_liveness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_seen timestamptz;
begin
  if old.status = 'waiting'
     and (
       new.status = 'playing'
       or (coalesce(old.player_count, 0) < 2 and coalesce(new.player_count, 0) >= 2)
     ) then
    select h.host_last_seen_at
      into v_last_seen
    from public.room_heartbeats h
    where h.room_id = old.id;

    if v_last_seen is null
       or v_last_seen < now() - interval '10 seconds' then
      raise exception 'HOST_OFFLINE';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists rooms_guard_host_liveness on public.rooms;
create trigger rooms_guard_host_liveness
before update on public.rooms
for each row execute function public.guard_room_host_liveness();
```

- [ ] **Step 7: Run phase-4 and existing SQL tests and verify GREEN**

Run:

```bash
node --test tests/sql-phase4-contract.test.mjs tests/sql-contract.test.mjs
```

Expected: all SQL contract tests pass.

- [ ] **Step 8: Commit Task 1**

```bash
git add supabase-phase4.sql tests/sql-phase4-contract.test.mjs
git commit -m "feat: add room heartbeat lifecycle migration"
```

---

### Task 2: Make the lobby consume live-room TTLs and drive host heartbeats

**Files:**
- Modify: `app.js`
- Modify: `tests/ui-contract.test.mjs`

**Interfaces:**
- Consumes RPC: `list_live_rooms()` from Task 1.
- Consumes RPC: `heartbeat_room(uuid, uuid)` from Task 1.
- Produces constant: `HOST_HEARTBEAT_INTERVAL_MS = 3000`.
- Produces functions: `startHostHeartbeat()`, `stopHostHeartbeat()`, `scheduleLobbyExpiryRefresh(rooms)`, `clearLobbyExpiryRefresh()`.

- [ ] **Step 1: Add failing UI contract tests for live-room listing and heartbeat cadence**

Append to `tests/ui-contract.test.mjs`:

```js
test('lobby uses live-room RPC and schedules TTL refresh', () => {
  assert.match(app, /rpc\('list_live_rooms'\)/);
  assert.match(app, /expires_in_ms/);
  assert.match(app, /scheduleLobbyExpiryRefresh/);
  assert.doesNotMatch(app, /from\('rooms'\)\.select\('id,host_nickname,status,player_count,created_at'\)\.eq\('status','waiting'\)/);
});

test('host waiting screen sends heartbeat every three seconds', () => {
  assert.match(app, /HOST_HEARTBEAT_INTERVAL_MS\s*=\s*3000/);
  assert.match(app, /rpc\('heartbeat_room'/);
  assert.match(app, /startHostHeartbeat/);
  assert.match(app, /stopHostHeartbeat/);
  assert.match(app, /setInterval\([\s\S]*HOST_HEARTBEAT_INTERVAL_MS/);
});
```

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```bash
node --test tests/ui-contract.test.mjs
```

Expected: the new tests fail because `list_live_rooms`, heartbeat timer functions, and constants are missing.

- [ ] **Step 3: Add timer state and cleanup helpers**

Near the existing constants/state in `app.js`, add:

```js
const HOST_HEARTBEAT_INTERVAL_MS=3000;
const LOBBY_EXPIRY_PADDING_MS=150;
let hostHeartbeatTimer=null,lobbyExpiryTimer=null;

function stopHostHeartbeat(){
  clearInterval(hostHeartbeatTimer);
  hostHeartbeatTimer=null;
}

function clearLobbyExpiryRefresh(){
  clearTimeout(lobbyExpiryTimer);
  lobbyExpiryTimer=null;
}

function scheduleLobbyExpiryRefresh(rooms){
  clearLobbyExpiryRefresh();
  const ttls=(rooms||[])
    .map(room=>Number(room?.expires_in_ms))
    .filter(value=>Number.isFinite(value)&&value>=0);
  if(!ttls.length||currentScreen!=='lobby')return;
  const delay=Math.max(250,Math.min(...ttls)+LOBBY_EXPIRY_PADDING_MS);
  lobbyExpiryTimer=setTimeout(()=>{
    lobbyExpiryTimer=null;
    if(currentScreen==='lobby')loadLobby();
  },delay);
}
```

- [ ] **Step 4: Change `loadLobby()` to `list_live_rooms()`**

Replace the direct `rooms` SELECT with:

```js
const{data,error}=await supabaseClient.rpc('list_live_rooms');
roomsList.setAttribute('aria-busy','false');
if(error){
  clearLobbyExpiryRefresh();
  roomsList.innerHTML='<div class="empty-state">目前讀不到遊戲大廳，請按重新整理再試。</div>';
  showMessage(friendlyError(error,'遊戲大廳讀取失敗。'),'bad');
  return;
}
const rooms=Array.isArray(data)?data:[];
renderRooms(rooms);
scheduleLobbyExpiryRefresh(rooms);
```

Keep `renderRooms()` using `room.id`, `room.host_nickname`, and `room.player_count`.

- [ ] **Step 5: Implement host heartbeat lifecycle**

Add:

```js
async function sendHostHeartbeat(){
  if(!supabaseClient||currentSeat!==1||currentScreen!=='waiting'||!currentRoomId)return;
  const{error}=await supabaseClient.rpc('heartbeat_room',{
    p_room_id:currentRoomId,
    p_client_token:getClientToken(),
  });
  if(error&&!String(error?.message||error).includes('ROOM_ALREADY_STARTED')){
    console.warn('Host heartbeat failed:',error);
  }
}

function startHostHeartbeat(){
  stopHostHeartbeat();
  if(currentSeat!==1||currentScreen!=='waiting'||!currentRoomId)return;
  void sendHostHeartbeat();
  hostHeartbeatTimer=setInterval(()=>void sendHostHeartbeat(),HOST_HEARTBEAT_INTERVAL_MS);
}
```

- [ ] **Step 6: Wire heartbeat and lobby-expiry cleanup to screen transitions**

Apply these exact lifecycle rules:

```js
async function enterLobby(){
  stopHostHeartbeat();
  clearLobbyExpiryRefresh();
  // existing reset and channel cleanup continues here
}

async function returnToInitial(){
  stopHostHeartbeat();
  clearLobbyExpiryRefresh();
  // existing cleanup continues here
}
```

In `createRoom()`, after `setScreen('waiting')`, call:

```js
startHostHeartbeat();
```

In the existing game-state transition that handles `state.status === 'playing'`, call:

```js
stopHostHeartbeat();
```

before presenting the matched/battle state.

In successful `cancelCurrentRoom()`, `enterLobby()` already stops the timer; no duplicate cleanup is needed.

- [ ] **Step 7: Run UI tests and verify GREEN**

Run:

```bash
node --test tests/ui-contract.test.mjs
```

Expected: all current and new UI contract tests pass.

- [ ] **Step 8: Commit Task 2**

```bash
git add app.js tests/ui-contract.test.mjs
git commit -m "feat: add host heartbeat and live lobby expiry"
```

---

### Task 3: Add the 2-second join probe and shared room Realtime topic

**Files:**
- Modify: `app.js`
- Modify: `tests/ui-contract.test.mjs`

**Interfaces:**
- Produces constant: `JOIN_PROBE_TIMEOUT_MS = 2000`.
- Produces function: `confirmHostOnline(roomId): Promise<boolean>`.
- Reuses shared topic: ``game-${roomId}`` for temporary probe and persistent game channel.
- Broadcast events: `join_probe` and `host_ack` with payload `{ probe_id: string }`.

- [ ] **Step 1: Add failing probe/shared-topic tests**

Append:

```js
test('join waits for a two-second host acknowledgement before join_room', () => {
  assert.match(app, /JOIN_PROBE_TIMEOUT_MS\s*=\s*2000/);
  assert.match(app, /confirmHostOnline/);
  assert.match(app, /event:'join_probe'/);
  assert.match(app, /event:'host_ack'/);
  const joinStart=app.indexOf('async function joinRoom');
  const joinEnd=app.indexOf('async function cancelCurrentRoom',joinStart);
  const joinBody=app.slice(joinStart,joinEnd);
  assert.ok(joinBody.indexOf('confirmHostOnline') < joinBody.indexOf("rpc('join_room'"));
});

test('persistent game Presence uses one shared topic per room', () => {
  assert.match(app, /channel\(`game-\$\{roomId\}`/);
  assert.doesNotMatch(app, /game-\$\{roomId\}-\$\{getClientToken\(\)\}/);
  assert.match(app, /presence:\{key:getClientToken\(\)\}/);
});
```

- [ ] **Step 2: Run UI tests and verify RED**

```bash
node --test tests/ui-contract.test.mjs
```

Expected: the new tests fail because probe logic is absent and the old token-suffixed topic still exists.

- [ ] **Step 3: Add probe constants and ID helper**

Add near existing constants:

```js
const JOIN_PROBE_TIMEOUT_MS=2000;

function makeProbeId(){
  return typeof crypto.randomUUID==='function'
    ? crypto.randomUUID()
    : fallbackUuid();
}
```

- [ ] **Step 4: Implement `confirmHostOnline(roomId)`**

Add before `joinRoom()`:

```js
async function confirmHostOnline(roomId){
  if(!supabaseClient||!roomId)return false;
  const probeId=makeProbeId();
  const channel=supabaseClient.channel(`game-${roomId}`);

  return await new Promise(resolve=>{
    let settled=false;
    let timeoutId=null;

    const finish=async result=>{
      if(settled)return;
      settled=true;
      clearTimeout(timeoutId);
      try{await removeChannel(channel)}finally{resolve(result)}
    };

    channel
      .on('broadcast',{event:'host_ack'},({payload})=>{
        if(payload?.probe_id===probeId)void finish(true);
      })
      .subscribe(async status=>{
        if(status==='SUBSCRIBED'){
          timeoutId=setTimeout(()=>void finish(false),JOIN_PROBE_TIMEOUT_MS);
          const response=await channel.send({
            type:'broadcast',
            event:'join_probe',
            payload:{probe_id:probeId},
          });
          if(response!=='ok'&&response!=='timed out'){
            console.warn('Join probe send result:',response);
          }
        }
        if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
          void finish(false);
        }
      });
  });
}
```

- [ ] **Step 5: Gate `joinRoom()` on the probe**

At the beginning of the existing `try` block, replace the initial join message with:

```js
showMessage('正在確認房主在線…');
const hostOnline=await confirmHostOnline(roomId);
if(!hostOnline){
  showMessage('房主已離開，請選其他房間。','bad');
  setScreen('lobby');
  await subscribeLobby();
  await loadLobby();
  return;
}
showMessage('房主在線，正在加入房間…','good');
```

Only after this block should the existing `supabaseClient.rpc('join_room', ...)` execute.

- [ ] **Step 6: Make `watchGameState()` use the shared topic and answer probes while the host waits**

Refactor the channel creation to a local variable so the broadcast callback never depends on a later global reassignment:

```js
const channel=supabaseClient.channel(`game-${roomId}`,{
  config:{presence:{key:getClientToken()}},
});
gameChannel=channel;

channel
  .on('postgres_changes',{event:'UPDATE',schema:'public',table:'game_state',filter:`room_id=eq.${roomId}`},payload=>handleGameState(payload.new))
  .on('broadcast',{event:'join_probe'},({payload})=>{
    if(currentRoomId!==roomId||currentSeat!==1||currentScreen!=='waiting'||!payload?.probe_id)return;
    void channel.send({
      type:'broadcast',
      event:'host_ack',
      payload:{probe_id:payload.probe_id},
    });
  })
  .on('presence',{event:'sync'},handlePresenceSync)
  .on('presence',{event:'join'},handlePresenceSync)
  .on('presence',{event:'leave'},handlePresenceSync)
  .subscribe(async status=>{
    if(status==='SUBSCRIBED'){
      setConnectionStatus('房間即時連線中','good');
      await channel.track({seat:currentSeat,nickname,online_at:new Date().toISOString()});
      await fetchGameState(roomId);
      handlePresenceSync();
    }
    if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
      setConnectionStatus('房間即時連線異常','bad');
    }
  });
```

Keep the final `await fetchGameState(roomId)` already performed by `watchGameState()`.

- [ ] **Step 7: Add `HOST_OFFLINE` friendly error mapping**

Inside `friendlyError()` before the generic fallback, add:

```js
if(raw.includes('HOST_OFFLINE'))return'房主已離開，請選其他房間。';
```

The existing `joinRoom()` catch path already returns to lobby and reloads rooms, so the database guard race is handled without a new screen.

- [ ] **Step 8: Run UI tests and full Node suite**

Run:

```bash
node --test tests/*.test.mjs
```

Expected: all tests pass.

- [ ] **Step 9: Commit Task 3**

```bash
git add app.js tests/ui-contract.test.mjs
git commit -m "feat: confirm host presence before joining"
```

---

### Task 4: Add best-effort immediate cancellation on `pagehide`

**Files:**
- Modify: `app.js`
- Modify: `tests/ui-contract.test.mjs`

**Interfaces:**
- Produces function: `cancelWaitingRoomOnPageHide()`.
- Direct endpoint: `${SUPABASE_URL}/rest/v1/rpc/cancel_room`.
- Request headers: `apikey: SUPABASE_PUBLISHABLE_KEY` and `Content-Type: application/json`.
- Request body: `{ p_room_id: currentRoomId, p_client_token: getClientToken() }`.

- [ ] **Step 1: Add a failing pagehide contract test**

Append:

```js
test('waiting host pagehide sends best-effort keepalive cancel request', () => {
  assert.match(app, /addEventListener\('pagehide'/);
  assert.match(app, /rest\/v1\/rpc\/cancel_room/);
  assert.match(app, /keepalive:true/);
  assert.match(app, /apikey:SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(app, /Authorization:\s*`Bearer \$\{SUPABASE_PUBLISHABLE_KEY\}`/);
  assert.match(app, /currentSeat!==1\|\|currentScreen!=='waiting'\|\|!currentRoomId/);
});
```

- [ ] **Step 2: Run UI tests and verify RED**

```bash
node --test tests/ui-contract.test.mjs
```

Expected: the new test fails because no `pagehide` cancellation exists.

- [ ] **Step 3: Implement the keepalive cancellation**

Add near initialization/event bindings:

```js
function cancelWaitingRoomOnPageHide(){
  if(currentSeat!==1||currentScreen!=='waiting'||!currentRoomId)return;
  const payload=JSON.stringify({
    p_room_id:currentRoomId,
    p_client_token:getClientToken(),
  });
  void fetch(`${SUPABASE_URL}/rest/v1/rpc/cancel_room`,{
    method:'POST',
    headers:{
      apikey:SUPABASE_PUBLISHABLE_KEY,
      'Content-Type':'application/json',
    },
    body:payload,
    keepalive:true,
  }).catch(()=>{});
}

window.addEventListener('pagehide',cancelWaitingRoomOnPageHide);
```

Do not use `visibilitychange`; switching tabs must not cancel a waiting room.

- [ ] **Step 4: Run UI tests and verify GREEN**

```bash
node --test tests/ui-contract.test.mjs
```

Expected: all UI contract tests pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add app.js tests/ui-contract.test.mjs
git commit -m "feat: cancel waiting room on page exit"
```

---

### Task 5: Integrated regression verification and deployment handoff

**Files:**
- Verify: `app.js`
- Verify: `index.html`
- Verify: `game-logic.js`
- Verify: `supabase-phase3.sql`
- Verify: `supabase-phase4.sql`
- Verify: `tests/*.test.mjs`
- Verify: `.github/workflows/v4-tests.yml`

**Interfaces:**
- No new interfaces. This task proves the assembled V5 behavior and prepares the phase-4 SQL handoff.

- [ ] **Step 1: Run the full automated suite**

```bash
node --test tests/*.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Run JavaScript syntax checks**

```bash
node --check game-logic.js
node --check app.js
```

Expected: both commands exit 0.

- [ ] **Step 3: Re-run HTML ID uniqueness check used by CI**

```bash
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
const html = await readFile('index.html', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
if (duplicates.length) {
  console.error('Duplicate ids:', duplicates.join(', '));
  process.exit(1);
}
console.log(`Unique ids: ${ids.length}`);
NODE
```

Expected: no duplicate IDs.

- [ ] **Step 4: Perform the browser lifecycle matrix with two browser profiles or real devices**

Verify these exact scenarios after `supabase-phase4.sql` has been run in Supabase:

```text
A. Host A creates a room and remains waiting for >20 seconds.
   Expected: room remains visible; heartbeat keeps it alive.

B. Host A closes the tab normally while waiting.
   Expected: room disappears immediately when pagehide REST succeeds, otherwise within about 10 seconds.

C. Host A loses network / browser is force-killed while waiting.
   Expected: room disappears after heartbeat expiry, around the 10-second threshold.

D. B clicks Join during the <10-second stale window after A disappears.
   Expected: UI says "正在確認房主在線…" then within about 2 seconds says "房主已離開，請選其他房間。"; join_room is not called.

E. A is online and B clicks Join.
   Expected: host_ack arrives, join_room succeeds, both enter playing normally.

F. A acknowledges B then immediately disconnects after playing begins.
   Expected: shared Presence detects seat 1 missing; existing ~5-second grace shows opponent disconnect handling.

G. A malicious/manual client bypasses the probe and calls join_room against a stale room.
   Expected: database trigger raises HOST_OFFLINE and transaction rolls back.
```

- [ ] **Step 5: Create the implementation pull request against `main`**

Use a feature branch created from the approved design branch, for example `feature/sequence-battle-v5-heartbeat`. PR body must explicitly state that `supabase-phase4.sql` must be executed once before the heartbeat UI is expected to work.

- [ ] **Step 6: Confirm GitHub Actions on the PR**

The existing workflow runs on `pull_request` targeting `main`. Verify the run conclusion is `success`; if it fails, inspect job logs and fix before offering merge.

- [ ] **Step 7: Review the PR diff before merge**

Expected production changes are limited to:

```text
app.js
supabase-phase4.sql
tests/sql-phase4-contract.test.mjs
tests/ui-contract.test.mjs
```

The design/spec/plan docs may also appear if the feature branch is based on the design branch. No phase-1 through phase-3 SQL file should be edited.

- [ ] **Step 8: Deployment order**

Use this order to avoid exposing a frontend that calls missing RPCs:

```text
1. User runs supabase-phase4.sql in Supabase SQL Editor and sees Success.
2. Run the database/manual lifecycle smoke checks.
3. Merge the V5 PR to main.
4. Wait for GitHub Pages deployment.
5. Run the two-device browser lifecycle matrix once more on the public URL.
```

This order keeps the current V4 site functional while the new database objects are installed; phase 4 is additive and does not change existing RPC signatures.
