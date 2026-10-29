-- =====================================================================
--  KALABALIK – hela databasen
--  Supabase-projekt: wordle (oyhbdwtwtjtskfzwysrc)
--
--  Kör hela filen i SQL Editor i wordle-projektet (New query → klistra
--  in → Run). Filen går att köra flera gånger: tabeller som redan finns
--  lämnas orörda, och funktioner, regler och frågor skrivs över med den
--  senaste versionen.
--
--  Allt heter kb_… så att det hålls isär från Frågesport (quiz_…) och
--  dina andra spel. Kalabalik använder samma värdkonto och samma anonyma
--  inloggning som Frågesport, så inga inställningar behöver ändras.
--
--  Grundidé: ingen webbläsare får räkna ut sina egna poäng. Svaren går
--  till funktionen kb_svara, som jämför med facit (som ligger i en tabell
--  som ingen kan läsa) och räknar poäng med databasens klocka.
-- =====================================================================


-- ---------------------------------------------------------------------
--  Tabeller
-- ---------------------------------------------------------------------

-- Rumskoder: 4 tecken, utan lättförväxlade tecken som 0/O och 1/I.
create or replace function kb_ny_kod() returns text
language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random() * 32)::int + 1, 1), ''
  )
  from generate_series(1, 4);
$$;

-- Ett rum går igenom lägena:
--   lobby → intro → spel → resultat → intro → spel → resultat → … → slut
-- intro:    storskärmen presenterar nästa utmaning
-- spel:     spelarna löser utmaningen på sina mobiler
-- resultat: rätt svar och poäng visas
create table if not exists kb_rum (
  id uuid primary key default gen_random_uuid(),
  kod text not null unique,
  vard_id uuid not null default auth.uid() references auth.users on delete cascade,
  status text not null default 'lobby'
    check (status in ('lobby', 'intro', 'spel', 'resultat', 'slut')),
  runda int not null default 0,
  antal_rundor int not null default 0,
  plan text[] not null default '{}',     -- utmaningarnas ordning, slumpad vid start
  utmaning jsonb,                        -- aktuell utmaning, UTAN facit
  start_at timestamptz,
  slut_at timestamptz,
  anvanda_fragor int[] not null default '{}',
  skapad timestamptz not null default now(),
  aktiv timestamptz not null default now()
);

-- Facit för varje runda. Ingen policy, så ingen kan läsa tabellen direkt.
create table if not exists kb_hemligt (
  rum_id uuid not null references kb_rum on delete cascade,
  runda int not null,
  facit jsonb not null,
  primary key (rum_id, runda)
);

-- Spelare (anonyma användare). grupp styr svårighetsgraden.
--   liten = 5–7 år, mellan = 8–12 år, stor = 13 år och äldre
create table if not exists kb_spelare (
  id uuid primary key default gen_random_uuid(),
  rum_id uuid not null references kb_rum on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  namn text not null check (char_length(trim(namn)) between 1 and 16),
  grupp text not null check (grupp in ('liten', 'mellan', 'stor')),
  avatar text not null default '🙂' check (char_length(avatar) <= 16),
  poang int not null default 0,
  ansluten timestamptz not null default now(),
  unique (rum_id, user_id)
);

create unique index if not exists kb_spelare_unikt_namn on kb_spelare (rum_id, lower(namn));

-- Svar. Skrivs bara av funktionen kb_svara.
create table if not exists kb_svar (
  id uuid primary key default gen_random_uuid(),
  rum_id uuid not null references kb_rum on delete cascade,
  spelare_id uuid not null references kb_spelare on delete cascade,
  runda int not null,
  svar jsonb not null,
  ratt boolean,
  tid_ms int,
  poang int not null default 0,
  skapad timestamptz not null default now(),
  unique (spelare_id, runda)
);

create index if not exists kb_svar_rum_runda on kb_svar (rum_id, runda);

-- Frågebanken. DET FÖRSTA ALTERNATIVET ÄR ALLTID DET RÄTTA,
-- spelet blandar ordningen. niva: 1 = lätt, 2 = mellan, 3 = svår.
create table if not exists kb_fragor (
  id serial primary key,
  fraga text not null unique,
  alternativ text[] not null check (array_length(alternativ, 1) between 2 and 4),
  emoji text,
  kategori text not null default 'blandat',
  niva int not null default 2 check (niva between 1 and 3)
);


-- ---------------------------------------------------------------------
--  Row Level Security
--  Allt som ändrar något går via funktionerna längre ned. Policyerna
--  nedan finns för att värdskärmen och mobilerna ska kunna lyssna på
--  ändringar i realtid.
-- ---------------------------------------------------------------------

alter table kb_rum     enable row level security;
alter table kb_hemligt enable row level security;
alter table kb_spelare enable row level security;
alter table kb_svar    enable row level security;
alter table kb_fragor  enable row level security;

drop policy if exists "läs rum" on kb_rum;
create policy "läs rum" on kb_rum for select to authenticated
  using (true);

drop policy if exists "läs spelare" on kb_spelare;
create policy "läs spelare" on kb_spelare for select to authenticated
  using (true);

-- Svaren: värden ser alla svar i sitt rum, spelaren bara sina egna.
drop policy if exists "läs svar" on kb_svar;
create policy "läs svar" on kb_svar for select to authenticated
  using (
    exists (select 1 from kb_rum r where r.id = rum_id and r.vard_id = auth.uid())
    or exists (select 1 from kb_spelare s where s.id = spelare_id and s.user_id = auth.uid())
  );


-- ---------------------------------------------------------------------
--  Realtid
-- ---------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['kb_rum', 'kb_spelare', 'kb_svar'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;


-- ---------------------------------------------------------------------
--  Inställningar för utmaningarna
--  Här kan du ändra tider och hur mycket hjälp de yngre får.
-- ---------------------------------------------------------------------

-- Hur många sekunder varje utmaning pågår.
create or replace function kb_tid(p_typ text) returns int
language sql immutable as $$
  select case p_typ
    when 'fraga'    then 25
    when 'matte'    then 25
    when 'snabbast' then 12
    when 'fanga'    then 15
    when 'bana'     then 25
    else 20
  end;
$$;

-- Fartbonusen på frågor och mattetal räknas mot en längre tid för de
-- yngre: en 5-åring som svarar på 10 s får lika mycket bonus som en
-- vuxen som svarar på 5 s.
create or replace function kb_tidsfaktor(p_grupp text) returns numeric
language sql immutable as $$
  select case p_grupp when 'liten' then 2.0 when 'mellan' then 1.5 else 1.0 end;
$$;

-- Försprång i "Vem trycker först?", i millisekunder.
create or replace function kb_forsprang(p_grupp text) returns int
language sql immutable as $$
  select case p_grupp when 'liten' then 200 when 'mellan' then 80 else 0 end;
$$;


-- ---------------------------------------------------------------------
--  Interna hjälpfunktioner (kan inte anropas från webbläsaren)
-- ---------------------------------------------------------------------

-- Slumpar ordningen på utmaningarna. Alla fem typerna kommer med (om
-- omgången är minst fem rundor lång), frågor är lite vanligare än de
-- andra, och samma typ kommer aldrig två gånger i rad.
create or replace function kb_slumpa_plan(p_antal int)
returns text[] language plpgsql volatile set search_path = public as $$
declare
  typer constant text[] := array['fraga', 'matte', 'snabbast', 'fanga', 'bana'];
  vikter constant int[] := array[3, 2, 2, 2, 2];
  pase text[];
  plan text[];
  slump int;
  summa int;
  ok boolean;
begin
  select array_agg(t order by random()) into pase from unnest(typer) t;
  pase := pase[1:least(p_antal, 5)];

  while coalesce(array_length(pase, 1), 0) < p_antal loop
    slump := floor(random() * 11)::int;
    summa := 0;
    for j in 1..5 loop
      summa := summa + vikter[j];
      if slump < summa then
        pase := pase || typer[j];
        exit;
      end if;
    end loop;
  end loop;

  for forsok in 1..300 loop
    select array_agg(t order by random()) into plan from unnest(pase) t;
    ok := true;
    for j in 2..p_antal loop
      if plan[j] = plan[j - 1] then
        ok := false;
        exit;
      end if;
    end loop;
    exit when ok;
  end loop;

  return plan;
end $$;

-- Ett heltal ur ett json-värde, eller null om det inte är ett tal.
create or replace function kb_heltal(v jsonb) returns int
language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' then round((v #>> '{}')::numeric)::int end;
$$;

-- Ett slumpat heltal mellan a och b (båda inräknade).
create or replace function kb_slump(a int, b int) returns int
language sql volatile as $$
  select a + floor(random() * (b - a + 1))::int;
$$;

-- Ett mattetal anpassat för åldersgruppen.
-- Returnerar {"text": "7 · 8", "svar": 56, ...}. För de minsta också
-- a, b och op (så att mobilen kan rita äpplen) och fyra svarsalternativ.
create or replace function kb_mattetal(p_grupp text)
returns jsonb language plpgsql volatile set search_path = public as $$
declare
  a int; b int; c int; svar int; sort int; text_ text;
  alt int[];
  kandidat int;
begin
  if p_grupp = 'liten' then
    if random() < 0.7 then
      a := kb_slump(1, 5); b := kb_slump(1, 5);
      svar := a + b; text_ := a || ' + ' || b;
      sort := 1;
    else
      a := kb_slump(3, 9); b := kb_slump(1, least(5, a - 1));
      svar := a - b; text_ := a || ' − ' || b;
      sort := 2;
    end if;

    -- Tre felaktiga alternativ nära det rätta svaret
    alt := array[svar];
    while array_length(alt, 1) < 4 loop
      kandidat := svar + (array[-2, -1, 1, 2, 3])[kb_slump(1, 5)];
      if kandidat >= 0 and kandidat <> all(alt) then
        alt := alt || kandidat;
      end if;
    end loop;
    select array_agg(x order by random()) into alt from unnest(alt) x;

    return jsonb_build_object(
      'text', text_, 'svar', svar, 'a', a, 'b', b,
      'op', case sort when 1 then '+' else '−' end,
      'alternativ', to_jsonb(alt)
    );
  end if;

  if p_grupp = 'mellan' then
    sort := kb_slump(1, 4);
    if sort = 1 then
      a := kb_slump(12, 59); b := kb_slump(8, 39);
      svar := a + b; text_ := a || ' + ' || b;
    elsif sort = 2 then
      a := kb_slump(30, 99); b := kb_slump(6, a - 10);
      svar := a - b; text_ := a || ' − ' || b;
    elsif sort = 3 then
      a := kb_slump(2, 10); b := kb_slump(3, 10);
      svar := a * b; text_ := a || ' · ' || b;
    else
      b := kb_slump(2, 9); svar := kb_slump(2, 10); a := b * svar;
      text_ := a || ' / ' || b;
    end if;
    return jsonb_build_object('text', text_, 'svar', svar);
  end if;

  -- stor
  sort := kb_slump(1, 4);
  if sort = 1 then
    a := kb_slump(13, 49); b := kb_slump(3, 9);
    svar := a * b; text_ := a || ' · ' || b;
  elsif sort = 2 then
    a := (array[10, 20, 25, 50, 75])[kb_slump(1, 5)];
    b := 4 * kb_slump(5, 50);           -- delbart med 4, så svaret blir ett heltal
    if a in (10, 20, 50) then b := 20 * kb_slump(2, 12); end if;
    svar := a * b / 100; text_ := a || ' % av ' || b;
  elsif sort = 3 then
    a := kb_slump(3, 9); b := kb_slump(4, 9); c := kb_slump(5, least(30, a * b - 1));
    if random() < 0.5 then
      svar := a * b + c; text_ := a || ' · ' || b || ' + ' || c;
    else
      svar := a * b - c; text_ := a || ' · ' || b || ' − ' || c;
    end if;
  else
    a := kb_slump(11, 19);
    svar := a * a; text_ := a || '²';
  end if;
  return jsonb_build_object('text', text_, 'svar', svar);
end $$;

-- Skapar en utmaning. Returnerar {"publik": …, "facit": …, "fraga_id": …}.
-- "publik" skickas till alla, "facit" sparas i kb_hemligt.
create or replace function kb_ny_utmaning(p_rum uuid, p_typ text)
returns jsonb language plpgsql volatile set search_path = public as $$
declare
  r kb_rum;
  f kb_fragor;
  blandade text[];
  tal_liten jsonb; tal_mellan jsonb; tal_stor jsonb;
  vald_niva int;
  falska jsonb;
  vanta int;
  bas jsonb;
begin
  select * into r from kb_rum where id = p_rum;
  bas := jsonb_build_object('typ', p_typ, 'tid', kb_tid(p_typ));

  if p_typ = 'fraga' then
    -- Växla mellan lätta, mellan och svåra frågor så att alla får en chans
    vald_niva := (coalesce(array_length(r.anvanda_fragor, 1), 0) % 3) + 1;
    select * into f from kb_fragor
    where id <> all(r.anvanda_fragor)
    order by (niva = vald_niva) desc, random()
    limit 1;
    if not found then
      select * into f from kb_fragor order by random() limit 1;
    end if;
    if not found then
      raise exception 'Frågebanken är tom';
    end if;

    select array_agg(x order by random()) into blandade from unnest(f.alternativ) x;
    return jsonb_build_object(
      'publik', bas || jsonb_build_object(
        'fraga', f.fraga, 'emoji', f.emoji, 'kategori', f.kategori,
        'alternativ', to_jsonb(blandade)),
      'facit', jsonb_build_object('ratt', array_position(blandade, f.alternativ[1]) - 1),
      'fraga_id', f.id
    );
  end if;

  if p_typ = 'matte' then
    tal_liten := kb_mattetal('liten');
    tal_mellan := kb_mattetal('mellan');
    tal_stor := kb_mattetal('stor');
    return jsonb_build_object(
      'publik', bas || jsonb_build_object('tal', jsonb_build_object(
        'liten', tal_liten - 'svar',
        'mellan', tal_mellan - 'svar',
        'stor', tal_stor - 'svar')),
      'facit', jsonb_build_object(
        'liten', tal_liten -> 'svar',
        'mellan', tal_mellan -> 'svar',
        'stor', tal_stor -> 'svar')
    );
  end if;

  if p_typ = 'snabbast' then
    -- Skärmen är röd en stund och blir sedan grön. Innan dess kan den
    -- blinka gult för att lura de äldre (de minsta slipper fällorna).
    vanta := kb_slump(2500, 6000);
    select coalesce(jsonb_agg(x order by x), '[]') into falska
    from (
      select kb_slump(900, vanta - 700) as x
      from generate_series(1, kb_slump(0, 2))
    ) t;
    return jsonb_build_object(
      'publik', bas || jsonb_build_object('vanta_ms', vanta, 'falska', falska),
      'facit', '{}'::jsonb
    );
  end if;

  if p_typ = 'fanga' then
    return jsonb_build_object(
      'publik', bas || jsonb_build_object('fro', kb_slump(1, 999999), 'antal', 24),
      'facit', jsonb_build_object('max', 24)
    );
  end if;

  if p_typ = 'bana' then
    return jsonb_build_object(
      'publik', bas || jsonb_build_object(
        'fro', kb_slump(1, 999999),
        'tema', (array['rymd', 'skog', 'hav'])[kb_slump(1, 3)],
        'antal', 20),
      'facit', jsonb_build_object('max', 20)
    );
  end if;

  raise exception 'Okänd utmaning: %', p_typ;
end $$;

-- Går till nästa runda, eller till slutet om alla rundor är spelade.
create or replace function kb_ga_vidare(p_rum uuid)
returns void language plpgsql volatile set search_path = public as $$
declare
  r kb_rum;
  ny jsonb;
begin
  select * into r from kb_rum where id = p_rum;

  if r.runda >= r.antal_rundor then
    update kb_rum set status = 'slut', start_at = null, slut_at = null, aktiv = now()
    where id = p_rum;
    return;
  end if;

  ny := kb_ny_utmaning(p_rum, r.plan[r.runda + 1]);

  insert into kb_hemligt (rum_id, runda, facit)
  values (p_rum, r.runda + 1, ny -> 'facit')
  on conflict (rum_id, runda) do update set facit = excluded.facit;

  update kb_rum set
    status = 'intro',
    runda = r.runda + 1,
    utmaning = ny -> 'publik',
    start_at = null,
    slut_at = null,
    anvanda_fragor = case
      when ny ? 'fraga_id' then anvanda_fragor || (ny ->> 'fraga_id')::int
      else anvanda_fragor end,
    aktiv = now()
  where id = p_rum;
end $$;

-- Hämtar rummet och kontrollerar att den inloggade är värd för det.
-- "for update" gör att två snabba klick på samma knapp inte krockar.
create or replace function kb_vardens_rum(p_rum uuid)
returns kb_rum language plpgsql volatile set search_path = public as $$
declare
  r kb_rum;
begin
  select * into r from kb_rum where id = p_rum and vard_id = auth.uid() for update;
  if not found then
    raise exception 'Rummet finns inte, eller så är du inte värd för det';
  end if;
  return r;
end $$;

-- Är den inloggade värd eller spelare i rummet?
create or replace function kb_ar_med(p_rum uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from kb_rum where id = p_rum and vard_id = auth.uid())
      or exists (select 1 from kb_spelare where rum_id = p_rum and user_id = auth.uid());
$$;

-- Topplistan för ett rum
create or replace function kb_topplista(p_rum uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'spelare_id', id, 'namn', namn, 'avatar', avatar, 'grupp', grupp,
      'poang', poang, 'placering', placering)
    order by placering, lower(namn)), '[]')
  from (
    select *, rank() over (order by poang desc) as placering
    from kb_spelare where rum_id = p_rum
  ) t;
$$;

revoke execute on function kb_slumpa_plan(int)          from public, anon, authenticated;
revoke execute on function kb_mattetal(text)            from public, anon, authenticated;
revoke execute on function kb_ny_utmaning(uuid, text)   from public, anon, authenticated;
revoke execute on function kb_ga_vidare(uuid)           from public, anon, authenticated;
revoke execute on function kb_vardens_rum(uuid)         from public, anon, authenticated;
revoke execute on function kb_topplista(uuid)           from public, anon, authenticated;


-- ---------------------------------------------------------------------
--  Värdens funktioner
-- ---------------------------------------------------------------------

-- Skapar ett rum. Bara riktiga konton, inte anonyma spelare.
create or replace function kb_skapa_rum()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r kb_rum;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Logga in som värd för att skapa ett rum';
  end if;

  for forsok in 1..10 loop
    begin
      insert into kb_rum (kod, vard_id) values (kb_ny_kod(), auth.uid()) returning * into r;
      return to_jsonb(r);
    exception when unique_violation then
      -- koden fanns redan, försök med en ny
    end;
  end loop;
  raise exception 'Kunde inte hitta en ledig kod, försök igen';
end $$;

-- Värdens senaste rum (så att värdskärmen hittar tillbaka efter omladdning)
create or replace function kb_vardrum()
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(r) from kb_rum r
  where vard_id = auth.uid() and aktiv > now() - interval '12 hours'
  order by skapad desc limit 1;
$$;

-- Startar spelet med ett visst antal rundor
create or replace function kb_starta(p_rum uuid, p_antal int)
returns void language plpgsql security definer set search_path = public as $$
declare
  r kb_rum;
begin
  r := kb_vardens_rum(p_rum);
  if r.status not in ('lobby', 'slut') then
    raise exception 'Spelet är redan igång';
  end if;
  if p_antal not between 3 and 20 then
    raise exception 'Välj mellan 3 och 20 rundor';
  end if;
  if not exists (select 1 from kb_spelare where rum_id = p_rum) then
    raise exception 'Det finns inga spelare i rummet än';
  end if;

  delete from kb_svar where rum_id = p_rum;
  delete from kb_hemligt where rum_id = p_rum;
  update kb_spelare set poang = 0 where rum_id = p_rum and poang <> 0;

  update kb_rum set
    runda = 0,
    antal_rundor = p_antal,
    plan = kb_slumpa_plan(p_antal),
    utmaning = null,
    anvanda_fragor = '{}'
  where id = p_rum;

  perform kb_ga_vidare(p_rum);
end $$;

-- Introt är klart: utmaningen börjar nu
create or replace function kb_borja(p_rum uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r kb_rum;
  sek int;
begin
  r := kb_vardens_rum(p_rum);
  if r.status <> 'intro' then return; end if;

  sek := (r.utmaning ->> 'tid')::int;
  -- Utmaningar som mobilen själv tar tid på får några extra sekunder,
  -- så att en mobil som fick signalen lite sent hinner skicka in.
  if r.utmaning ->> 'typ' in ('snabbast', 'fanga', 'bana') then
    sek := sek + 3;
  end if;

  update kb_rum set
    status = 'spel',
    start_at = now(),
    slut_at = now() + make_interval(secs => sek),
    aktiv = now()
  where id = p_rum;
end $$;

-- Tiden är ute eller alla har svarat: räkna ihop rundan
create or replace function kb_avsluta_runda(p_rum uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r kb_rum;
  facit jsonb;
begin
  r := kb_vardens_rum(p_rum);
  if r.status <> 'spel' then return; end if;

  -- Vem trycker först: placeringen avgör poängen, med försprång för de yngre
  if r.utmaning ->> 'typ' = 'snabbast' then
    with giltiga as (
      select s.id, s.tid_ms - kb_forsprang(p.grupp) as justerad
      from kb_svar s join kb_spelare p on p.id = s.spelare_id
      where s.rum_id = p_rum and s.runda = r.runda and s.ratt
    ),
    rankade as (
      select id, rank() over (order by justerad) as plats from giltiga
    )
    update kb_svar s set poang = case rankade.plats
        when 1 then 1000 when 2 then 800 when 3 then 650 when 4 then 500 else 400 end
    from rankade where s.id = rankade.id;
  end if;

  update kb_spelare p set poang = coalesce(
    (select sum(s.poang) from kb_svar s where s.spelare_id = p.id), 0)
  where p.rum_id = p_rum;

  select h.facit into facit from kb_hemligt h where h.rum_id = p_rum and h.runda = r.runda;

  update kb_rum set
    status = 'resultat',
    utmaning = case
      when r.utmaning ->> 'typ' in ('fraga', 'matte')
      then r.utmaning || jsonb_build_object('facit', facit)
      else r.utmaning end,
    aktiv = now()
  where id = p_rum;
end $$;

-- Nästa runda
create or replace function kb_nasta(p_rum uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r kb_rum;
begin
  r := kb_vardens_rum(p_rum);
  if r.status <> 'resultat' then return; end if;
  perform kb_ga_vidare(p_rum);
end $$;

-- Tillbaka till lobbyn: spelarna är kvar, svar och poäng nollställs
create or replace function kb_till_lobbyn(p_rum uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r kb_rum;
begin
  r := kb_vardens_rum(p_rum);
  delete from kb_svar where rum_id = p_rum;
  delete from kb_hemligt where rum_id = p_rum;
  update kb_spelare set poang = 0 where rum_id = p_rum and poang <> 0;
  update kb_rum set
    status = 'lobby', runda = 0, antal_rundor = 0, plan = '{}', utmaning = null,
    start_at = null, slut_at = null, anvanda_fragor = '{}', aktiv = now()
  where id = p_rum;
end $$;

-- Ta bort en spelare
create or replace function kb_sparka(p_spelare uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from kb_spelare s
  where s.id = p_spelare
    and exists (select 1 from kb_rum r where r.id = s.rum_id and r.vard_id = auth.uid());
end $$;

-- Stäng rummet helt. Spelare, svar och facit försvinner med det.
create or replace function kb_stang_rum(p_rum uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from kb_rum where id = p_rum and vard_id = auth.uid();
end $$;


-- ---------------------------------------------------------------------
--  Spelarnas funktioner
-- ---------------------------------------------------------------------

-- Gå med i ett rum. Går också att anropa igen för att byta namn,
-- åldersgrupp eller figur. Man kan hoppa in även när spelet är igång.
create or replace function kb_ga_med(p_kod text, p_namn text, p_grupp text, p_avatar text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r kb_rum;
  s kb_spelare;
  namn_ text := trim(coalesce(p_namn, ''));
  kod_ text := upper(trim(coalesce(p_kod, '')));
begin
  if auth.uid() is null then
    raise exception 'Inte inloggad';
  end if;

  select * into r from kb_rum where kod = kod_;
  if not found then
    raise exception 'Hittar inget rum med koden %', kod_;
  end if;
  if char_length(namn_) not between 1 and 16 then
    raise exception 'Skriv ett namn (högst 16 tecken)';
  end if;
  if p_grupp is null or p_grupp not in ('liten', 'mellan', 'stor') then
    raise exception 'Välj hur gammal du är';
  end if;
  if (select count(*) from kb_spelare where rum_id = r.id and user_id <> auth.uid()) >= 40 then
    raise exception 'Rummet är fullt';
  end if;

  begin
    insert into kb_spelare (rum_id, user_id, namn, grupp, avatar)
    values (r.id, auth.uid(), namn_, p_grupp, coalesce(nullif(trim(p_avatar), ''), '🙂'))
    on conflict (rum_id, user_id) do update
      set namn = excluded.namn, grupp = excluded.grupp, avatar = excluded.avatar
    returning * into s;
  exception when unique_violation then
    raise exception 'Namnet % är redan taget, välj ett annat', namn_;
  end;

  update kb_rum set aktiv = now() where id = r.id;
  return jsonb_build_object('spelare', to_jsonb(s), 'rum', to_jsonb(r));
end $$;

-- Spelarens senaste rum (så att mobilen hittar tillbaka efter omladdning)
create or replace function kb_mitt_spel()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('spelare', to_jsonb(s), 'rum', to_jsonb(r))
  from kb_spelare s join kb_rum r on r.id = s.rum_id
  where s.user_id = auth.uid() and r.aktiv > now() - interval '12 hours'
  order by s.ansluten desc limit 1;
$$;

-- Lämna rummet
create or replace function kb_lamna(p_rum uuid)
returns void language sql security definer set search_path = public as $$
  delete from kb_spelare where rum_id = p_rum and user_id = auth.uid();
$$;

-- Hela läget i rummet, för värdskärmen och för mobiler som just anslutit.
-- "nu" är databasens klocka, så att alla skärmar kan räkna ned i takt.
create or replace function kb_lage(p_rum uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r kb_rum;
  jag kb_spelare;
begin
  select * into r from kb_rum where id = p_rum;
  if not found then return null; end if;
  if not kb_ar_med(p_rum) then
    raise exception 'Du är inte med i rummet';
  end if;

  select * into jag from kb_spelare where rum_id = p_rum and user_id = auth.uid();

  return jsonb_build_object(
    'rum', to_jsonb(r),
    'nu', now(),
    'spelare', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'namn', namn, 'avatar', avatar, 'grupp', grupp, 'poang', poang)
        order by ansluten), '[]')
      from kb_spelare where rum_id = p_rum),
    'svarade', (
      select coalesce(jsonb_agg(spelare_id), '[]')
      from kb_svar where rum_id = p_rum and runda = r.runda),
    'jag', case when jag.id is null then null else to_jsonb(jag) end,
    'mitt_svar', case when jag.id is null then null else (
      select to_jsonb(s) from kb_svar s where s.spelare_id = jag.id and s.runda = r.runda) end
  );
end $$;

-- Skicka in ett svar. Här räknas poängen, med databasens klocka.
--   fraga:    {"val": 2}                        (alternativets plats, 0–3)
--   matte:    {"tal": 56}
--   snabbast: {"ms": 312} eller {"tjuvstart": true}
--   fanga:    {"traffar": 17, "bomber": 1}
--   bana:     {"stjarnor": 14, "krockar": 2}
create or replace function kb_svara(p_rum uuid, p_runda int, p_svar jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r kb_rum;
  s kb_spelare;
  facit jsonb;
  typ text;
  tid int;
  tid_ms int;
  ar_ratt boolean;
  poang int := 0;
  marginal interval;
  maxantal int;
  antal int;
  minus int;
begin
  select * into r from kb_rum where id = p_rum;
  if not found then raise exception 'Rummet finns inte'; end if;

  select * into s from kb_spelare where rum_id = p_rum and user_id = auth.uid();
  if not found then raise exception 'Du är inte med i rummet'; end if;

  if r.status <> 'spel' or r.runda <> p_runda then
    raise exception 'Rundan är redan slut';
  end if;

  typ := r.utmaning ->> 'typ';
  tid := (r.utmaning ->> 'tid')::int;
  marginal := case when typ in ('fraga', 'matte') then interval '1.5 seconds' else interval '6 seconds' end;
  if now() > r.slut_at + marginal then
    raise exception 'Tiden är ute';
  end if;

  select h.facit into facit from kb_hemligt h where h.rum_id = p_rum and h.runda = r.runda;
  tid_ms := least(extract(epoch from (now() - r.start_at)) * 1000, tid * 1000)::int;

  if typ in ('fraga', 'matte') then
    if typ = 'fraga' then
      ar_ratt := coalesce(jsonb_typeof(p_svar -> 'val') = 'number'
             and (p_svar ->> 'val')::numeric = (facit ->> 'ratt')::numeric, false);
    else
      ar_ratt := coalesce(jsonb_typeof(p_svar -> 'tal') = 'number'
             and (p_svar ->> 'tal')::numeric = (facit ->> s.grupp)::numeric, false);
    end if;
    -- Rätt svar ger 600 poäng, plus upp till 400 i fartbonus
    if ar_ratt then
      poang := 600 + round(400 * greatest(0, 1 - tid_ms / (tid * 1000.0 * kb_tidsfaktor(s.grupp))))::int;
    end if;

  elsif typ = 'snabbast' then
    -- Mobilen mäter reaktionstiden själv, från grönt till tryck.
    -- Poängen delas ut i kb_avsluta_runda när alla har tryckt.
    if coalesce((p_svar ->> 'tjuvstart')::boolean, false)
       or coalesce(jsonb_typeof(p_svar -> 'ms'), '') <> 'number'
       or (p_svar ->> 'ms')::numeric < 80 then
      ar_ratt := false;
      tid_ms := null;
    else
      ar_ratt := true;
      tid_ms := least((p_svar ->> 'ms')::numeric, 5000)::int;
    end if;

  elsif typ = 'fanga' then
    maxantal := (facit ->> 'max')::int;
    antal := least(greatest(coalesce(kb_heltal(p_svar -> 'traffar'), 0), 0), maxantal);
    minus := least(greatest(coalesce(kb_heltal(p_svar -> 'bomber'), 0), 0), 20);
    poang := round(1000.0 * greatest(antal - 2 * minus, 0) / maxantal)::int;
    tid_ms := null;

  elsif typ = 'bana' then
    maxantal := (facit ->> 'max')::int;
    antal := least(greatest(coalesce(kb_heltal(p_svar -> 'stjarnor'), 0), 0), maxantal);
    poang := round(1000.0 * antal / maxantal)::int;
    tid_ms := null;
  end if;

  insert into kb_svar (rum_id, spelare_id, runda, svar, ratt, tid_ms, poang)
  values (p_rum, s.id, r.runda, p_svar, ar_ratt, tid_ms, poang)
  on conflict (spelare_id, runda) do nothing;

  return jsonb_build_object('ok', true);
end $$;

-- Resultatet: rundans poäng, topplistan och ens egen placering.
-- Finns bara i lägena resultat och slut.
create or replace function kb_resultat(p_rum uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r kb_rum;
  lista jsonb;
begin
  select * into r from kb_rum where id = p_rum;
  if not found or r.status not in ('resultat', 'slut') then return null; end if;
  if not kb_ar_med(p_rum) then
    raise exception 'Du är inte med i rummet';
  end if;

  lista := kb_topplista(p_rum);

  return jsonb_build_object(
    'runda', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'spelare_id', p.id, 'namn', p.namn, 'avatar', p.avatar, 'grupp', p.grupp,
        'poang', coalesce(s.poang, 0), 'ratt', s.ratt, 'svar', s.svar,
        'tid_ms', s.tid_ms, 'svarade', s.id is not null)
        order by coalesce(s.poang, 0) desc, s.tid_ms nulls last, lower(p.namn)), '[]')
      from kb_spelare p
      left join kb_svar s on s.spelare_id = p.id and s.runda = r.runda
      where p.rum_id = p_rum),
    'topplista', lista,
    'antal', jsonb_array_length(lista),
    'jag', (
      select e.v || jsonb_build_object(
        'runda_poang', coalesce(s.poang, 0), 'ratt', s.ratt, 'svar', s.svar,
        'tid_ms', s.tid_ms, 'svarade', s.id is not null)
      from jsonb_array_elements(lista) as e(v)
      join kb_spelare p on p.id = (e.v ->> 'spelare_id')::uuid
      left join kb_svar s on s.spelare_id = p.id and s.runda = r.runda
      where p.user_id = auth.uid())
  );
end $$;


-- ---------------------------------------------------------------------
--  Nattlig städning: rum som inte använts på 12 timmar tas bort.
--  (Anonyma användare städas redan bort av Frågesportens quiz_stada.)
-- ---------------------------------------------------------------------

create or replace function kb_stada()
returns int language plpgsql set search_path = public as $$
declare
  antal int;
begin
  delete from kb_rum where aktiv < now() - interval '12 hours';
  get diagnostics antal = row_count;
  return antal;
end $$;

revoke execute on function kb_stada() from public, anon, authenticated;

select cron.schedule('kb-stadning', '20 3 * * *', $$select kb_stada()$$);


-- ---------------------------------------------------------------------
--  Frågebanken
--  Första alternativet är det rätta. Lägg gärna till egna frågor här
--  och kör filen igen. Ändrar du en frågas text blir den en ny fråga
--  (den gamla finns kvar tills du tar bort den i Table Editor).
--  niva: 1 = de flesta 5-åringar kan, 2 = lagom för 8–12, 3 = klurig.
-- ---------------------------------------------------------------------

insert into kb_fragor (fraga, alternativ, emoji, kategori, niva) values
  -- Djur
  ('Vilket djur är världens största?', '{Blåval,Elefant,Giraff,Isbjörn}', '🐋', 'djur', 2),
  ('Hur många ben har en spindel?', '{8,6,10,12}', '🕷️', 'djur', 2),
  ('Vad kallas en kos unge?', '{Kalv,Föl,Lamm,Killing}', '🐄', 'djur', 1),
  ('Vilket djur säger "kuckeliku"?', '{Tuppen,Ankan,Grisen,Fåret}', '🐓', 'djur', 1),
  ('Vilket djur har längst hals?', '{Giraffen,Kamelen,Strutsen,Hästen}', '🦒', 'djur', 1),
  ('Vad äter pandor nästan bara?', '{Bambu,Fisk,Bananer,Honung}', '🐼', 'djur', 1),
  ('Vilket av de här djuren är ett däggdjur?', '{Delfin,Haj,Pingvin,Krokodil}', '🐬', 'djur', 3),
  ('Vilket djur brukar kallas skogens konung i Sverige?', '{Älgen,Björnen,Vargen,Lodjuret}', '🌲', 'djur', 2),
  ('Hur många hjärtan har en bläckfisk?', '{3,1,2,4}', '🐙', 'djur', 3),
  ('Vilken fågel kan flyga baklänges?', '{Kolibrin,Örnen,Duvan,Måsen}', '🐦', 'djur', 3),
  ('Vad kallas en grupp vargar?', '{Flock,Hjord,Svärm,Stim}', '🐺', 'djur', 2),
  ('Vilket av djuren kan sova stående?', '{Hästen,Hunden,Katten,Kaninen}', '🐴', 'djur', 2),
  ('Vilket av djuren lägger ägg?', '{Ankan,Kon,Katten,Hunden}', '🥚', 'djur', 1),
  ('Hur många ben har en insekt?', '{6,4,8,10}', '🐞', 'djur', 2),
  ('Vilket djur har svarta och vita ränder?', '{Zebran,Elefanten,Flodhästen,Noshörningen}', '🦓', 'djur', 1),
  ('Vilken färg har isbjörnens hud under pälsen?', '{Svart,Vit,Rosa,Gul}', '🐻‍❄️', 'djur', 3),
  ('Vilket djur springer snabbast på land?', '{Geparden,Lejonet,Hästen,Strutsen}', '🐆', 'djur', 2),
  ('Vilket djur bor i en kupa och gör honung?', '{Biet,Myran,Flugan,Musen}', '🐝', 'djur', 1),
  ('Vilket djur bär sitt hus på ryggen?', '{Snigeln,Grodan,Masken,Ödlan}', '🐌', 'djur', 1),
  ('Hur många armar har en bläckfisk?', '{8,6,10,12}', '🐙', 'djur', 2),
  ('Vilken fågel är en symbol för fred?', '{Duvan,Kråkan,Örnen,Ugglan}', '🕊️', 'djur', 2),
  ('Vad heter hästens unge?', '{Föl,Kalv,Valp,Kattunge}', '🐎', 'djur', 1),

  -- Natur och rymden
  ('Vilken planet ligger närmast solen?', '{Merkurius,Venus,Mars,Jorden}', '☀️', 'rymden', 2),
  ('Vilken planet kallas den röda planeten?', '{Mars,Jupiter,Venus,Saturnus}', '🔴', 'rymden', 2),
  ('Vilken är den största planeten i vårt solsystem?', '{Jupiter,Saturnus,Jorden,Neptunus}', '🪐', 'rymden', 2),
  ('Vilken stjärna är närmast jorden?', '{Solen,Polstjärnan,Sirius,Månen}', '⭐', 'rymden', 3),
  ('Hur många planeter finns i vårt solsystem?', '{8,7,9,10}', '🌍', 'rymden', 2),
  ('Vilken planet har de tydligaste ringarna?', '{Saturnus,Mars,Merkurius,Venus}', '🪐', 'rymden', 2),
  ('Vad blir vatten när det fryser?', '{Is,Ånga,Lera,Sand}', '🧊', 'natur', 1),
  ('Vilken färg blir det om man blandar blått och gult?', '{Grönt,Lila,Orange,Brunt}', '🎨', 'natur', 1),
  ('Vilken färg blir det om man blandar rött och vitt?', '{Rosa,Lila,Orange,Grått}', '🎨', 'natur', 1),
  ('Hur många färger brukar man säga att regnbågen har?', '{7,5,6,8}', '🌈', 'natur', 2),
  ('Vilket är jordens största hav?', '{Stilla havet,Atlanten,Indiska oceanen,Östersjön}', '🌊', 'natur', 3),
  ('Vad behöver en växt för att växa?', '{Ljus och vatten,Mjölk,Sand och salt,Mörker}', '🌱', 'natur', 1),
  ('Vilken årstid kommer efter vintern?', '{Våren,Sommaren,Hösten,Vintern igen}', '❄️', 'natur', 1),
  ('Vilken gas måste vi andas in för att leva?', '{Syre,Koldioxid,Helium,Vätgas}', '🫁', 'natur', 2),
  ('Vad kallas den glödheta smälta stenen som rinner ur en vulkan?', '{Lava,Grus,Kol,Salt}', '🌋', 'natur', 2),
  ('Vad kallas det när havet stiger och sjunker två gånger om dygnet?', '{Tidvatten,Tsunami,Monsun,Virvel}', '🌊', 'natur', 3),

  -- Kroppen
  ('Hur många tänder har en vuxen när alla visdomständer har kommit?', '{32,20,28,40}', '🦷', 'kroppen', 3),
  ('Vilket organ pumpar runt blodet i kroppen?', '{Hjärtat,Magen,Lungorna,Hjärnan}', '❤️', 'kroppen', 1),
  ('Hur många fingrar har man på två händer?', '{10,8,12,5}', '🖐️', 'kroppen', 1),
  ('Vilket är kroppens största organ?', '{Huden,Levern,Hjärnan,Lungorna}', '🧍', 'kroppen', 3),
  ('Vad använder vi för att lukta?', '{Näsan,Öronen,Ögonen,Armbågen}', '👃', 'kroppen', 1),

  -- Sverige
  ('Vad heter Sveriges huvudstad?', '{Stockholm,Göteborg,Malmö,Uppsala}', '🇸🇪', 'Sverige', 1),
  ('Vilka färger har Sveriges flagga?', '{Blått och gult,Rött och vitt,Blått och vitt,Grönt och gult}', '🇸🇪', 'Sverige', 1),
  ('Vad heter Sveriges största sjö?', '{Vänern,Vättern,Mälaren,Siljan}', '🏞️', 'Sverige', 2),
  ('Vilken månad firar vi midsommar?', '{Juni,Maj,Juli,Augusti}', '🌸', 'Sverige', 1),
  ('Vad heter Sveriges högsta berg?', '{Kebnekaise,Åreskutan,Sylarna,Helags}', '⛰️', 'Sverige', 2),
  ('Vilket datum är Sveriges nationaldag?', '{6 juni,17 maj,24 juni,1 maj}', '🎉', 'Sverige', 3),
  ('I vilket landskap föddes Astrid Lindgren?', '{Småland,Skåne,Lappland,Dalarna}', '📚', 'Sverige', 3),
  ('Vad heter Pippi Långstrumps häst?', '{Lilla Gubben,Herr Nilsson,Blixten,Snövit}', '🐴', 'Sverige', 2),
  ('I vilken stad ligger nöjesparken Liseberg?', '{Göteborg,Stockholm,Malmö,Uppsala}', '🎢', 'Sverige', 2),
  ('Vilken är Sveriges största ö?', '{Gotland,Öland,Orust,Tjörn}', '🏝️', 'Sverige', 2),
  ('Vilket djur är Dalarnas mest kända träfigur?', '{En häst,En ko,En tupp,En gris}', '🐎', 'Sverige', 1),
  ('Vilken bulle äter man på fettisdagen?', '{Semla,Kanelbulle,Lussekatt,Munk}', '🥯', 'Sverige', 2),

  -- Mat
  ('Vad görs pommes frites av?', '{Potatis,Morötter,Äpplen,Ris}', '🍟', 'mat', 1),
  ('Vilken frukt är gul och böjd?', '{Banan,Äpple,Päron,Kiwi}', '🍌', 'mat', 1),
  ('Vad görs guacamole av?', '{Avokado,Gurka,Ärtor,Kiwi}', '🥑', 'mat', 2),
  ('Från vilket land kommer pizzan?', '{Italien,USA,Frankrike,Grekland}', '🍕', 'mat', 2),
  ('Vad blir grädde om man vispar den alldeles för länge?', '{Smör,Ost,Yoghurt,Glass}', '🧈', 'mat', 3),
  ('Vilken orange grönsak växer nere i jorden?', '{Morot,Gurka,Tomat,Paprika}', '🥕', 'mat', 1),
  ('Vilken färg har en mogen tomat?', '{Röd,Blå,Lila,Svart}', '🍅', 'mat', 1),

  -- Världen
  ('Vilket är världens till ytan största land?', '{Ryssland,Kanada,Kina,USA}', '🌏', 'världen', 2),
  ('I vilket land ligger pyramiderna i Giza?', '{Egypten,Mexiko,Grekland,Indien}', '🏜️', 'världen', 2),
  ('Var i världen lever kängurur vilt?', '{Australien,Afrika,Sydamerika,Asien}', '🦘', 'världen', 1),
  ('Vad heter Norges huvudstad?', '{Oslo,Bergen,Köpenhamn,Helsingfors}', '🇳🇴', 'världen', 2),
  ('Vilket land har ett rött lönnlöv i flaggan?', '{Kanada,Norge,Japan,Schweiz}', '🍁', 'världen', 2),
  ('Vilket är världens högsta berg?', '{Mount Everest,Kilimanjaro,Mont Blanc,Kebnekaise}', '🏔️', 'världen', 2),
  ('Vem målade Mona Lisa?', '{Leonardo da Vinci,Pablo Picasso,Vincent van Gogh,Carl Larsson}', '🖼️', 'världen', 3),

  -- Sport och lek
  ('Hur många spelare har ett fotbollslag på planen samtidigt?', '{11,9,10,12}', '⚽', 'sport', 2),
  ('Hur många ringar finns i OS-symbolen?', '{5,4,6,7}', '🏅', 'sport', 2),
  ('I vilken sport slår man en fjäderboll över ett nät?', '{Badminton,Tennis,Pingis,Golf}', '🏸', 'sport', 2),

  -- Siffror, ord och blandat
  ('Hur många hörn har en triangel?', '{3,2,4,5}', '🔺', 'blandat', 1),
  ('Hur många hörn har en kub?', '{8,6,10,12}', '🎲', 'blandat', 3),
  ('Vad är motsatsen till varm?', '{Kall,Het,Stor,Snabb}', '🔥', 'blandat', 1),
  ('Vilken bokstav kommer efter A i alfabetet?', '{B,C,D,Ö}', '🔤', 'blandat', 1),
  ('Hur många bokstäver har det svenska alfabetet?', '{29,26,28,30}', '🔤', 'blandat', 3),
  ('Hur många prickar finns det sammanlagt på en vanlig tärning?', '{21,18,24,36}', '🎲', 'blandat', 3),
  ('Vilket instrument har svarta och vita tangenter?', '{Piano,Gitarr,Trumma,Flöjt}', '🎹', 'blandat', 1),
  ('Hur många år är ett sekel?', '{100,10,50,1000}', '💯', 'blandat', 2),
  ('Vilken månad har minst antal dagar?', '{Februari,April,Juni,November}', '📅', 'blandat', 2),
  ('Hur många minuter är en timme?', '{60,30,100,120}', '⏰', 'blandat', 1),
  ('Hur många dagar har ett skottår?', '{366,364,365,367}', '📅', 'blandat', 3),
  ('Vad kallas barnet till din mammas syster?', '{Kusin,Syskon,Brorsbarn,Faster}', '👪', 'blandat', 2)
on conflict (fraga) do update set
  alternativ = excluded.alternativ,
  emoji = excluded.emoji,
  kategori = excluded.kategori,
  niva = excluded.niva;
