-- Life RPG: Oro, Tienda (recompensas y Wishlist), Objetivos mensuales y Cofres por nivel.
-- Pegar completo en SQL Editor y pulsar Run, una sola vez, después de schema.sql.
-- No modifica las tablas activities ni profiles.

-- =================== Tablas ===================

-- Historial de Oro. El saldo es la suma de las filas no borradas.
create table public.coin_transactions (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id          uuid not null,
  amount      integer not null check (amount <> 0 and abs(amount) <= 100000),
  type        text not null check (type in ('earn','spend')),
  source      text not null check (source in ('activity','full_day','streak','goal','level_chest','purchase')),
  source_id   text not null,
  description text not null default '' check (char_length(description) <= 80),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, source, source_id),                 -- una recompensa por origen, siempre
  check ((type = 'earn') = (amount > 0))
);

-- Recompensas de la tienda y deseos de la Wishlist (item_type)
create table public.shop_items (
  id              uuid primary key,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_type       text not null default 'reward' check (item_type in ('reward','wishlist')),
  name            text not null check (char_length(name) between 1 and 40),
  description     text not null default '' check (char_length(description) <= 120),
  price           integer not null check (price between 1 and 1000000),
  icon            text not null default 'gift' check (char_length(icon) <= 16),
  rarity          text not null default 'common' check (rarity in ('common','rare','epic','legendary','mythic')),
  category        text check (char_length(category) <= 30),
  active          boolean not null default true,
  is_primary_goal boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  synced_at       timestamptz not null default now(),
  check (not is_primary_goal or item_type = 'wishlist')
);
-- red de seguridad: como máximo un objetivo principal por usuario
create unique index shop_items_one_primary on public.shop_items (user_id) where is_primary_goal and deleted_at is null;

-- Compras. Solo las escribe buy_reward, con los datos reales de shop_items.
create table public.purchases (
  id           uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  item_id      uuid not null,
  item_type    text not null,
  item_name    text not null,
  item_icon    text not null,
  item_rarity  text not null,
  price        integer not null check (price > 0),
  status       text not null check (status in ('ok','rejected')),
  reason       text check (reason in ('balance','inactive','deleted')),
  purchased_at timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  synced_at    timestamptz not null default now()
);

-- Objetivos mensuales
create table public.monthly_goals (
  id              uuid primary key,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  year            integer not null check (year between 2000 and 2100),
  month           integer not null check (month between 1 and 12),
  title           text not null check (char_length(title) between 1 and 60),
  description     text not null default '' check (char_length(description) <= 120),
  goal_type       text not null check (goal_type in
                    ('activities','xp','minutes','cat_activities','cat_xp','cat_minutes','streak','manual')),
  category        text check (category in ('curso','fisico','cuidado','lectura')),
  target_value    integer not null check (target_value between 1 and 1000000),
  manual_progress integer not null default 0 check (manual_progress >= 0),
  coin_reward     integer not null default 50 check (coin_reward between 0 and 10000),
  completed_at    timestamptz,
  claimed_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  synced_at       timestamptz not null default now(),
  check ((goal_type like 'cat_%') = (category is not null))
);

-- Cofres ABIERTOS. Qué cofres existen y cuáles están desbloqueados se calcula con el nivel.
create table public.level_chests (
  user_id    uuid not null references auth.users(id) on delete cascade,
  level      integer not null check (level in (5,10,15,20,30,40,50)),
  name       text not null,
  gold       integer not null check (gold > 0),
  claimed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default now(),
  primary key (user_id, level)                       -- un cofre por nivel, imposible repetir
);

create index coin_transactions_user_synced on public.coin_transactions (user_id, synced_at);
create index shop_items_user_synced        on public.shop_items (user_id, synced_at);
create index purchases_user_synced         on public.purchases (user_id, synced_at);
create index monthly_goals_user_synced     on public.monthly_goals (user_id, synced_at);
create index level_chests_user_synced      on public.level_chests (user_id, synced_at);

-- =================== Triggers ===================
-- Gana el updated_at más nuevo y se marca synced_at (función creada en schema.sql)
create trigger keep_newest before insert or update on public.coin_transactions for each row execute function public.keep_newest();
create trigger keep_newest before insert or update on public.shop_items       for each row execute function public.keep_newest();
create trigger keep_newest before insert or update on public.purchases        for each row execute function public.keep_newest();
create trigger keep_newest before insert or update on public.monthly_goals    for each row execute function public.keep_newest();
create trigger keep_newest before insert or update on public.level_chests     for each row execute function public.keep_newest();

-- Un objetivo reclamado nunca vuelve a "sin reclamar", aunque llegue una edición vieja
create function public.keep_claimed() returns trigger language plpgsql set search_path = '' as $$
begin
  new.claimed_at := coalesce(old.claimed_at, new.claimed_at);
  return new;
end $$;
create trigger keep_claimed before update on public.monthly_goals for each row execute function public.keep_claimed();

-- Un solo objetivo principal: gana la elección más reciente, aunque llegue de dos dispositivos
create function public.one_primary_goal() returns trigger language plpgsql set search_path = '' as $$
begin
  -- en un upsert sobre una fila existente decide la parte UPDATE, después de keep_newest
  if tg_op = 'INSERT' and exists (select 1 from public.shop_items s where s.id = new.id) then return new; end if;
  if new.is_primary_goal and new.deleted_at is null then
    if exists (select 1 from public.shop_items s where s.user_id = new.user_id and s.id <> new.id
               and s.is_primary_goal and s.deleted_at is null and s.updated_at > new.updated_at) then
      new.is_primary_goal := false;                   -- otro dispositivo eligió después
      new.updated_at := new.updated_at + interval '1 millisecond';  -- así el dispositivo que perdió acepta el cambio
    else
      update public.shop_items s
         set is_primary_goal = false,
             updated_at = greatest(s.updated_at + interval '1 millisecond', new.updated_at)
       where s.user_id = new.user_id and s.id <> new.id and s.is_primary_goal;
    end if;
  end if;
  return new;
end $$;
create trigger one_primary_goal before insert or update on public.shop_items for each row execute function public.one_primary_goal();

-- =================== Reglas del juego que el servidor necesita ===================
-- Cofres estándar (los mismos que define la app en economy.js)
create function public.chest_def(p_level integer, out name text, out gold integer)
language sql immutable set search_path = '' as $$
  select d.name, d.gold from (values
    (5,'Cofre de Iniciado',40), (10,'Cofre de Aventurero',100), (15,'Cofre de Veterano',150),
    (20,'Cofre de Campeón',200), (30,'Cofre de Maestro',300), (40,'Cofre de Gran Maestro',400),
    (50,'Cofre de Leyenda',500)) d(level, name, gold)
  where d.level = p_level
$$;

-- Nivel global con la misma fórmula de game.js: (10 + min(minutos,240)) x intensidad, +50 por día
-- completo (las 4 categorías), 120 XP para el nivel 2 y +40 por cada nivel siguiente
create function public.user_level(p_uid uuid) returns integer language plpgsql stable set search_path = '' as $$
declare xp bigint; lv integer := 1;
begin
  select coalesce(sum(round((10 + least(a.minutes, 240)) * case a.intensity when 1 then 1.0 when 2 then 1.5 else 2.0 end)), 0)
    into xp from public.activities a where a.user_id = p_uid and a.deleted_at is null;
  xp := xp + 50 * (select count(*) from (select a.date from public.activities a
                     where a.user_id = p_uid and a.deleted_at is null
                     group by a.date having count(distinct a.category) = 4) d);
  while xp >= 120 + 40 * (lv - 1) loop xp := xp - (120 + 40 * (lv - 1)); lv := lv + 1; end loop;
  return lv;
end $$;

create function public.gold_balance(p_uid uuid) returns bigint language sql stable set search_path = '' as $$
  select coalesce(sum(amount), 0) from public.coin_transactions where user_id = p_uid and deleted_at is null
$$;

-- =================== Comprar ===================
-- La app manda solo ids y hora. Precio, nombre, ícono y rareza salen de shop_items.
-- Devuelve: ok | rejected:balance | rejected:inactive | rejected:deleted | not_found
create function public.buy_reward(p_id uuid, p_item uuid, p_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); it public.shop_items; p public.purchases; why text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));       -- una operación de Oro a la vez
  select * into p from public.purchases where id = p_id and user_id = uid;
  if found then return p.status || coalesce(':' || p.reason, ''); end if;   -- doble clic o reenvío
  select * into it from public.shop_items where id = p_item and user_id = uid for update;
  if not found then return 'not_found'; end if;                      -- no se guarda nada
  why := case when it.deleted_at is not null then 'deleted'
              when not it.active then 'inactive'
              when public.gold_balance(uid) < it.price then 'balance' end;   -- nunca saldo negativo
  insert into public.purchases (id, user_id, item_id, item_type, item_name, item_icon, item_rarity,
                                price, status, reason, purchased_at, created_at, updated_at)
    values (p_id, uid, it.id, it.item_type, it.name, it.icon, it.rarity,
            it.price, case when why is null then 'ok' else 'rejected' end, why,
            least(p_at, now()), now(), now());
  if why is not null then return 'rejected:' || why; end if;
  insert into public.coin_transactions (user_id, id, amount, type, source, source_id, description, created_at, updated_at)
    values (uid, p_id, -it.price, 'spend', 'purchase', p_id::text, left(it.name, 80), least(p_at, now()), now());
  if it.item_type = 'wishlist' then                                  -- deseo cumplido
    update public.shop_items set active = false, is_primary_goal = false, updated_at = greatest(now(), it.updated_at + interval '1 millisecond') where id = it.id;
  end if;
  return 'ok';
end $$;

-- =================== Reclamar objetivo ===================
-- Devuelve: ok | already | not_found | not_completed
create function public.claim_goal(p_goal uuid, p_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); g public.monthly_goals;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into g from public.monthly_goals where id = p_goal and user_id = uid and deleted_at is null for update;
  if not found then return 'not_found'; end if;
  if g.claimed_at is not null then return 'already'; end if;
  if g.completed_at is null then return 'not_completed'; end if;
  if g.coin_reward > 0 then
    insert into public.coin_transactions (user_id, id, amount, type, source, source_id, description, created_at, updated_at)
      values (uid, g.id, g.coin_reward, 'earn', 'goal', g.id::text, left('Objetivo: ' || g.title, 80), least(p_at, now()), now())
      on conflict do nothing;
  end if;
  update public.monthly_goals set claimed_at = least(p_at, now()), updated_at = greatest(now(), g.updated_at + interval '1 millisecond') where id = g.id;
  return 'ok';
end $$;

-- =================== Abrir cofre ===================
-- Devuelve: ok | already | not_reached | invalid
create function public.open_chest(p_level integer, p_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); d record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into d from public.chest_def(p_level);
  if d.gold is null then return 'invalid'; end if;
  if exists (select 1 from public.level_chests where user_id = uid and level = p_level) then return 'already'; end if;
  if public.user_level(uid) < p_level then return 'not_reached'; end if;
  insert into public.level_chests (user_id, level, name, gold, claimed_at, created_at, updated_at)
    values (uid, p_level, d.name, d.gold, least(p_at, now()), now(), now());
  insert into public.coin_transactions (user_id, id, amount, type, source, source_id, description, created_at, updated_at)
    values (uid, md5('level_chest:' || p_level)::uuid, d.gold, 'earn', 'level_chest', p_level::text, d.name, least(p_at, now()), now());
  return 'ok';
end $$;

-- =================== Permisos ===================
revoke all on public.coin_transactions, public.shop_items, public.purchases, public.monthly_goals, public.level_chests from anon;
grant select, insert, update on public.coin_transactions, public.shop_items, public.monthly_goals to authenticated;
grant select on public.purchases, public.level_chests to authenticated;          -- se escriben solo por funciones
revoke execute on function public.user_level(uuid), public.gold_balance(uuid), public.chest_def(integer) from public, anon, authenticated;
revoke execute on function public.buy_reward(uuid, uuid, timestamptz), public.claim_goal(uuid, timestamptz), public.open_chest(integer, timestamptz) from public, anon;
grant  execute on function public.buy_reward(uuid, uuid, timestamptz), public.claim_goal(uuid, timestamptz), public.open_chest(integer, timestamptz) to authenticated;

-- =================== RLS: cada usuario solo ve y cambia lo suyo ===================
alter table public.coin_transactions enable row level security;
alter table public.shop_items        enable row level security;
alter table public.purchases         enable row level security;
alter table public.monthly_goals     enable row level security;
alter table public.level_chests      enable row level security;

create policy own_select on public.coin_transactions for select to authenticated using (user_id = (select auth.uid()));
-- la app solo escribe el Oro derivado de actividades; gastos, objetivos y cofres van por las funciones
create policy own_insert on public.coin_transactions for insert to authenticated
  with check (user_id = (select auth.uid()) and source in ('activity','full_day','streak'));
create policy own_update on public.coin_transactions for update to authenticated
  using      (user_id = (select auth.uid()) and source in ('activity','full_day','streak'))
  with check (user_id = (select auth.uid()) and source in ('activity','full_day','streak'));

create policy own_select on public.shop_items for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.shop_items for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_update on public.shop_items for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy own_select on public.purchases    for select to authenticated using (user_id = (select auth.uid()));
create policy own_select on public.level_chests for select to authenticated using (user_id = (select auth.uid()));

create policy own_select on public.monthly_goals for select to authenticated using (user_id = (select auth.uid()));
create policy own_insert on public.monthly_goals for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_update on public.monthly_goals for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- =================== Realtime ===================
alter publication supabase_realtime add table
  public.coin_transactions, public.shop_items, public.purchases, public.monthly_goals, public.level_chests;
