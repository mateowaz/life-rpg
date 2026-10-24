-- XP: private.activity_xp (Supabase) tiene que dar lo mismo que actXP (la app)
select t.eq(private.activity_xp((c->>0)::int, (c->>1)::int, c->>2), (c->>3)::int,
            format('XP de %s min, intensidad %s, %s = %s', c->>0, c->>1, c->>2, c->>3))
  from jsonb_array_elements((:'xp_cases')::jsonb->'casos') c;

select t.eq(jsonb_array_length((:'xp_grid')::jsonb), 3600, 'la tabla de la app tiene las 3.600 combinaciones');
select t.eq((select count(*) from jsonb_array_elements((:'xp_grid')::jsonb) c
              where private.activity_xp((c->>0)::int, (c->>1)::int, c->>2) <> (c->>3)::int),
            0::bigint, 'activity_xp coincide con actXP en las 3.600 combinaciones');
