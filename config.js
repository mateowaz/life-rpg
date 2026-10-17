/* Life RPG — conexión con Supabase.
   Solo va la Publishable Key (sb_publishable_…), que está pensada para el navegador.
   NUNCA pongas aquí la service_role ni una secret key (sb_secret_…).
   La seguridad real está en las reglas RLS de supabase/schema.sql. */
window.LIFE_RPG_CONFIG = {
  supabaseUrl: "https://hpxphljtiidtlvpdzwhd.supabase.co",
  supabaseKey: "sb_publishable_KT1LGhEnDeJgtm9yvcjonw_DE7kJ70a",
};
