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

test('phase 4 capability migration does not activate the HOST_OFFLINE guard', () => {
  assert.doesNotMatch(sql, /create or replace function public\.guard_room_host_liveness/i);
  assert.doesNotMatch(sql, /create trigger rooms_guard_host_liveness/i);
  assert.doesNotMatch(sql, /raise exception 'HOST_OFFLINE'/i);
});

test('phase 4 guard is a separate second-stage migration', async () => {
  const guard = await readFile(new URL('../supabase-phase4-guard.sql', import.meta.url), 'utf8');
  assert.match(guard, /create or replace function public\.guard_room_host_liveness/i);
  assert.match(guard, /before update on public\.rooms/i);
  assert.match(guard, /HOST_OFFLINE/);
  assert.match(guard, /interval '10 seconds'/i);
});
