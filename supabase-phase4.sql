-- =========================================================
-- 等差數列即時對戰：第四階段房間在線生命週期
-- 功能：房主 heartbeat、過期等待房清理、加入前 DB 防線
-- =========================================================

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
    set host_last_seen_at = now(),
        updated_at = now();

  return jsonb_build_object('success', true, 'room_id', p_room_id);
end;
$$;

revoke execute on function public.heartbeat_room(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.heartbeat_room(uuid, uuid)
to anon, authenticated;

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
