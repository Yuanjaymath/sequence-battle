-- =========================================================
-- 等差數列即時對戰：第四階段第二步 DB guard
-- 執行時機：V5 前端已部署並開始送 heartbeat 後再執行
-- 功能：阻止 stale host 的 waiting room 轉入 playing
-- =========================================================

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

revoke execute on function public.guard_room_host_liveness()
from public, anon, authenticated;

drop trigger if exists rooms_guard_host_liveness on public.rooms;
create trigger rooms_guard_host_liveness
before update on public.rooms
for each row execute function public.guard_room_host_liveness();
