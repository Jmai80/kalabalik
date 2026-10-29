-- Skickar en notis för varje ändring i kb-tabellerna, så att testservern
-- kan efterlikna Supabase Realtime. Används bara i testerna.

create or replace function test_notis() returns trigger language plpgsql as $$
begin
  perform pg_notify('kb_andring', json_build_object(
    'table', TG_TABLE_NAME,
    'type', TG_OP,
    'record', case when TG_OP <> 'DELETE' then to_jsonb(NEW) end,
    -- Som i Supabase: vid DELETE skickas bara primärnyckeln
    'old_record', case when TG_OP <> 'INSERT' then jsonb_build_object('id', OLD.id) end
  )::text);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['kb_rum', 'kb_spelare', 'kb_svar'] loop
    execute format('drop trigger if exists test_notis on %I', t);
    execute format('create trigger test_notis after insert or update or delete on %I
                    for each row execute function test_notis()', t);
  end loop;
end $$;
