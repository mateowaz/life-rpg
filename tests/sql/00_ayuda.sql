-- Ayudas para las pruebas (solo existen en la base de prueba)
create schema t;
create table t.results (n serial, msg text);
grant usage on schema t to authenticated, anon;
grant select, insert on t.results to authenticated, anon;
grant usage on sequence t.results_n_seq to authenticated, anon;

-- Comprueba una condición: si no se cumple, la prueba se detiene con el mensaje
create function t.ok(cond boolean, msg text) returns text language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALLÓ: %', msg; end if;
  insert into t.results (msg) values (msg);
  return 'ok - ' || msg;
end $$;
create function t.eq(got anyelement, want anyelement, msg text) returns text language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FALLÓ: % (se obtuvo %, se esperaba %)', msg, got, want; end if;
  insert into t.results (msg) values (msg);
  return 'ok - ' || msg;
end $$;
-- ¿La sentencia falla? (para comprobar que RLS o los permisos la bloquean)
create function t.fails(stmt text, msg text) returns text language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    insert into t.results (msg) values (msg);
    return 'ok - ' || msg;
  end;
  raise exception 'FALLÓ: % (la sentencia no falló)', msg;
end $$;
grant execute on all functions in schema t to authenticated, anon;

-- Usuarios de prueba
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@prueba.local'),
  ('00000000-0000-0000-0000-00000000000b', 'b@prueba.local');

-- Actuar como un usuario con sesión iniciada (lo mismo que hace la API de Supabase)
create function t.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
end $$;
grant execute on function t.login(uuid) to authenticated, anon;
