-- =========================================================
-- 等差數列即時對戰：第二階段 RPC
-- 功能：答對攻擊對手、答錯自損、7 滴血、分數、勝負與事件同步
-- =========================================================

create or replace function public.resolve_answer(
  p_room_id uuid,
  p_client_token uuid,
  p_is_correct boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seat smallint;
  v_status text;
  v_p1_hp smallint;
  v_p2_hp smallint;
  v_p1_score integer;
  v_p2_score integer;
  v_winner smallint;
  v_event_type text;
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

  select status, player1_hp, player2_hp, player1_score, player2_score
    into v_status, v_p1_hp, v_p2_hp, v_p1_score, v_p2_score
  from public.game_state
  where room_id = p_room_id
  for update;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  if v_status <> 'playing' then
    raise exception 'GAME_NOT_PLAYING';
  end if;

  if p_is_correct then
    v_event_type := 'hit';
    if v_seat = 1 then
      v_p2_hp := greatest(0, v_p2_hp - 1);
      v_p1_score := v_p1_score + 1;
    else
      v_p1_hp := greatest(0, v_p1_hp - 1);
      v_p2_score := v_p2_score + 1;
    end if;
  else
    v_event_type := 'self_hit';
    if v_seat = 1 then
      v_p1_hp := greatest(0, v_p1_hp - 1);
    else
      v_p2_hp := greatest(0, v_p2_hp - 1);
    end if;
  end if;

  v_winner := null;
  if v_p1_hp = 0 then
    v_winner := 2;
  elsif v_p2_hp = 0 then
    v_winner := 1;
  end if;

  update public.game_state
  set
    player1_hp = v_p1_hp,
    player2_hp = v_p2_hp,
    player1_score = v_p1_score,
    player2_score = v_p2_score,
    last_event_id = last_event_id + 1,
    last_event_type = v_event_type,
    last_event_seat = v_seat,
    winner_seat = v_winner,
    status = case when v_winner is null then 'playing' else 'finished' end,
    finished_at = case when v_winner is null then null else now() end,
    updated_at = now()
  where room_id = p_room_id;

  if v_winner is not null then
    update public.rooms
    set
      status = 'finished',
      updated_at = now(),
      last_activity_at = now()
    where id = p_room_id;
  else
    update public.rooms
    set
      updated_at = now(),
      last_activity_at = now()
    where id = p_room_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'seat', v_seat,
    'is_correct', p_is_correct,
    'player1_hp', v_p1_hp,
    'player2_hp', v_p2_hp,
    'player1_score', v_p1_score,
    'player2_score', v_p2_score,
    'winner_seat', v_winner,
    'event_type', v_event_type
  );
end;
$$;

revoke execute on function public.resolve_answer(uuid, uuid, boolean)
from public, anon, authenticated;

grant execute on function public.resolve_answer(uuid, uuid, boolean)
to anon, authenticated;

-- game_state 在第一階段已加入 Realtime publication，因此這裡不重複 add table。
