-- Life RPG: Boss mensual y Perfil avanzado.
-- Pegar completo en SQL Editor y pulsar Run, una sola vez, después de 002_oro_tienda_objetivos_cofres.sql.
-- No borra ni cambia datos: crea la tabla monthly_bosses y agrega columnas nuevas (con valores por defecto) a profiles.

-- =================== Boss mensual ===================
create table public.monthly_bosses (
  id              uuid not null,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  year            integer not null check (year between 2000 and 2100),
  month           integer not null check (month between 1 and 12),
  name            text not null check (char_length(name) between 1 and 60),
  description     text not null default '' check (char_length(description) <= 160),
  boss_type       text not null check (boss_type in
                    ('xp','minutes','activities','cat_xp','cat_minutes','cat_activities','manual')),
  category        text check (category in ('curso','fisico','cuidado','lectura')),
  target_hp       integer not null check (target_hp between 1 and 1000000),
  manual_progress integer not null default 0 check (manual_progress >= 0),
  coin_reward     integer not null default 250 check (coin_reward between 0 and 10000),
  title_reward    text check (char_length(title_reward) <= 40),
  theme           text not null default 'dragon' check (theme in ('dragon','knight','golem','demon','beast','wizard','guardian','shadow')),
  claimed_at      timestamptz,                      -- solo lo escribe claim_boss
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  synced_at       timestamptz not null default now(),
  primary key (user_id, id),
  check ((boss_type like 'cat_%') = (category is not null))
);
-- red de seguridad: un solo Boss vivo por mes
create unique index monthly_bosses_one_per_month on public.monthly_bosses (user_id, year, month) where deleted_at is null;
create index monthly_bosses_user_synced on public.monthly_bosses (user_id, synced_at);

-- Los triggers corren en orden alfabético: keep_newest → protect_boss → single_boss_per_month
create trigger keep_newest before insert or update on public.monthly_bosses for each row execute function public.keep_newest();

-- Funciones internas: en un esquema que la API no publica
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Daño real del Boss, con las actividades guardadas en Supabase (misma fórmula de XP que user_level)
create function private.boss_damage(b public.monthly_bosses) returns integer
language sql stable security definer set search_path = '' as $$
  with a as (
    select x.date, x.category, x.minutes,
           round((10 + least(x.minutes, 240)) * case x.intensity when 1 then 1.0 when 2 then 1.5 else 2.0 end)::int as xp
      from public.activities x
     where x.user_id = b.user_id and x.deleted_at is null
       and (b.user_id = auth.uid() or auth.uid() is null)        -- solo los Bosses propios
       and x.date >= make_date(b.year, b.month, 1)
       and x.date <  (make_date(b.year, b.month, 1) + interval '1 month')::date
  ), full_days as (
    select count(*)::int as n from (select date from a group by date having count(distinct category) = 4) d
  )
  select case b.boss_type
    when 'manual'         then b.manual_progress
    when 'xp'             then coalesce((select sum(xp) from a), 0)::int + 50 * (select n from full_days)
    when 'minutes'        then coalesce((select sum(minutes) from a), 0)::int
    when 'activities'     then (select count(*) from a)::int
    when 'cat_xp'         then coalesce((select sum(xp) from a where category = b.category), 0)::int
    when 'cat_minutes'    then coalesce((select sum(minutes) from a where category = b.category), 0)::int
    when 'cat_activities' then (select count(*) from a where category = b.category)::int
  end
$$;
revoke execute on function private.boss_damage(public.monthly_bosses) from public, anon;
grant execute on function private.boss_damage(public.monthly_bosses) to authenticated;

-- Protección del Boss. Corre con el rol de quien escribe (no es security definer):
-- la app escribe como "authenticated"; claim_boss escribe como el dueño de la función.
-- DERROTADO se decide con la fila guardada (OLD), nunca con lo que manda el dispositivo.
create function public.protect_boss() returns trigger language plpgsql set search_path = '' as $$
declare
  from_client boolean := current_user in ('authenticated', 'anon');
  pushed timestamptz;
begin
  if not from_client then return new; end if;                  -- claim_boss (dueño de la función)

  if tg_op = 'INSERT' then
    new.claimed_at := null;                                     -- nadie crea un Boss ya reclamado
    return new;
  end if;

  pushed := new.updated_at;
  if old.claimed_at is not null then
    -- Reclamado: la fila no cambia nunca más (ni cosmética, ni progreso, ni borrado)
    new := old;
  else
    new.claimed_at := null;                                     -- el cliente no puede ponerlo
    if private.boss_damage(old) >= old.target_hp then
      -- DERROTADO sin reclamar: campos de juego congelados y no se puede borrar.
      -- Nombre, descripción, tema y progreso manual siguen editables.
      new.year := old.year;                 new.month := old.month;
      new.boss_type := old.boss_type;       new.category := old.category;
      new.target_hp := old.target_hp;       new.coin_reward := old.coin_reward;
      new.title_reward := old.title_reward; new.deleted_at := old.deleted_at;
    end if;
  end if;
  -- La versión del servidor queda más nueva que la del dispositivo, así este la acepta al bajarla
  new.updated_at := greatest(pushed, old.updated_at) + interval '1 millisecond';
  new.synced_at := now();
  return new;
end $$;
create trigger protect_boss before insert or update on public.monthly_bosses for each row execute function public.protect_boss();

-- Un solo Boss por mes, aunque dos dispositivos creen uno sin conexión.
-- Si el Boss que ya está guardado para ese mes está DERROTADO o reclamado, se queda él y el nuevo se archiva.
-- Si no, gana el más reciente y el otro se archiva (deleted_at; nunca se borra una fila).
create function public.single_boss_per_month() returns trigger language plpgsql set search_path = '' as $$
declare keeper boolean;
begin
  -- en un upsert sobre una fila existente decide la parte UPDATE
  if tg_op = 'INSERT' and exists (select 1 from public.monthly_bosses b where b.user_id = new.user_id and b.id = new.id) then return new; end if;
  if new.deleted_at is not null then return new; end if;
  select bool_or(b.claimed_at is not null or private.boss_damage(b) >= b.target_hp or b.updated_at > new.updated_at)
    into keeper
    from public.monthly_bosses b
   where b.user_id = new.user_id and b.year = new.year and b.month = new.month and b.id <> new.id and b.deleted_at is null;
  if keeper is null then return new; end if;                    -- no hay otro Boss ese mes
  if keeper then
    new.deleted_at := new.updated_at;                           -- se queda el que ya estaba
    new.updated_at := new.updated_at + interval '1 millisecond';  -- así el dispositivo acepta el cambio
  else
    update public.monthly_bosses b
       set deleted_at = new.updated_at,
           updated_at = greatest(b.updated_at + interval '1 millisecond', new.updated_at)
     where b.user_id = new.user_id and b.year = new.year and b.month = new.month and b.id <> new.id and b.deleted_at is null;
  end if;
  return new;
end $$;
create trigger single_boss_per_month before insert or update on public.monthly_bosses for each row execute function public.single_boss_per_month();

-- =================== Reclamar Boss ===================
-- El daño se recalcula aquí con las actividades del servidor. Paga una sola vez.
-- Devuelve: ok | already | not_found | not_defeated
create function public.claim_boss(p_boss uuid, p_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); b public.monthly_bosses;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));       -- una operación de Oro a la vez
  select * into b from public.monthly_bosses where id = p_boss and user_id = uid and deleted_at is null for update;
  if not found then return 'not_found'; end if;
  if b.claimed_at is not null then return 'already'; end if;          -- doble toque, otro dispositivo o respaldo
  if private.boss_damage(b) < b.target_hp then return 'not_defeated'; end if;
  if b.coin_reward > 0 then
    insert into public.coin_transactions (user_id, id, amount, type, source, source_id, description, created_at, updated_at)
      values (uid, b.id, b.coin_reward, 'earn', 'boss', b.id::text, left('Boss: ' || b.name, 80), least(p_at, now()), now())
      on conflict do nothing;
  end if;
  update public.monthly_bosses set claimed_at = least(p_at, now()), updated_at = greatest(now(), b.updated_at + interval '1 millisecond')
   where user_id = uid and id = b.id;
  return 'ok';
end $$;

-- El Oro de los Bosses solo lo escribe claim_boss (la política de la app sigue permitiendo solo activity, full_day y streak)
alter table public.coin_transactions drop constraint coin_transactions_source_check,
  add constraint coin_transactions_source_check check (source in ('activity','full_day','streak','goal','level_chest','purchase','boss'));

-- =================== Perfil avanzado ===================
-- Columnas nuevas con valor por defecto: los perfiles que ya existen no cambian
alter table public.profiles
  add column avatar_initials text not null default '' check (char_length(avatar_initials) <= 2),
  add column avatar_icon     text not null default 'initials' check (char_length(avatar_icon) <= 16),
  add column avatar_frame    text not null default 'simple' check (char_length(avatar_frame) <= 16),
  add column avatar_bg       text not null default 'violet' check (char_length(avatar_bg) <= 16),
  add column avatar_badge    text not null default 'none' check (char_length(avatar_badge) <= 16),
  add column equipped_title  text not null default '' check (char_length(equipped_title) <= 64),
  add column featured_badges text[] not null default '{}' check (cardinality(featured_badges) <= 3);

-- =================== Permisos y RLS ===================
revoke all on public.monthly_bosses from anon;
grant select, insert, update on public.monthly_bosses to authenticated;   -- sin DELETE: nunca se borra una fila
revoke execute on function public.claim_boss(uuid, timestamptz) from public, anon;
grant execute on function public.claim_boss(uuid, timestamptz) to authenticated;

alter table public.monthly_bosses enable row level security;
create policy own_select on public.monthly_bosses for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.monthly_bosses for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_update on public.monthly_bosses for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- =================== Realtime ===================
alter publication supabase_realtime add table public.monthly_bosses;
