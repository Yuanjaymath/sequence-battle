-- =========================================================
-- 等差數列即時對戰：第三階段 RPC
-- 功能：房主安全取消仍在等待中的房間（軟取消）
-- =========================================================

create or replace function public.cancel_room(
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
  v_room_status text;
begin
  if p_room_id is null or p_client_token is null then
    raise exception 'INVALID_REQUEST';
  end if;

  select seat
    into v_seat
  from public.players
  where room_id = p_room_id
    and client_token = p_client_token
  limit 1;

  if not found then
    raise exception 'PLAYER_NOT_IN_ROOM';
  end if;

  if v_seat <> 1 then
    raise exception 'NOT_ROOM_HOST';
  end if;

  select status
    into v_room_status
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  if v_room_status <> 'waiting' then
    raise exception 'ROOM_ALREADY_STARTED';
  end if;

  perform 1
  from public.game_state
  where room_id = p_room_id
  for update;

  update public.rooms
  set
    status = 'finished',
    updated_at = now(),
    last_activity_at = now()
  where id = p_room_id;

  update public.game_state
  set
    status = 'finished',
    finished_at = now(),
    updated_at = now()
  where room_id = p_room_id;

  return jsonb_build_object(
    'success', true,
    'room_id', p_room_id
  );
end;
$$;

revoke execute on function public.cancel_room(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.cancel_room(uuid, uuid)
to anon, authenticated;
