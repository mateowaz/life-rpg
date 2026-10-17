-- Life RPG: esquema de Supabase (pegar completo en SQL Editor y pulsar Run)

-- Actividades
create table public.activities (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  category    text not null check (category in ('curso','fisico','cuidado','lectura')),
  title       text not null check (char_length(title) between 1 and 80),
  minutes     smallint not null check (minutes between 1 and 240),
  intensity   smallint not null check (intensity between 1 and 3),
  note        text not null default '' check (char_length(note) <= 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  synced_at   timestamptz not null default now()
);
create index activities_user_synced on public.activities (user_id, synced_at);

-- Perfil
create table public.profiles (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default '' check (char_length(name) <= 40),
  motto       text not null default '' check (char_length(motto) <= 80),
  updated_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now()
);

-- Gana la versión más reciente: si llega una más vieja, se ignora
create or replace function public.keep_newest() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at <= old.updated_at then
      return null;                         -- descarta el cambio viejo
    end if;
    new.user_id := old.user_id;            -- nadie cambia el dueño
  end if;
  new.synced_at := now();                  -- hora del servidor
  return new;
end $$;

create trigger activities_keep_newest before insert or update on public.activities
  for each row execute function public.keep_newest();
create trigger profiles_keep_newest before insert or update on public.profiles
  for each row execute function public.keep_newest();

-- Hora del servidor, para corregir relojes desfasados
create or replace function public.server_now() returns timestamptz
language sql stable set search_path = '' as $$ select now() $$;

-- Permisos: solo usuarios con sesión iniciada; nada para visitantes anónimos
revoke all on public.activities, public.profiles from anon;
grant select, insert, update on public.activities, public.profiles to authenticated;
revoke execute on function public.server_now() from anon, public;
grant execute on function public.server_now() to authenticated;

-- Seguridad por fila: cada usuario solo ve y cambia lo suyo
alter table public.activities enable row level security;
alter table public.profiles  enable row level security;

create policy "leer mis actividades" on public.activities
  for select to authenticated using (user_id = (select auth.uid()));
create policy "crear mis actividades" on public.activities
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "editar mis actividades" on public.activities
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
-- Sin política de DELETE: borrar = poner deleted_at

create policy "leer mi perfil" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "crear mi perfil" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "editar mi perfil" on public.profiles
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Avisos en vivo a los otros dispositivos
alter publication supabase_realtime add table public.activities, public.profiles;
