-- =====================================================================
--  KALABALIK – hela databasen
--  Supabase-projekt: wordle (oyhbdwtwtjtskfzwysrc)
--
--  Kör hela filen i SQL Editor i wordle-projektet (New query → klistra
--  in → Run). Filen går att köra flera gånger. Tabeller som redan finns
--  behålls, medan funktioner, regler, frågor, låtar och uppskattningar
--  skrivs över med versionen i den här filen.
--
--  Allt heter kb_… så att det hålls isär från Frågesport (quiz_…) och
--  dina andra spel. Kalabalik använder samma värdkonto, samma anonyma
--  inloggning och samma musikfunktion (Edge Function "media") som
--  Frågesport, så inga inställningar behöver ändras.
--
--  Grundidé: ingen webbläsare får räkna ut sina egna poäng. Svaren går
--  till funktionen kb_svara, som jämför med facit (som ligger i en tabell
--  som ingen kan läsa) och räknar poäng med databasens klocka.
--
--  Utmaningarna:
--    fraga       kunskapsfråga med fyra alternativ, sex kategorier
--    gissaar     en låt spelas, gissa vilket år den kom
--    vemsjunger  en låt spelas, välj rätt artist
--    narmast     gissa ett tal, den som kommer närmast vinner
--    matte       ett mattetal anpassat efter åldern
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

-- Nya kolumner sedan första versionen
alter table kb_rum add column if not exists anvanda_latar int[] not null default '{}';
alter table kb_rum add column if not exists anvanda_tal int[] not null default '{}';
alter table kb_svar add column if not exists avstand numeric;

-- Låtarna till musikutmaningarna. ar är året låten FÖRST kom ut.
-- sok är vad som skickas till iTunes. Lämnas den tom söks "artist titel".
create table if not exists kb_latar (
  id serial primary key,
  artist text not null,
  titel text not null,
  ar int not null check (ar between 1900 and 2100),
  sok text,
  unique (artist, titel)
);

-- Frågorna till "Närmast vinner". svar måste vara ett heltal.
create table if not exists kb_uppskattningar (
  id serial primary key,
  fraga text not null unique,
  svar bigint not null,
  enhet text,
  emoji text
);


-- ---------------------------------------------------------------------
--  Row Level Security
--  Allt som ändrar något går via funktionerna längre ned. Policyerna
--  nedan finns för att värdskärmen och mobilerna ska kunna lyssna på
--  ändringar i realtid. Frågebanken, låtarna och uppskattningarna har
--  inga policyer alls, så facit kan inte läsas direkt.
-- ---------------------------------------------------------------------

alter table kb_rum            enable row level security;
alter table kb_hemligt        enable row level security;
alter table kb_spelare        enable row level security;
alter table kb_svar           enable row level security;
alter table kb_fragor         enable row level security;
alter table kb_latar          enable row level security;
alter table kb_uppskattningar enable row level security;

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

-- Hur många sekunder varje utmaning pågår. Ljudklippen är 30 sekunder.
create or replace function kb_tid(p_typ text) returns int
language sql immutable as $$
  select case p_typ
    when 'fraga'      then 25
    when 'gissaar'    then 30
    when 'vemsjunger' then 25
    when 'narmast'    then 30
    when 'matte'      then 25
    else 25
  end;
$$;

-- Fartbonusen på frågor och mattetal räknas mot en längre tid för de
-- yngre: en 5-åring som svarar på 10 s får lika mycket bonus som en
-- vuxen som svarar på 5 s.
create or replace function kb_tidsfaktor(p_grupp text) returns numeric
language sql immutable as $$
  select case p_grupp when 'liten' then 2.0 when 'mellan' then 1.5 else 1.0 end;
$$;

-- Gissa året: så många år fel får man vara och ändå få poäng.
-- Exakt rätt ger 1000 poäng, och poängen sjunker jämnt till 0 vid gränsen.
create or replace function kb_arsmarginal(p_grupp text) returns int
language sql immutable as $$
  select case p_grupp when 'liten' then 20 when 'mellan' then 15 else 10 end;
$$;

-- Hur ofta varje utmaning kommer. Alla fem kommer med minst en gång
-- (om omgången är minst fem rundor), resten fördelas efter vikterna.
create or replace function kb_vikter() returns jsonb
language sql immutable as $$
  select '{"fraga": 5, "gissaar": 3, "vemsjunger": 2, "narmast": 2, "matte": 1}'::jsonb;
$$;

-- Vilken svårighetsgrad kunskapsfrågorna har, i tur och ordning.
-- 1 = lätt, 2 = medel, 3 = svår.
create or replace function kb_nivaordning() returns int[]
language sql immutable as $$
  select array[2, 1, 2, 3, 2, 1, 3];
$$;

-- Gamla inställningar från action-utmaningarna
drop function if exists kb_forsprang(text);


-- ---------------------------------------------------------------------
--  Interna hjälpfunktioner (kan inte anropas från webbläsaren)
-- ---------------------------------------------------------------------

-- Slumpar ordningen på utmaningarna. Samma typ kommer aldrig två gånger i rad.
create or replace function kb_slumpa_plan(p_antal int)
returns text[] language plpgsql volatile set search_path = public as $$
declare
  vikter constant jsonb := kb_vikter();
  typer text[];
  pase text[];
  plan text[];
  summa int;
  slump int;
  ack int;
  t text;
  ok boolean;
begin
  select array_agg(k order by random()) into typer from jsonb_object_keys(vikter) k;
  pase := typer[1:least(p_antal, array_length(typer, 1))];
  select sum(v::int) into summa from jsonb_each_text(vikter) as e(k, v);

  -- Fyll på efter vikterna, men ingen typ får ta mer än halva omgången
  while coalesce(array_length(pase, 1), 0) < p_antal loop
    slump := floor(random() * summa)::int;
    ack := 0;
    foreach t in array typer loop
      ack := ack + (vikter ->> t)::int;
      if slump < ack then
        if cardinality(array_positions(pase, t)) < greatest(1, p_antal / 2) then
          pase := pase || t;
        end if;
        exit;
      end if;
    end loop;
  end loop;

  -- Blanda tills ingen typ kommer två gånger i rad
  for forsok in 1..500 loop
    select array_agg(x order by random()) into plan from unnest(pase) x;
    ok := true;
    for j in 2..p_antal loop
      if plan[j] = plan[j - 1] then
        ok := false;
        exit;
      end if;
    end loop;
    if ok then return plan; end if;
  end loop;

  -- Om slumpen inte hittade någon ordning: ta alltid den typ som har
  -- flest kvar och inte kom senast
  plan := '{}';
  for j in 1..p_antal loop
    select x into t from unnest(pase) x
    where x is distinct from plan[j - 1]
    group by x order by count(*) desc, random() limit 1;
    plan := plan || t;
    pase := pase[1:array_position(pase, t) - 1] || pase[array_position(pase, t) + 1:];
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

-- Skapar en utmaning. Returnerar {"publik": …, "facit": …, "anvand": …}.
-- "publik" skickas till alla, "facit" sparas i kb_hemligt och "anvand"
-- talar om vilken fråga eller låt som använts, så att den inte kommer igen.
create or replace function kb_ny_utmaning(p_rum uuid, p_typ text)
returns jsonb language plpgsql volatile set search_path = public as $$
declare
  r kb_rum;
  f kb_fragor;
  l kb_latar;
  u kb_uppskattningar;
  blandade text[];
  tal_liten jsonb; tal_mellan jsonb; tal_stor jsonb;
  ordning int[] := kb_nivaordning();
  vald_niva int;
  senaste text[];
  artister text[];
  bas jsonb;
begin
  select * into r from kb_rum where id = p_rum;
  bas := jsonb_build_object('typ', p_typ, 'tid', kb_tid(p_typ));

  if p_typ = 'fraga' then
    vald_niva := ordning[(coalesce(array_length(r.anvanda_fragor, 1), 0) % array_length(ordning, 1)) + 1];
    -- Kategorierna på de två senaste frågorna, så att det blir variation
    select coalesce(array_agg(kategori), '{}') into senaste from kb_fragor
    where id = any(r.anvanda_fragor[greatest(1, coalesce(array_length(r.anvanda_fragor, 1), 0) - 1):]);

    select * into f from kb_fragor
    where id <> all(r.anvanda_fragor)
    order by (niva = vald_niva) desc, (kategori <> all(senaste)) desc, random()
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
        'fraga', f.fraga, 'emoji', f.emoji, 'kategori', f.kategori, 'niva', f.niva,
        'alternativ', to_jsonb(blandade)),
      'facit', jsonb_build_object('ratt', array_position(blandade, f.alternativ[1]) - 1),
      'anvand', jsonb_build_object('fraga', f.id)
    );
  end if;

  if p_typ in ('gissaar', 'vemsjunger') then
    select * into l from kb_latar
    where id <> all(r.anvanda_latar)
    order by random() limit 1;
    if not found then
      select * into l from kb_latar order by random() limit 1;
    end if;
    if not found then
      raise exception 'Det finns inga låtar';
    end if;

    if p_typ = 'gissaar' then
      return jsonb_build_object(
        'publik', bas,
        'facit', jsonb_build_object(
          'artist', l.artist, 'titel', l.titel, 'ar', l.ar,
          'sok', coalesce(nullif(trim(l.sok), ''), l.artist || ' ' || l.titel)),
        'anvand', jsonb_build_object('lat', l.id)
      );
    end if;

    -- Vem sjunger? Tre andra artister, helst från ungefär samma tid
    select array_agg(artist) into artister from (
      select artist from (
        select distinct on (artist) artist, abs(ar - l.ar) as avstand
        from kb_latar where artist <> l.artist
        order by artist, abs(ar - l.ar)
      ) t
      order by (avstand <= 8) desc, random()
      limit 3
    ) t2;
    select array_agg(x order by random()) into blandade from unnest(artister || l.artist) x;

    return jsonb_build_object(
      'publik', bas || jsonb_build_object('alternativ', to_jsonb(blandade)),
      'facit', jsonb_build_object(
        'artist', l.artist, 'titel', l.titel, 'ar', l.ar,
        'sok', coalesce(nullif(trim(l.sok), ''), l.artist || ' ' || l.titel),
        'ratt', array_position(blandade, l.artist) - 1),
      'anvand', jsonb_build_object('lat', l.id)
    );
  end if;

  if p_typ = 'narmast' then
    select * into u from kb_uppskattningar
    where id <> all(r.anvanda_tal)
    order by random() limit 1;
    if not found then
      select * into u from kb_uppskattningar order by random() limit 1;
    end if;
    if not found then
      raise exception 'Det finns inga uppskattningsfrågor';
    end if;
    return jsonb_build_object(
      'publik', bas || jsonb_build_object('fraga', u.fraga, 'enhet', u.enhet, 'emoji', u.emoji),
      'facit', jsonb_build_object('svar', u.svar),
      'anvand', jsonb_build_object('tal', u.id)
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
        'stor', tal_stor -> 'svar'),
      'anvand', '{}'::jsonb
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
    anvanda_fragor = case when ny #> '{anvand,fraga}' is null then anvanda_fragor
                          else anvanda_fragor || (ny #>> '{anvand,fraga}')::int end,
    anvanda_latar = case when ny #> '{anvand,lat}' is null then anvanda_latar
                         else anvanda_latar || (ny #>> '{anvand,lat}')::int end,
    anvanda_tal = case when ny #> '{anvand,tal}' is null then anvanda_tal
                       else anvanda_tal || (ny #>> '{anvand,tal}')::int end,
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
  if p_antal not between 3 and 30 then
    raise exception 'Välj mellan 3 och 30 rundor';
  end if;
  if not exists (select 1 from kb_spelare where rum_id = p_rum) then
    raise exception 'Det finns inga spelare i rummet än';
  end if;

  delete from kb_svar where rum_id = p_rum;
  delete from kb_hemligt where rum_id = p_rum;
  update kb_spelare set poang = 0 where rum_id = p_rum and poang <> 0;

  -- Frågor och låtar från förra omgången i samma rum kommer inte igen
  update kb_rum set
    runda = 0,
    antal_rundor = p_antal,
    plan = kb_slumpa_plan(p_antal),
    utmaning = null
  where id = p_rum;

  perform kb_ga_vidare(p_rum);
end $$;

-- Introt är klart: utmaningen börjar nu
create or replace function kb_borja(p_rum uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r kb_rum;
begin
  r := kb_vardens_rum(p_rum);
  if r.status <> 'intro' then return; end if;

  update kb_rum set
    status = 'spel',
    start_at = now(),
    slut_at = now() + make_interval(secs => (r.utmaning ->> 'tid')::int),
    aktiv = now()
  where id = p_rum;
end $$;

-- Låten i den aktuella rundan. Bara värdskärmen får veta vilken det är,
-- så att den kan hämta ljudklippet. Mobilerna får inte se det.
create or replace function kb_musik(p_rum uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r kb_rum;
  facit jsonb;
begin
  select * into r from kb_rum where id = p_rum and vard_id = auth.uid();
  if not found then
    raise exception 'Rummet finns inte, eller så är du inte värd för det';
  end if;
  if r.utmaning ->> 'typ' not in ('gissaar', 'vemsjunger') then return null; end if;
  select h.facit into facit from kb_hemligt h where h.rum_id = p_rum and h.runda = r.runda;
  return facit - 'ratt';
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

  -- Närmast vinner: placeringen avgör poängen. Exakt rätt ger alltid 1000.
  if r.utmaning ->> 'typ' = 'narmast' then
    with rankade as (
      select id, avstand, rank() over (order by avstand) as plats
      from kb_svar
      where rum_id = p_rum and runda = r.runda and avstand is not null
    )
    update kb_svar s set
      ratt = rankade.plats = 1,
      poang = case
        when rankade.avstand = 0 then 1000
        else case rankade.plats when 1 then 1000 when 2 then 800 when 3 then 650 when 4 then 500 else 350 end
      end
    from rankade where s.id = rankade.id;
  end if;

  update kb_spelare p set poang = coalesce(
    (select sum(s.poang) from kb_svar s where s.spelare_id = p.id), 0)
  where p.rum_id = p_rum;

  select h.facit into facit from kb_hemligt h where h.rum_id = p_rum and h.runda = r.runda;

  update kb_rum set
    status = 'resultat',
    utmaning = r.utmaning || jsonb_build_object('facit', facit - 'sok'),
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
    start_at = null, slut_at = null, aktiv = now()
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
--   fraga, vemsjunger: {"val": 2}     (alternativets plats, 0–3)
--   gissaar:           {"ar": 1985}
--   narmast, matte:    {"tal": 56}
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
  avstand_ numeric;
  svar_tal numeric;
begin
  select * into r from kb_rum where id = p_rum;
  if not found then raise exception 'Rummet finns inte'; end if;

  select * into s from kb_spelare where rum_id = p_rum and user_id = auth.uid();
  if not found then raise exception 'Du är inte med i rummet'; end if;

  if r.status <> 'spel' or r.runda <> p_runda then
    raise exception 'Rundan är redan slut';
  end if;
  if now() > r.slut_at + interval '1.5 seconds' then
    raise exception 'Tiden är ute';
  end if;

  typ := r.utmaning ->> 'typ';
  tid := (r.utmaning ->> 'tid')::int;
  select h.facit into facit from kb_hemligt h where h.rum_id = p_rum and h.runda = r.runda;
  tid_ms := least(extract(epoch from (now() - r.start_at)) * 1000, tid * 1000)::int;

  if typ in ('fraga', 'vemsjunger', 'matte') then
    if typ = 'matte' then
      ar_ratt := coalesce(jsonb_typeof(p_svar -> 'tal') = 'number'
             and (p_svar ->> 'tal')::numeric = (facit ->> s.grupp)::numeric, false);
    else
      ar_ratt := coalesce(jsonb_typeof(p_svar -> 'val') = 'number'
             and (p_svar ->> 'val')::numeric = (facit ->> 'ratt')::numeric, false);
    end if;
    -- Rätt svar ger 600 poäng, plus upp till 400 i fartbonus
    if ar_ratt then
      poang := 600 + round(400 * greatest(0, 1 - tid_ms / (tid * 1000.0 * kb_tidsfaktor(s.grupp))))::int;
    end if;

  elsif typ = 'gissaar' then
    if jsonb_typeof(p_svar -> 'ar') <> 'number' then
      raise exception 'Skriv ett årtal';
    end if;
    avstand_ := abs((p_svar ->> 'ar')::numeric - (facit ->> 'ar')::numeric);
    ar_ratt := avstand_ = 0;
    poang := round(1000 * greatest(0, 1 - avstand_ / kb_arsmarginal(s.grupp)))::int;

  elsif typ = 'narmast' then
    -- Poängen delas ut i kb_avsluta_runda, när alla har svarat
    if jsonb_typeof(p_svar -> 'tal') <> 'number' then
      raise exception 'Skriv ett tal';
    end if;
    svar_tal := (p_svar ->> 'tal')::numeric;
    avstand_ := abs(svar_tal - (facit ->> 'svar')::numeric);
  end if;

  insert into kb_svar (rum_id, spelare_id, runda, svar, ratt, tid_ms, poang, avstand)
  values (p_rum, s.id, r.runda, p_svar, ar_ratt, tid_ms, poang, avstand_)
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
        'tid_ms', s.tid_ms, 'avstand', s.avstand, 'svarade', s.id is not null)
        order by coalesce(s.poang, 0) desc, s.avstand nulls last, s.tid_ms nulls last, lower(p.namn)), '[]')
      from kb_spelare p
      left join kb_svar s on s.spelare_id = p.id and s.runda = r.runda
      where p.rum_id = p_rum),
    'topplista', lista,
    'antal', jsonb_array_length(lista),
    'jag', (
      select e.v || jsonb_build_object(
        'runda_poang', coalesce(s.poang, 0), 'ratt', s.ratt, 'svar', s.svar,
        'tid_ms', s.tid_ms, 'avstand', s.avstand, 'svarade', s.id is not null)
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
--  Rum som står mitt i ett spel med utmaningar som inte finns längre
--  (till exempel action-utmaningarna från första versionen) skickas
--  tillbaka till lobbyn. Spelarna är kvar.
-- ---------------------------------------------------------------------

with gamla as (
  select id from kb_rum
  where exists (select 1 from unnest(plan) t where not kb_vikter() ? t)
)
, bort_svar as (delete from kb_svar where rum_id in (select id from gamla))
, bort_facit as (delete from kb_hemligt where rum_id in (select id from gamla))
, nollat as (update kb_spelare set poang = 0 where rum_id in (select id from gamla))
update kb_rum set
  status = 'lobby', runda = 0, antal_rundor = 0, plan = '{}', utmaning = null,
  start_at = null, slut_at = null
where id in (select id from gamla);


-- =====================================================================
--  INNEHÅLLET
--  Allt nedan skrivs om varje gång filen körs. Vill du ändra, lägga
--  till eller ta bort frågor och låtar: gör det här och kör filen igen.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Kunskapsfrågorna. DET FÖRSTA ALTERNATIVET ÄR ALLTID DET RÄTTA,
--  spelet blandar ordningen.
--  Kategorier: geografi, underhallning, historia, kultur, natur, sport
--  niva: 1 = lätt, 2 = medel, 3 = svår
-- ---------------------------------------------------------------------

truncate kb_fragor restart identity;

insert into kb_fragor (kategori, niva, emoji, fraga, alternativ) values
  -- geografi
  ('geografi', 2, '🦘', 'Vad heter Australiens huvudstad?',
    array['Canberra', 'Sydney', 'Melbourne', 'Perth']),
  ('geografi', 2, '👥', 'Vilket land har flest invånare i världen?',
    array['Indien', 'Kina', 'USA', 'Indonesien']),
  ('geografi', 2, '🏔️', 'I vilket land ligger inkastaden Machu Picchu?',
    array['Peru', 'Bolivia', 'Chile', 'Mexiko']),
  ('geografi', 2, '🍁', 'Vad heter Kanadas huvudstad?',
    array['Ottawa', 'Toronto', 'Montréal', 'Vancouver']),
  ('geografi', 3, '🌊', 'Vilken är Europas längsta flod?',
    array['Volga', 'Donau', 'Rhen', 'Dnepr']),
  ('geografi', 1, '🥾', 'Vilket land har formen av en stövel?',
    array['Italien', 'Grekland', 'Spanien', 'Kroatien']),
  ('geografi', 2, '🏛️', 'Vilken stad brukar kallas den eviga staden?',
    array['Rom', 'Aten', 'Jerusalem', 'Istanbul']),
  ('geografi', 2, '⛏️', 'Vilken är Sveriges nordligaste stad?',
    array['Kiruna', 'Luleå', 'Haparanda', 'Gällivare']),
  ('geografi', 2, '🧭', 'Vad heter havsviken mellan norra Sverige och Finland?',
    array['Bottniska viken', 'Finska viken', 'Rigabukten', 'Skagerrak']),
  ('geografi', 1, '🗽', 'I vilken stad står Frihetsgudinnan?',
    array['New York', 'Washington', 'Boston', 'Philadelphia']),
  ('geografi', 3, '💧', 'Vilket land har flest sjöar i världen?',
    array['Kanada', 'Finland', 'Sverige', 'Ryssland']),
  ('geografi', 2, '🐪', 'Vilken är världens största varma öken?',
    array['Sahara', 'Gobi', 'Kalahari', 'Atacama']),
  ('geografi', 1, '🇪🇸', 'Vad heter Spaniens huvudstad?',
    array['Madrid', 'Barcelona', 'Sevilla', 'Valencia']),
  ('geografi', 2, '🦓', 'Vilket land har huvudstaden Nairobi?',
    array['Kenya', 'Tanzania', 'Uganda', 'Etiopien']),
  ('geografi', 1, '🎡', 'Vilken flod rinner genom London?',
    array['Themsen', 'Seine', 'Donau', 'Rhen']),
  ('geografi', 2, '🥐', 'Vilken flod rinner genom Paris?',
    array['Seine', 'Loire', 'Rhône', 'Rhen']),
  ('geografi', 2, '🦌', 'Vilket är Sveriges till ytan största landskap?',
    array['Lappland', 'Norrbotten', 'Jämtland', 'Småland']),
  ('geografi', 1, '🌋', 'Vad heter Islands huvudstad?',
    array['Reykjavik', 'Akureyri', 'Tórshavn', 'Nuuk']),
  ('geografi', 3, '🏔️', 'Vilket litet land ligger i Pyrenéerna mellan Spanien och Frankrike?',
    array['Andorra', 'Monaco', 'Liechtenstein', 'San Marino']),
  ('geografi', 2, '⛪', 'Vilket är världens minsta land?',
    array['Vatikanstaten', 'Monaco', 'San Marino', 'Liechtenstein']),
  ('geografi', 2, '🐻', 'Vilken delstat i USA är störst till ytan?',
    array['Alaska', 'Texas', 'Kalifornien', 'Montana']),
  ('geografi', 2, '🕌', 'Vad heter Turkiets huvudstad?',
    array['Ankara', 'Istanbul', 'Izmir', 'Antalya']),
  ('geografi', 3, '🕰️', 'Vilket land har flest tidszoner om man räknar med alla dess områden?',
    array['Frankrike', 'Ryssland', 'USA', 'Kina']),
  ('geografi', 2, '⛰️', 'Vilket är Afrikas högsta berg?',
    array['Kilimanjaro', 'Mount Kenya', 'Atlasberget Toubkal', 'Ruwenzori']),
  ('geografi', 2, '⚽', 'Vad heter Brasiliens huvudstad?',
    array['Brasília', 'Rio de Janeiro', 'São Paulo', 'Salvador']),
  ('geografi', 3, '🧊', 'Vilken av de här städerna ligger längst norrut?',
    array['Tromsø', 'Murmansk', 'Kiruna', 'Reykjavik']),
  ('geografi', 1, '🌉', 'Vad heter sundet mellan Sverige och Danmark vid Helsingborg och Malmö?',
    array['Öresund', 'Kattegatt', 'Skagerrak', 'Lilla Bält']),
  ('geografi', 2, '⛪', 'I vilken stad står kyrkan Sagrada Família?',
    array['Barcelona', 'Madrid', 'Lissabon', 'Rom']),
  ('geografi', 1, '🇵🇹', 'Vilket land har huvudstaden Lissabon?',
    array['Portugal', 'Spanien', 'Brasilien', 'Italien']),
  ('geografi', 1, '🌊', 'Vilket hav ligger mellan Europa och Afrika?',
    array['Medelhavet', 'Röda havet', 'Svarta havet', 'Kaspiska havet']),
  ('geografi', 2, '🕌', 'I vilket land ligger staden Marrakech?',
    array['Marocko', 'Egypten', 'Tunisien', 'Turkiet']),
  ('geografi', 3, '🍋', 'Vilken är den största ön i Medelhavet?',
    array['Sicilien', 'Sardinien', 'Cypern', 'Korsika']),
  ('geografi', 3, '🏔️', 'Vad heter Norges högsta berg?',
    array['Galdhøpiggen', 'Glittertind', 'Snøhetta', 'Store Skagastølstind']),
  ('geografi', 2, '🌍', 'Vilket land har flest invånare i Afrika?',
    array['Nigeria', 'Egypten', 'Etiopien', 'Sydafrika']),
  ('geografi', 2, '🏰', 'Vad heter Skottlands huvudstad?',
    array['Edinburgh', 'Glasgow', 'Aberdeen', 'Inverness']),
  ('geografi', 1, '🪆', 'I vilken stad ligger Kreml?',
    array['Moskva', 'Sankt Petersburg', 'Kiev', 'Minsk']),

  -- underhallning
  ('underhallning', 1, '⚡', 'Vad heter Harry Potters bästa vän, pojken med rött hår?',
    array['Ron Weasley', 'Neville Longbottom', 'Draco Malfoy', 'Cedric Diggory']),
  ('underhallning', 1, '🎤', 'Vilken grupp bestod av Agnetha, Björn, Benny och Anni-Frid?',
    array['ABBA', 'Roxette', 'Ace of Base', 'Alcazar']),
  ('underhallning', 2, '☕', 'I vilken stad utspelar sig TV-serien Vänner (Friends)?',
    array['New York', 'Los Angeles', 'Chicago', 'Boston']),
  ('underhallning', 2, '🦖', 'Vem regisserade filmen Jurassic Park?',
    array['Steven Spielberg', 'George Lucas', 'James Cameron', 'Ridley Scott']),
  ('underhallning', 1, '🍩', 'Vad heter pappan i familjen Simpson?',
    array['Homer', 'Bart', 'Ned', 'Moe']),
  ('underhallning', 2, '🇸🇪', 'Vilket år vann Loreen Eurovision med Euphoria?',
    array['2012', '2010', '2014', '2016']),
  ('underhallning', 1, '🧱', 'Vad heter datorspelet där man vänder och staplar fallande block?',
    array['Tetris', 'Minecraft', 'Pac-Man', 'Candy Crush']),
  ('underhallning', 2, '🎶', 'Vem sjöng Främling i Melodifestivalen 1983?',
    array['Carola', 'Lena Philipsson', 'Kikki Danielsson', 'Anna Book']),
  ('underhallning', 1, '🚢', 'Vem spelade Jack i filmen Titanic?',
    array['Leonardo DiCaprio', 'Brad Pitt', 'Johnny Depp', 'Matt Damon']),
  ('underhallning', 1, '👑', 'Vilket band sjöng Bohemian Rhapsody?',
    array['Queen', 'The Beatles', 'The Rolling Stones', 'Led Zeppelin']),
  ('underhallning', 2, '🤖', 'I vilken film säger Arnold Schwarzenegger "I''ll be back" för första gången?',
    array['Terminator', 'Predator', 'Total Recall', 'Rambo']),
  ('underhallning', 3, '🗡️', 'Vad heter hjälten i spelserien The Legend of Zelda?',
    array['Link', 'Zelda', 'Ganon', 'Navi']),
  ('underhallning', 2, '♟️', 'Vilken svensk regissör gjorde filmen Det sjunde inseglet?',
    array['Ingmar Bergman', 'Lasse Hallström', 'Bo Widerberg', 'Roy Andersson']),
  ('underhallning', 1, '🕺', 'Vilken artist kallas The King of Pop?',
    array['Michael Jackson', 'Elvis Presley', 'Prince', 'Justin Timberlake']),
  ('underhallning', 1, '🏰', 'Vad heter trollkarlsskolan i Harry Potter?',
    array['Hogwarts', 'Narnia', 'Durmstrang', 'Avalon']),
  ('underhallning', 3, '🎼', 'Vem skrev musiken till de första Star Wars-filmerna?',
    array['John Williams', 'Hans Zimmer', 'Ennio Morricone', 'Howard Shore']),
  ('underhallning', 1, '🌹', 'Vilken svensk duo sjöng It Must Have Been Love?',
    array['Roxette', 'Gyllene Tider', 'The Cardigans', 'Icona Pop']),
  ('underhallning', 2, '🧅', 'Vad heter Shreks fru?',
    array['Fiona', 'Aurora', 'Belle', 'Ariel']),
  ('underhallning', 2, '☕', 'Vad heter kaféet där vännerna i Friends brukar sitta?',
    array['Central Perk', 'Monk''s Café', 'The Max', 'Luke''s Diner']),
  ('underhallning', 1, '🕷️', 'Vilken superhjälte heter egentligen Peter Parker?',
    array['Spider-Man', 'Batman', 'Iron Man', 'Superman']),
  ('underhallning', 1, '🍄', 'Vad heter Nintendos rörmokare med röd keps?',
    array['Mario', 'Luigi', 'Wario', 'Toad']),
  ('underhallning', 1, '💍', 'Vilken filmserie handlar om en ring som måste förstöras i Mordor?',
    array['Sagan om ringen', 'Narnia', 'Harry Potter', 'Game of Thrones']),
  ('underhallning', 2, '💿', 'Vilken artist släppte albumet 1989?',
    array['Taylor Swift', 'Madonna', 'Adele', 'Katy Perry']),
  ('underhallning', 1, '🎧', 'Vilken svensk DJ och producent gjorde Wake Me Up?',
    array['Avicii', 'Alesso', 'Axwell', 'Basshunter']),
  ('underhallning', 1, '🐠', 'Vilken film handlar om en clownfisk som letar efter sin son?',
    array['Hitta Nemo', 'Den lilla sjöjungfrun', 'Vaiana', 'Hajar som hajar']),
  ('underhallning', 2, '💜', 'Vem sjöng Purple Rain?',
    array['Prince', 'Michael Jackson', 'Stevie Wonder', 'Lionel Richie']),
  ('underhallning', 2, '🐒', 'Vem spelade Pippi Långstrump i TV-serien från 1969?',
    array['Inger Nilsson', 'Grete Havnesköld', 'Tami Erin', 'Lena Endre']),
  ('underhallning', 2, '🏆', 'Vem vann Eurovision 2015 för Sverige med Heroes?',
    array['Måns Zelmerlöw', 'Danny Saucedo', 'Eric Saade', 'Benjamin Ingrosso']),
  ('underhallning', 2, '🎷', 'Vilket år vann ABBA Eurovision med Waterloo?',
    array['1974', '1972', '1976', '1978']),
  ('underhallning', 2, '🧨', 'Vem spelade Sickan i filmerna om Jönssonligan?',
    array['Gösta Ekman', 'Ulf Brunnberg', 'Björn Gustafson', 'Allan Svensson']),
  ('underhallning', 1, '⚡', 'Vad heter den mest kända gula Pokémonen?',
    array['Pikachu', 'Bulbasaur', 'Charmander', 'Jigglypuff']),
  ('underhallning', 1, '🍸', 'Vilken hemlig agent har nummer 007?',
    array['James Bond', 'Jason Bourne', 'Ethan Hunt', 'Jack Ryan']),
  ('underhallning', 1, '🇬🇷', 'Vilken musikal med ABBA-låtar utspelar sig på en grekisk ö?',
    array['Mamma Mia!', 'Chess', 'Grease', 'Kristina från Duvemåla']),
  ('underhallning', 2, '🪩', 'Vilken svensk artist ligger bakom låten Dancing On My Own?',
    array['Robyn', 'Zara Larsson', 'Tove Lo', 'Veronica Maggio']),
  ('underhallning', 3, '🎬', 'Vilken av de här filmerna vann elva Oscarsstatyetter?',
    array['Titanic', 'Gudfadern', 'Forrest Gump', 'Avatar']),

  -- historia
  ('historia', 1, '🇺🇸', 'Vem var USA:s första president?',
    array['George Washington', 'Abraham Lincoln', 'Thomas Jefferson', 'Benjamin Franklin']),
  ('historia', 2, '🪖', 'Vilket år började första världskriget?',
    array['1914', '1912', '1916', '1918']),
  ('historia', 2, '⚔️', 'Vilken svensk kung dog i slaget vid Lützen 1632?',
    array['Gustav II Adolf', 'Karl XII', 'Gustav Vasa', 'Karl XI']),
  ('historia', 2, '🧱', 'Vilket land byggde Berlinmuren?',
    array['Östtyskland', 'Sovjetunionen', 'Västtyskland', 'Polen']),
  ('historia', 1, '🌕', 'Vem var den första människan som gick på månen?',
    array['Neil Armstrong', 'Buzz Aldrin', 'Jurij Gagarin', 'Michael Collins']),
  ('historia', 1, '⛵', 'Vilket regalskepp sjönk i Stockholm på sin första resa 1628?',
    array['Vasa', 'Kronan', 'Svärdet', 'Mars']),
  ('historia', 1, '🏺', 'I vilket land styrde faraonerna?',
    array['Egypten', 'Grekland', 'Persien', 'Mesopotamien']),
  ('historia', 2, '🎩', 'Vem var Storbritanniens premiärminister under större delen av andra världskriget?',
    array['Winston Churchill', 'Neville Chamberlain', 'Clement Attlee', 'Margaret Thatcher']),
  ('historia', 2, '👑', 'Vilket år valdes Gustav Vasa till kung av Sverige?',
    array['1523', '1397', '1611', '1809']),
  ('historia', 2, '🤝', 'Vad kallades unionen mellan Sverige, Norge och Danmark som bildades 1397?',
    array['Kalmarunionen', 'Hansan', 'Nordiska rådet', 'Skandinaviska unionen']),
  ('historia', 3, '🏝️', 'På vilken ö dog Napoleon?',
    array['Sankta Helena', 'Elba', 'Korsika', 'Malta']),
  ('historia', 2, '🦙', 'Vilket folk byggde Machu Picchu?',
    array['Inkafolket', 'Mayafolket', 'Aztekerna', 'Olmekerna']),
  ('historia', 2, '🌋', 'Vilken stad begravdes av vulkanen Vesuvius år 79?',
    array['Pompeji', 'Neapel', 'Rom', 'Aten']),
  ('historia', 2, '🇳🇴', 'Vilket år upplöstes unionen mellan Sverige och Norge?',
    array['1905', '1814', '1918', '1945']),
  ('historia', 2, '🛰️', 'Vilket land skickade upp den första satelliten, Sputnik?',
    array['Sovjetunionen', 'USA', 'Kina', 'Storbritannien']),
  ('historia', 3, '🩸', 'Vilket år ägde Stockholms blodbad rum?',
    array['1520', '1397', '1611', '1718']),
  ('historia', 3, '👸', 'Vilken svensk drottning abdikerade 1654 och flyttade till Rom?',
    array['Kristina', 'Ulrika Eleonora', 'Lovisa Ulrika', 'Margareta']),
  ('historia', 1, '✊', 'Vem blev Sydafrikas första svarta president?',
    array['Nelson Mandela', 'Desmond Tutu', 'Jacob Zuma', 'Thabo Mbeki']),
  ('historia', 3, '🗳️', 'Vilket år fick kvinnor rösta för första gången i ett riksdagsval i Sverige?',
    array['1921', '1909', '1945', '1866']),
  ('historia', 1, '🔨', 'Vem var åskguden i den nordiska mytologin?',
    array['Tor', 'Oden', 'Loke', 'Frej']),
  ('historia', 2, '⛵', 'Vad hette det största av Columbus fartyg på resan 1492?',
    array['Santa María', 'Pinta', 'Niña', 'Victoria']),
  ('historia', 1, '🏟️', 'Vilket rike byggde Colosseum?',
    array['Romarriket', 'Grekland', 'Egypten', 'Persien']),
  ('historia', 2, '🇫🇷', 'Vilket år började franska revolutionen?',
    array['1789', '1689', '1815', '1848']),
  ('historia', 1, '🧨', 'Vem uppfann dynamiten?',
    array['Alfred Nobel', 'Thomas Edison', 'Anders Celsius', 'Nikola Tesla']),
  ('historia', 2, '🇫🇮', 'Till vilket land förlorade Sverige Finland 1809?',
    array['Ryssland', 'Danmark', 'Preussen', 'Polen']),
  ('historia', 3, '🐉', 'Under vilken kinesisk dynasti byggdes det mesta av den mur man ser i dag?',
    array['Mingdynastin', 'Qindynastin', 'Handynastin', 'Tangdynastin']),
  ('historia', 2, '🛡️', 'Vilket år blev Sverige medlem i Nato?',
    array['2024', '2022', '2023', '1995']),
  ('historia', 1, '🇩🇪', 'Vem var Tysklands förbundskansler 2005–2021?',
    array['Angela Merkel', 'Gerhard Schröder', 'Olaf Scholz', 'Helmut Kohl']),
  ('historia', 1, '🕊️', 'Vilket år tog andra världskriget slut?',
    array['1945', '1944', '1946', '1939']),
  ('historia', 2, '📜', 'Vilken svensk diplomat räddade tusentals judar i Budapest 1944?',
    array['Raoul Wallenberg', 'Dag Hammarskjöld', 'Folke Bernadotte', 'Hans Blix']),
  ('historia', 3, '🔺', 'Vilken farao lät bygga den största pyramiden i Giza?',
    array['Cheops', 'Tutankhamon', 'Ramses II', 'Kleopatra']),
  ('historia', 1, '🏛️', 'Vem blev Sveriges första kvinnliga statsminister?',
    array['Magdalena Andersson', 'Mona Sahlin', 'Annie Lööf', 'Ebba Busch']),
  ('historia', 2, '🔥', 'Vilken fransk hjältinna brändes på bål 1431?',
    array['Jeanne d''Arc', 'Marie Antoinette', 'Katarina av Medici', 'Marie Curie']),

  -- kultur
  ('kultur', 1, '🐴', 'Vem skrev böckerna om Pippi Långstrump?',
    array['Astrid Lindgren', 'Selma Lagerlöf', 'Elsa Beskow', 'Tove Jansson']),
  ('kultur', 2, '🌌', 'Vem målade Stjärnenatten?',
    array['Vincent van Gogh', 'Claude Monet', 'Pablo Picasso', 'Edvard Munch']),
  ('kultur', 1, '🎭', 'Vem skrev Romeo och Julia?',
    array['William Shakespeare', 'Charles Dickens', 'Molière', 'Goethe']),
  ('kultur', 2, '🎨', 'Vem målade taket i Sixtinska kapellet?',
    array['Michelangelo', 'Leonardo da Vinci', 'Rafael', 'Donatello']),
  ('kultur', 2, '🖼️', 'På vilket museum hänger Mona Lisa?',
    array['Louvren', 'Prado', 'Uffizierna', 'British Museum']),
  ('kultur', 2, '🪿', 'Vem skrev Nils Holgerssons underbara resa genom Sverige?',
    array['Selma Lagerlöf', 'Astrid Lindgren', 'Elsa Beskow', 'Viktor Rydberg']),
  ('kultur', 2, '🚢', 'Vem skrev romanserien Utvandrarna?',
    array['Vilhelm Moberg', 'Ivar Lo-Johansson', 'Harry Martinson', 'Hjalmar Söderberg']),
  ('kultur', 1, '🍣', 'Från vilket land kommer sushi?',
    array['Japan', 'Kina', 'Thailand', 'Korea']),
  ('kultur', 2, '🐉', 'Vem skrev Millennium-trilogin om Lisbeth Salander?',
    array['Stieg Larsson', 'Henning Mankell', 'Camilla Läckberg', 'Jan Guillou']),
  ('kultur', 2, '😱', 'Vem målade Skriet?',
    array['Edvard Munch', 'Vincent van Gogh', 'Salvador Dalí', 'Gustav Klimt']),
  ('kultur', 2, '🎻', 'Vem komponerade De fyra årstiderna?',
    array['Antonio Vivaldi', 'Wolfgang Amadeus Mozart', 'Johann Sebastian Bach', 'Joseph Haydn']),
  ('kultur', 2, '📕', 'Vem skrev Röda rummet?',
    array['August Strindberg', 'Hjalmar Söderberg', 'Selma Lagerlöf', 'Verner von Heidenstam']),
  ('kultur', 1, '🇧🇷', 'Vilket språk talar man i Brasilien?',
    array['Portugisiska', 'Spanska', 'Brasilianska', 'Italienska']),
  ('kultur', 1, '🪄', 'Vem skrev böckerna om Harry Potter?',
    array['J.K. Rowling', 'Roald Dahl', 'C.S. Lewis', 'Rick Riordan']),
  ('kultur', 2, '🏡', 'Vilken svensk konstnär målade sitt hem i Sundborn?',
    array['Carl Larsson', 'Anders Zorn', 'Bruno Liljefors', 'John Bauer']),
  ('kultur', 1, '🌊', 'Vem skapade Mumintrollen?',
    array['Tove Jansson', 'Astrid Lindgren', 'Elsa Beskow', 'Gunilla Bergström']),
  ('kultur', 2, '🎹', 'Vilken kompositör fortsatte komponera trots att han blev döv?',
    array['Ludwig van Beethoven', 'Wolfgang Amadeus Mozart', 'Frédéric Chopin', 'Franz Schubert']),
  ('kultur', 3, '⛪', 'I vilken byggnadsstil är katedralen Notre-Dame i Paris byggd?',
    array['Gotik', 'Barock', 'Romansk stil', 'Jugend']),
  ('kultur', 1, '🥘', 'Från vilket land kommer rätten paella?',
    array['Spanien', 'Italien', 'Mexiko', 'Portugal']),
  ('kultur', 1, '🧙', 'Vem skrev Sagan om ringen?',
    array['J.R.R. Tolkien', 'C.S. Lewis', 'George R.R. Martin', 'J.K. Rowling']),
  ('kultur', 3, '🎼', 'Vilket instrument har 47 strängar och sju pedaler?',
    array['Harpa', 'Cembalo', 'Flygel', 'Luta']),
  ('kultur', 1, '🦁', 'I vilken bok bor bröderna Jonatan och Skorpan i Körsbärsdalen?',
    array['Bröderna Lejonhjärta', 'Mio, min Mio', 'Ronja rövardotter', 'Emil i Lönneberga']),
  ('kultur', 2, '🕵️', 'Vad heter Agatha Christies belgiske detektiv?',
    array['Hercule Poirot', 'Sherlock Holmes', 'Kommissarie Maigret', 'Philip Marlowe']),
  ('kultur', 3, '🛡️', 'Vem skrev Don Quijote?',
    array['Miguel de Cervantes', 'Dante Alighieri', 'Victor Hugo', 'Gabriel García Márquez']),
  ('kultur', 3, '🎶', 'Vilket land kom kompositören Jean Sibelius från?',
    array['Finland', 'Norge', 'Danmark', 'Estland']),
  ('kultur', 1, '🦢', 'Vad kallas den japanska konsten att vika figurer av papper?',
    array['Origami', 'Ikebana', 'Kalligrafi', 'Bonsai']),
  ('kultur', 2, '🐂', 'Vem målade Guernica?',
    array['Pablo Picasso', 'Salvador Dalí', 'Joan Miró', 'Francisco Goya']),
  ('kultur', 3, '🏅', 'Vilket år delades Nobelpriset ut för första gången?',
    array['1901', '1896', '1910', '1921']),
  ('kultur', 3, '🎨', 'Vem målade den stora oljemålningen Midvinterblot?',
    array['Carl Larsson', 'Anders Zorn', 'Ernst Josephson', 'Prins Eugen']),
  ('kultur', 2, '🍻', 'Vem skrev Fredmans epistlar?',
    array['Carl Michael Bellman', 'Evert Taube', 'Cornelis Vreeswijk', 'Esaias Tegnér']),
  ('kultur', 1, '💃', 'Från vilket land kommer flamencon?',
    array['Spanien', 'Argentina', 'Mexiko', 'Brasilien']),
  ('kultur', 2, '🌸', 'Vad kallas en japansk dikt på tre rader med fem, sju och fem stavelser?',
    array['Haiku', 'Sonett', 'Limerick', 'Tanka']),

  -- natur
  ('natur', 2, '🥇', 'Vilken kemisk beteckning har guld?',
    array['Au', 'Ag', 'Gd', 'Go']),
  ('natur', 1, '☀️', 'Vilken planet ligger närmast solen?',
    array['Merkurius', 'Venus', 'Mars', 'Jorden']),
  ('natur', 2, '🧍', 'Vilket är människokroppens största organ?',
    array['Huden', 'Levern', 'Hjärnan', 'Lungorna']),
  ('natur', 3, '📻', 'Vad mäts i enheten hertz?',
    array['Frekvens', 'Effekt', 'Spänning', 'Tryck']),
  ('natur', 2, '💎', 'Vilket är det hårdaste naturliga materialet?',
    array['Diamant', 'Granit', 'Stål', 'Kvarts']),
  ('natur', 2, '🌿', 'Vilken gas tar växterna upp ur luften när de fotosyntetiserar?',
    array['Koldioxid', 'Syre', 'Kväve', 'Helium']),
  ('natur', 3, '🧬', 'Hur många kromosomer har en människa normalt?',
    array['46', '23', '48', '44']),
  ('natur', 3, '🩸', 'Vilken blodgrupp kallas universell givare?',
    array['0 negativ', 'AB positiv', 'A negativ', 'B positiv']),
  ('natur', 3, '🦅', 'Vilket djur är snabbast i världen när det dyker?',
    array['Pilgrimsfalken', 'Kungsörnen', 'Geparden', 'Svärdfisken']),
  ('natur', 1, '🫁', 'Vilket grundämne har den kemiska beteckningen O?',
    array['Syre', 'Guld', 'Osmium', 'Kväve']),
  ('natur', 1, '💡', 'Vem formulerade relativitetsteorin?',
    array['Albert Einstein', 'Isaac Newton', 'Stephen Hawking', 'Niels Bohr']),
  ('natur', 3, '🌞', 'Ungefär hur lång tid tar det för solljuset att nå jorden?',
    array['8 minuter', '8 sekunder', '8 timmar', '8 dagar']),
  ('natur', 3, '🪐', 'Vilken planet har flest kända månar?',
    array['Saturnus', 'Jupiter', 'Uranus', 'Neptunus']),
  ('natur', 3, '💉', 'Vilket organ tillverkar insulin?',
    array['Bukspottkörteln', 'Levern', 'Njurarna', 'Mjälten']),
  ('natur', 2, '✨', 'I vilken stjärnbild ingår Karlavagnen?',
    array['Stora björnen', 'Orion', 'Lilla björnen', 'Kassiopeja']),
  ('natur', 1, '♨️', 'Vid hur många grader kokar vatten vid havsytan?',
    array['100 °C', '90 °C', '110 °C', '120 °C']),
  ('natur', 2, '🐻', 'Vilket är Sveriges största rovdjur?',
    array['Brunbjörnen', 'Vargen', 'Lodjuret', 'Järven']),
  ('natur', 1, '🐘', 'Vilket är världens största landdjur?',
    array['Afrikansk elefant', 'Flodhäst', 'Noshörning', 'Giraff']),
  ('natur', 2, '⚛️', 'Vilket är det vanligaste grundämnet i universum?',
    array['Väte', 'Syre', 'Kol', 'Helium']),
  ('natur', 2, '❤️', 'Hur många kammare har människans hjärta?',
    array['4', '2', '3', '6']),
  ('natur', 2, '🌞', 'Vilket vitamin bildar huden när den får sol?',
    array['D-vitamin', 'C-vitamin', 'A-vitamin', 'B12']),
  ('natur', 2, '🧫', 'Vem upptäckte penicillinet?',
    array['Alexander Fleming', 'Louis Pasteur', 'Marie Curie', 'Robert Koch']),
  ('natur', 1, '🦇', 'Vilket däggdjur kan flyga på riktigt?',
    array['Fladdermusen', 'Flygekorren', 'Flygfisken', 'Lemuren']),
  ('natur', 1, '🐋', 'Vilken sorts djur är en val?',
    array['Däggdjur', 'Fisk', 'Kräldjur', 'Groddjur']),
  ('natur', 1, '💧', 'Vad är H₂O?',
    array['Vatten', 'Salt', 'Socker', 'Syrgas']),
  ('natur', 2, '🔴', 'Vilken planet är känd för sin stora röda fläck?',
    array['Jupiter', 'Mars', 'Saturnus', 'Venus']),
  ('natur', 2, '🌡️', 'Vilken metall är flytande vid rumstemperatur?',
    array['Kvicksilver', 'Aluminium', 'Bly', 'Tenn']),
  ('natur', 1, '🌱', 'Vad kallas processen där växter gör energi av solljus?',
    array['Fotosyntes', 'Förbränning', 'Avdunstning', 'Jäsning']),
  ('natur', 1, '🐧', 'Vilket av de här djuren är inte ett däggdjur?',
    array['Pingvin', 'Delfin', 'Fladdermus', 'Val']),
  ('natur', 1, '🪐', 'Vilken är solsystemets största planet?',
    array['Jupiter', 'Saturnus', 'Neptunus', 'Jorden']),

  -- sport
  ('sport', 1, '⚽', 'Hur många spelare har ett fotbollslag på planen samtidigt?',
    array['11', '10', '9', '12']),
  ('sport', 1, '🗼', 'I vilken stad hölls sommar-OS 2024?',
    array['Paris', 'London', 'Los Angeles', 'Tokyo']),
  ('sport', 1, '🎾', 'Vilken svensk tennisspelare vann Wimbledon fem år i rad?',
    array['Björn Borg', 'Stefan Edberg', 'Mats Wilander', 'Robin Söderling']),
  ('sport', 2, '🏆', 'Vilket land har vunnit flest VM-guld i fotboll för herrar?',
    array['Brasilien', 'Tyskland', 'Italien', 'Argentina']),
  ('sport', 2, '🏃', 'Hur långt är ett maratonlopp?',
    array['42,195 km', '40 km', '42 km', '45,5 km']),
  ('sport', 1, '🏒', 'Vilken sport spelade Peter Forsberg och Mats Sundin?',
    array['Ishockey', 'Fotboll', 'Bandy', 'Innebandy']),
  ('sport', 2, '🏟️', 'Vilket år hölls sommar-OS i Stockholm?',
    array['1912', '1924', '1936', '1956']),
  ('sport', 1, '⛷️', 'Vad heter skidloppet mellan Sälen och Mora?',
    array['Vasaloppet', 'Engelbrektsloppet', 'Birkebeinerrennet', 'Tjejvasan']),
  ('sport', 2, '🎿', 'Hur lång är Vasaloppets klassiska bana?',
    array['90 km', '50 km', '70 km', '100 km']),
  ('sport', 2, '⛳', 'Vilken svensk golfspelare vann 72 tävlingar på den amerikanska LPGA-touren?',
    array['Annika Sörenstam', 'Liselotte Neumann', 'Sophie Gustafson', 'Anna Nordqvist']),
  ('sport', 1, '🏸', 'I vilken sport slår man en fjäderboll över ett nät?',
    array['Badminton', 'Tennis', 'Squash', 'Pingis']),
  ('sport', 1, '⭕', 'Hur många ringar finns i den olympiska symbolen?',
    array['5', '4', '6', '7']),
  ('sport', 2, '🦁', 'Vem har gjort flest mål för Sveriges herrlandslag i fotboll?',
    array['Zlatan Ibrahimović', 'Henrik Larsson', 'Sven Rydell', 'Gunnar Nordahl']),
  ('sport', 1, '🇦🇷', 'Vilket land vann fotbolls-VM 2022?',
    array['Argentina', 'Frankrike', 'Brasilien', 'Kroatien']),
  ('sport', 1, '🥇', 'Vilken gren tävlar Armand "Mondo" Duplantis i?',
    array['Stavhopp', 'Höjdhopp', 'Längdhopp', 'Häck']),
  ('sport', 3, '🏈', 'Hur många poäng ger en touchdown i amerikansk fotboll?',
    array['6', '3', '7', '5']),
  ('sport', 1, '🎳', 'I vilken sport kan man slå en strike genom att fälla alla käglor?',
    array['Bowling', 'Curling', 'Krocket', 'Boule']),
  ('sport', 1, '⛳', 'Hur många hål har en vanlig golfbana?',
    array['18', '9', '12', '24']),
  ('sport', 2, '❄️', 'Vilken stad stod värd för vinter-OS 1994?',
    array['Lillehammer', 'Albertville', 'Nagano', 'Calgary']),
  ('sport', 1, '⏱️', 'Hur många minuter pågår en ordinarie fotbollsmatch?',
    array['90', '80', '60', '100']),
  ('sport', 1, '🥋', 'Från vilket land kommer kampsporten judo?',
    array['Japan', 'Kina', 'Korea', 'Thailand']),
  ('sport', 1, '🏒', 'Hur många perioder har en ishockeymatch?',
    array['3', '2', '4', '5']),
  ('sport', 2, '♟️', 'Vad heter schackdraget där kungen och tornet flyttas samtidigt?',
    array['Rockad', 'En passant', 'Schack matt', 'Gambit']),
  ('sport', 2, '🏊', 'Hur lång är en bassäng i OS-simning?',
    array['50 meter', '25 meter', '100 meter', '33 meter']),
  ('sport', 3, '🏒', 'Vilket lag har vunnit flest Stanley Cup i NHL?',
    array['Montreal Canadiens', 'Toronto Maple Leafs', 'Detroit Red Wings', 'Boston Bruins']),
  ('sport', 2, '🇳🇴', 'Vilket land har vunnit flest guld i vinter-OS genom tiderna?',
    array['Norge', 'USA', 'Tyskland', 'Sverige']),
  ('sport', 2, '🚴', 'Vilken cyklist vann Tour de France sju gånger men blev av med titlarna?',
    array['Lance Armstrong', 'Chris Froome', 'Miguel Indurain', 'Eddy Merckx']),
  ('sport', 1, '🍓', 'Vilken sport spelas i Wimbledon?',
    array['Tennis', 'Golf', 'Cricket', 'Polo']),
  ('sport', 1, '🎯', 'Vilka två grenar kombineras i skidskytte?',
    array['Längdskidor och skytte', 'Slalom och skytte', 'Backhoppning och skytte', 'Skridsko och skytte']),
  ('sport', 1, '🏀', 'Hur många spelare har ett basketlag på planen samtidigt?',
    array['5', '6', '7', '4']),
  ('sport', 2, '🎾', 'Vilken svensk man har vunnit flest Grand Slam-titlar i singel i tennis?',
    array['Björn Borg', 'Mats Wilander', 'Stefan Edberg', 'Thomas Johansson']),
  ('sport', 1, '⛷️', 'Vilken sport utövade Ingemar Stenmark?',
    array['Alpin skidåkning', 'Längdskidåkning', 'Backhoppning', 'Skidskytte']);


-- ---------------------------------------------------------------------
--  Låtarna. ar är året låten FÖRST kom ut (inte året för en samlingsskiva).
--  sok används när "artist titel" inte hittar rätt låt hos iTunes.
-- ---------------------------------------------------------------------

truncate kb_latar restart identity;

insert into kb_latar (ar, artist, titel, sok) values
  (1954, 'Bill Haley & His Comets', 'Rock Around the Clock', null),
  (1955, 'Little Richard', 'Tutti Frutti', null),
  (1956, 'Elvis Presley', 'Heartbreak Hotel', null),
  (1957, 'Elvis Presley', 'Jailhouse Rock', null),
  (1957, 'Buddy Holly', 'Peggy Sue', null),
  (1958, 'Chuck Berry', 'Johnny B. Goode', null),
  (1959, 'Lill-Babs', 'Är du kär i mig ännu Klas-Göran?', 'Lill-Babs Klas-Göran'),
  (1961, 'Ben E. King', 'Stand by Me', null),
  (1961, 'Ray Charles', 'Hit the Road Jack', null),
  (1963, 'The Beatles', 'She Loves You', null),
  (1964, 'The Animals', 'The House of the Rising Sun', null),
  (1964, 'The Kinks', 'You Really Got Me', null),
  (1965, 'The Beatles', 'Yesterday', null),
  (1965, 'The Rolling Stones', '(I Can''t Get No) Satisfaction', 'Rolling Stones Satisfaction'),
  (1965, 'Tom Jones', 'It''s Not Unusual', null),
  (1966, 'The Rolling Stones', 'Paint It Black', null),
  (1966, 'The Beach Boys', 'Good Vibrations', null),
  (1966, 'Frank Sinatra', 'Strangers in the Night', null),
  (1966, 'The Monkees', 'I''m a Believer', null),
  (1967, 'Aretha Franklin', 'Respect', null),
  (1967, 'Louis Armstrong', 'What a Wonderful World', null),
  (1967, 'The Doors', 'Light My Fire', null),
  (1967, 'Procol Harum', 'A Whiter Shade of Pale', null),
  (1967, 'The Jimi Hendrix Experience', 'Purple Haze', 'Jimi Hendrix Purple Haze'),
  (1968, 'Otis Redding', '(Sittin'' On) The Dock of the Bay', 'Otis Redding Dock of the Bay'),
  (1968, 'The Beatles', 'Hey Jude', null),
  (1969, 'David Bowie', 'Space Oddity', null),
  (1969, 'Frank Sinatra', 'My Way', null),
  (1969, 'The Beatles', 'Here Comes the Sun', null),
  (1970, 'Simon & Garfunkel', 'Bridge over Troubled Water', null),
  (1970, 'Elton John', 'Your Song', null),
  (1971, 'John Lennon', 'Imagine', null),
  (1971, 'Led Zeppelin', 'Stairway to Heaven', null),
  (1972, 'Elton John', 'Rocket Man', null),
  (1972, 'Stevie Wonder', 'Superstition', null),
  (1972, 'Ted Gärdestad', 'Jag vill ha en egen måne', null),
  (1974, 'ABBA', 'Waterloo', null),
  (1975, 'ABBA', 'Mamma Mia', null),
  (1975, 'Queen', 'Bohemian Rhapsody', null),
  (1976, 'ABBA', 'Dancing Queen', null),
  (1976, 'Boney M.', 'Daddy Cool', null),
  (1977, 'Bee Gees', 'Stayin'' Alive', null),
  (1977, 'Donna Summer', 'I Feel Love', null),
  (1977, 'Fleetwood Mac', 'Dreams', null),
  (1977, 'David Bowie', 'Heroes', null),
  (1977, 'Queen', 'We Will Rock You', null),
  (1978, 'Boney M.', 'Rivers of Babylon', null),
  (1978, 'Gloria Gaynor', 'I Will Survive', null),
  (1978, 'Village People', 'Y.M.C.A.', null),
  (1978, 'Earth, Wind & Fire', 'September', null),
  (1978, 'Chic', 'Le Freak', null),
  (1978, 'Dire Straits', 'Sultans of Swing', null),
  (1979, 'ABBA', 'Gimme! Gimme! Gimme! (A Man After Midnight)', 'ABBA Gimme Gimme Gimme'),
  (1979, 'Michael Jackson', 'Don''t Stop ''Til You Get Enough', null),
  (1979, 'Pink Floyd', 'Another Brick in the Wall, Pt. 2', 'Pink Floyd Another Brick in the Wall'),
  (1979, 'The Buggles', 'Video Killed the Radio Star', null),
  (1980, 'ABBA', 'The Winner Takes It All', null),
  (1980, 'Queen', 'Another One Bites the Dust', null),
  (1980, 'Bob Marley & The Wailers', 'Could You Be Loved', 'Bob Marley Could You Be Loved'),
  (1982, 'Gyllene Tider', 'Sommartider', null),
  (1982, 'Ulf Lundell', 'Öppna landskap', null),
  (1982, 'Survivor', 'Eye of the Tiger', null),
  (1982, 'Toto', 'Africa', null),
  (1983, 'Carola', 'Främling', null),
  (1983, 'Cyndi Lauper', 'Girls Just Want to Have Fun', null),
  (1983, 'David Bowie', 'Let''s Dance', null),
  (1983, 'The Police', 'Every Breath You Take', null),
  (1983, 'Eurythmics', 'Sweet Dreams (Are Made of This)', 'Eurythmics Sweet Dreams'),
  (1984, 'Herreys', 'Diggi-Loo Diggi-Ley', null),
  (1984, 'Madonna', 'Like a Virgin', null),
  (1984, 'Prince', 'Purple Rain', null),
  (1984, 'Wham!', 'Wake Me Up Before You Go-Go', null),
  (1984, 'Wham!', 'Last Christmas', null),
  (1984, 'Queen', 'Radio Ga Ga', null),
  (1984, 'Stevie Wonder', 'I Just Called to Say I Love You', null),
  (1985, 'Dire Straits', 'Money for Nothing', null),
  (1986, 'Europe', 'The Final Countdown', null),
  (1986, 'Bon Jovi', 'Livin'' on a Prayer', null),
  (1986, 'Prince', 'Kiss', null),
  (1987, 'U2', 'With or Without You', null),
  (1987, 'Whitney Houston', 'I Wanna Dance with Somebody (Who Loves Me)', 'Whitney Houston I Wanna Dance with Somebody'),
  (1987, 'Rick Astley', 'Never Gonna Give You Up', null),
  (1987, 'Madonna', 'La Isla Bonita', null),
  (1987, 'Michael Jackson', 'Bad', null),
  (1988, 'Michael Jackson', 'Smooth Criminal', null),
  (1989, 'Madonna', 'Like a Prayer', null),
  (1990, 'Madonna', 'Vogue', null),
  (1990, 'Vanilla Ice', 'Ice Ice Baby', null),
  (1991, 'Roxette', 'Joyride', null),
  (1991, 'Eva Dahlgren', 'Vem tänder stjärnorna', null),
  (1991, 'Carola', 'Fångad av en stormvind', null),
  (1991, 'Nirvana', 'Smells Like Teen Spirit', null),
  (1991, 'R.E.M.', 'Losing My Religion', null),
  (1991, 'Michael Jackson', 'Black or White', null),
  (1991, 'Metallica', 'Enter Sandman', null),
  (1992, 'Whitney Houston', 'I Will Always Love You', null),
  (1992, 'Dr. Alban', 'It''s My Life', null),
  (1992, 'Ace of Base', 'All That She Wants', null),
  (1992, 'Lisa Nilsson', 'Himlen runt hörnet', null),
  (1993, 'Ace of Base', 'The Sign', null),
  (1993, 'Haddaway', 'What Is Love', null),
  (1994, 'Rednex', 'Cotton Eye Joe', null),
  (1994, 'The Cranberries', 'Zombie', null),
  (1995, 'Oasis', 'Wonderwall', null),
  (1995, 'Coolio', 'Gangsta''s Paradise', null),
  (1996, 'The Cardigans', 'Lovefool', null),
  (1996, 'Spice Girls', 'Wannabe', null),
  (1997, 'Aqua', 'Barbie Girl', null),
  (1997, 'Blur', 'Song 2', null),
  (1997, 'Celine Dion', 'My Heart Will Go On', null),
  (1997, 'Backstreet Boys', 'Everybody (Backstreet''s Back)', 'Backstreet Boys Everybody'),
  (1998, 'Britney Spears', '...Baby One More Time', 'Britney Spears Baby One More Time'),
  (1998, 'Cher', 'Believe', null),
  (1999, 'Backstreet Boys', 'I Want It That Way', null),
  (1999, 'Ricky Martin', 'Livin'' la Vida Loca', null),
  (2000, 'Alcazar', 'Crying at the Discoteque', null),
  (2000, 'Håkan Hellström', 'Känn ingen sorg för mig Göteborg', null),
  (2000, 'The Hives', 'Hate to Say I Told You So', null),
  (2000, 'Daft Punk', 'One More Time', null),
  (2000, 'Britney Spears', 'Oops!...I Did It Again', 'Britney Spears Oops I Did It Again'),
  (2000, 'Coldplay', 'Yellow', null),
  (2000, 'U2', 'Beautiful Day', null),
  (2002, 'Eminem', 'Without Me', null),
  (2002, 'Eminem', 'Lose Yourself', null),
  (1999, 'Kent', 'Musik non stop', null),
  (2003, 'Beyoncé', 'Crazy in Love', null),
  (2003, 'OutKast', 'Hey Ya!', null),
  (2003, 'The White Stripes', 'Seven Nation Army', null),
  (2004, 'Lena Philipsson', 'Det gör ont', null),
  (2004, 'The Killers', 'Somebody Told Me', null),
  (2005, 'Madonna', 'Hung Up', null),
  (2006, 'Gnarls Barkley', 'Crazy', null),
  (2006, 'Basshunter', 'Boten Anna', null),
  (2006, 'Peter Bjorn and John', 'Young Folks', null),
  (2006, 'Amy Winehouse', 'Rehab', null),
  (2007, 'Rihanna', 'Umbrella', null),
  (2008, 'Coldplay', 'Viva la Vida', null),
  (2008, 'Beyoncé', 'Single Ladies (Put a Ring on It)', 'Beyonce Single Ladies'),
  (2008, 'Lady Gaga', 'Poker Face', null),
  (2009, 'The Black Eyed Peas', 'I Gotta Feeling', 'Black Eyed Peas I Gotta Feeling'),
  (2009, 'Lady Gaga', 'Bad Romance', null),
  (2009, 'Mando Diao', 'Dance with Somebody', null),
  (2010, 'Robyn', 'Dancing On My Own', null),
  (2010, 'Adele', 'Rolling in the Deep', null),
  (2011, 'Eric Saade', 'Popular', null),
  (2011, 'Gotye', 'Somebody That I Used to Know', null),
  (2011, 'Lykke Li', 'I Follow Rivers', null),
  (2011, 'Avicii', 'Levels', null),
  (2011, 'Veronica Maggio', 'Jag kommer', null),
  (2012, 'Loreen', 'Euphoria', null),
  (2012, 'PSY', 'Gangnam Style', null),
  (2012, 'Swedish House Mafia', 'Don''t You Worry Child', null),
  (2012, 'Icona Pop', 'I Love It', null),
  (2012, 'Laleh', 'Some Die Young', null),
  (2013, 'Avicii', 'Wake Me Up', null),
  (2013, 'Daft Punk', 'Get Lucky', null),
  (2013, 'Pharrell Williams', 'Happy', null),
  (2014, 'Taylor Swift', 'Shake It Off', null),
  (2014, 'Mark Ronson', 'Uptown Funk', 'Mark Ronson Uptown Funk Bruno Mars'),
  (2015, 'Måns Zelmerlöw', 'Heroes', null),
  (2015, 'Adele', 'Hello', null),
  (2015, 'Zara Larsson', 'Lush Life', null),
  (2017, 'Ed Sheeran', 'Shape of You', null),
  (2017, 'Luis Fonsi', 'Despacito', null),
  (2018, 'Lewis Capaldi', 'Someone You Loved', null),
  (2019, 'Billie Eilish', 'bad guy', null),
  (2019, 'The Weeknd', 'Blinding Lights', null),
  (2020, 'Dua Lipa', 'Levitating', null),
  (2021, 'Olivia Rodrigo', 'drivers license', null),
  (2021, 'Måneskin', 'Zitti e buoni', null),
  (2022, 'Harry Styles', 'As It Was', null),
  (2022, 'Cornelia Jakobs', 'Hold Me Closer', null),
  (2023, 'Miley Cyrus', 'Flowers', null),
  (2023, 'Loreen', 'Tattoo', null),
  (2024, 'Sabrina Carpenter', 'Espresso', null),
  (2024, 'Billie Eilish', 'BIRDS OF A FEATHER', null);


-- ---------------------------------------------------------------------
--  Närmast vinner. Svaret måste vara ett heltal.
-- ---------------------------------------------------------------------

truncate kb_uppskattningar restart identity;

insert into kb_uppskattningar (emoji, fraga, svar, enhet) values
  ('🧱', 'Vilket år föll Berlinmuren?', 1989, 'år'),
  ('🌕', 'Vilket år landade Apollo 11 på månen?', 1969, 'år'),
  ('🚢', 'Vilket år sjönk Titanic?', 1912, 'år'),
  ('🇪🇺', 'Vilket år blev Sverige medlem i EU?', 1995, 'år'),
  ('🪖', 'Vilket år började andra världskriget?', 1939, 'år'),
  ('🌉', 'Vilket år invigdes Öresundsbron?', 2000, 'år'),
  ('📱', 'Vilket år kom den första iPhonen?', 2007, 'år'),
  ('🚗', 'Vilket år gick Sverige över till högertrafik?', 1967, 'år'),
  ('⛵', 'Vilket år kom Columbus till Amerika?', 1492, 'år'),
  ('🗼', 'Vilket år invigdes Eiffeltornet?', 1889, 'år'),
  ('☢️', 'Vilket år inträffade kärnkraftsolyckan i Tjernobyl?', 1986, 'år'),
  ('🪑', 'Vilket år grundades IKEA?', 1943, 'år'),
  ('🎤', 'Vilket år hölls den första svenska Melodifestivalen?', 1959, 'år'),
  ('⚡', 'Vilket år kom den första boken om Harry Potter?', 1997, 'år'),
  ('🌌', 'Vilket år hade den första Star Wars-filmen premiär?', 1977, 'år'),
  ('👑', 'Vilket år blev Carl XVI Gustaf kung?', 1973, 'år'),
  ('🎧', 'Vilket år grundades Spotify?', 2006, 'år'),
  ('🍔', 'Vilket år öppnade den första McDonald''s-restaurangen i Sverige?', 1973, 'år'),
  ('🍄', 'Vilket år kom det första Super Mario Bros.-spelet?', 1985, 'år'),
  ('👍', 'Vilket år startade Facebook?', 2004, 'år'),
  ('✊', 'Vilket år släpptes Nelson Mandela ur fängelset?', 1990, 'år'),
  ('🇺🇸', 'Vilket år mördades John F. Kennedy?', 1963, 'år'),
  ('🦴', 'Hur många ben har en vuxen människa i skelettet?', 206, 'ben'),
  ('🎹', 'Hur många tangenter har ett vanligt piano?', 88, 'tangenter'),
  ('🏃', 'Hur många meter är ett maratonlopp?', 42195, 'meter'),
  ('🕰️', 'Hur många minuter är ett dygn?', 1440, 'minuter'),
  ('🗺️', 'Hur många landskap har Sverige?', 25, 'landskap'),
  ('🏛️', 'Hur många län har Sverige?', 21, 'län'),
  ('🏔️', 'Hur många meter högt är Mount Everest?', 8849, 'meter'),
  ('🌡️', 'Vid hur många grader Fahrenheit kokar vatten?', 212, '°F'),
  ('♟️', 'Hur många rutor har ett schackbräde?', 64, 'rutor'),
  ('🃏', 'Hur många kort har en vanlig kortlek utan jokrar?', 52, 'kort'),
  ('⏱️', 'Hur många sekunder är en timme?', 3600, 'sekunder'),
  ('🌕', 'Ungefär hur många kilometer är det från jorden till månen?', 384400, 'km'),
  ('🇪🇺', 'Hur många stjärnor finns i EU:s flagga?', 12, 'stjärnor'),
  ('🇺🇸', 'Hur många stjärnor finns i USA:s flagga?', 50, 'stjärnor'),
  ('🌊', 'Hur många procent av jordens yta täcks av vatten?', 71, '%'),
  ('📚', 'Hur många år blev Astrid Lindgren?', 94, 'år'),
  ('🇪🇺', 'Hur många länder är medlemmar i EU?', 27, 'länder'),
  ('🎿', 'Hur många kilometer är Vasaloppet?', 90, 'km'),
  ('💡', 'Ungefär hur många kilometer i sekunden färdas ljuset?', 299792, 'km/s'),
  ('🦷', 'Hur många tänder har en vuxen med alla visdomständer?', 32, 'tänder'),
  ('🤾', 'Hur många spelare har ett handbollslag på planen, målvakten inräknad?', 7, 'spelare');

