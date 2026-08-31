import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase-phase3.sql', import.meta.url), 'utf8');

test('cancel_room is security definer and locks waiting room state', () => {
  assert.match(sql, /create or replace function public\.cancel_room/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /NOT_ROOM_HOST/);
  assert.match(sql, /ROOM_ALREADY_STARTED/);
  assert.match(sql, /rooms[\s\S]*status\s*=\s*'finished'/i);
  assert.match(sql, /game_state[\s\S]*status\s*=\s*'finished'/i);
  assert.match(sql, /revoke execute on function public\.cancel_room\(uuid, uuid\)/i);
  assert.match(sql, /grant execute on function public\.cancel_room\(uuid, uuid\)/i);
});
