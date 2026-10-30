# Kalabalik

En frågesport för hela familjen, från 5 till 80 år. Alla går med på sina egna mobiler eller plattor genom att skanna en QR-kod, precis som i Kahoot. Storskärmen visar frågorna och spelar musiken, och spelet slumpar fram en omgång med fem sorters utmaningar:

| | Utmaning | Vad man gör |
|---|---|---|
| 🧠 | **Kunskap** | Frågor med fyra svarsalternativ i sex kategorier: geografi, underhållning, historia, kultur och litteratur, natur och vetenskap samt sport och fritid. Lätta, medelsvåra och svåra frågor blandas. |
| 📻 | **Gissa året** | Storskärmen spelar en låt. Alla gissar vilket år den kom ut. Ju närmare, desto fler poäng, och efteråt visas allas gissningar på en tidslinje. |
| 🎤 | **Vem sjunger?** | Storskärmen spelar en låt. Välj rätt artist bland fyra. |
| 🎯 | **Närmast vinner** | Gissa ett tal, till exempel ett årtal eller hur högt Mount Everest är. Den som kommer närmast vinner. |
| 🧮 | **Mattedags** | Varje åldersgrupp får ett eget tal. |

Kunskapsfrågor kommer oftast, sedan musik. Samma sorts utmaning kommer aldrig två gånger i rad, och en fråga eller låt kommer inte tillbaka i samma rum.

**Sidorna**

- Spelare: https://jmai80.github.io/kalabalik/
- Storskärmen (värden): https://jmai80.github.io/kalabalik/vard

## Rättvist mellan 5 och 80 år

Varje spelare väljer åldersgrupp när hen går med: 🐣 5–7 år, 🦊 8–12 år eller 🦉 13+ år.

- **Fartbonusen** på kunskapsfrågor, Vem sjunger? och mattetal räknas mot dubbelt så lång tid för de minsta och 1,5 gånger så lång tid för mellangruppen.
- **Gissa året** ger poäng upp till 10 år fel för vuxna, 15 år för mellangruppen och 20 år för de minsta.
- **Mattetalen** anpassas efter gruppen. De minsta räknar frukter och väljer bland fyra svar.

## Så installerar du

1. **Databasen.** Öppna **SQL Editor** i Supabase-projektet **wordle**, välj **New query**, klistra in hela `supabase/kalabalik.sql` och tryck **Run**. Filen går att köra igen när du ändrat något. Frågor, låtar och uppskattningar skrivs då om med innehållet i filen.
2. **GitHub Pages.** Redan klart: **Settings → Pages → Source: GitHub Actions**. Varje `git push` publicerar sidan efter någon minut.

Kalabalik använder samma värdkonto, samma anonyma inloggning och samma musikfunktion (Edge Function `media`) som Frågesport, så inga inställningar i Supabase behöver ändras.

## Så spelar ni

1. Öppna **storskärmen** på datorn som är kopplad till TV:n, logga in och tryck **Skapa ett rum**. Koppla datorn till högtalare eller TV-ljud, eftersom musiken spelas där.
2. Alla skannar QR-koden, skriver sitt namn, väljer ålder och en figur.
3. Välj antal rundor (8, 12 eller 16) och tryck **Starta!**
4. Spelet går vidare av sig självt. Efter varje runda visas resultatet i 15 sekunder. Du kan trycka **Pausa** eller **Nästa runda**. Musiken spelar vidare medan resultatet visas och kan pausas.
5. Efter sista rundan visas pallen. **Spela igen** startar en ny omgång med samma spelare.

Klicka på en spelare i lobbyn för att ta bort hen. Den som kommer in mitt i ett spel är med från nästa runda.

## Musiken

Låtarna spelas som 30 sekunders provlyssningsklipp från iTunes, via Edge Functionen `media` som Frågesport redan använder. Storskärmen letar upp låten medan introt visas och väljer originalinspelningen, inte en liveversion eller remix.

Året kommer från databasen och inte från iTunes, eftersom iTunes ofta anger året för en samlingsskiva. Hittas en låt inte hos iTunes visar storskärmen titel och artist i stället, så att rundan ändå går att spela.

## Ändra och bygga ut

Allt innehåll ligger längst ned i `supabase/kalabalik.sql`. Ändra där och kör filen igen.

| Vad | Var |
|---|---|
| Kunskapsfrågor | `insert into kb_fragor`. Det första alternativet är alltid det rätta, spelet blandar ordningen. Kategorin är en av `geografi`, `underhallning`, `historia`, `kultur`, `natur` och `sport`. Nivån är 1 (lätt), 2 (medel) eller 3 (svår). |
| Låtar | `insert into kb_latar`: år, artist och titel. Hittar iTunes fel låt kan du skriva en egen söksträng i sista kolumnen. |
| Närmast vinner | `insert into kb_uppskattningar`. Svaret måste vara ett heltal. |
| Hur ofta varje utmaning kommer | `kb_vikter` |
| Tid per utmaning | `kb_tid` |
| Blandningen av lätta och svåra frågor | `kb_nivaordning` |
| Hjälpen till de yngre | `kb_tidsfaktor` och `kb_arsmarginal` |
| Namn och instruktioner | `TYPER` och `KATEGORIER` i `docs/gemensamt.js` |

**En ny sorts utmaning** behöver en egen fil i `docs/utmaningar/` (kopiera en befintlig), en rad i `docs/utmaningar/index.js`, en rad i `TYPER` i `docs/gemensamt.js` och en del i `kb_ny_utmaning`, `kb_svara` och `kb_vikter` i SQL-filen.

**Action-utmaningarna** från första versionen (Vem trycker först?, Fånga! och Action-banan) ligger i `arkiv/action/`, med en beskrivning av hur de tas tillbaka.

## Så fungerar det

- **Ingen kan fuska till sig poäng.** Facit ligger i tabellen `kb_hemligt`, som ingen kan läsa. Frågebanken, låtarna och uppskattningarna går inte heller att läsa direkt. Svaren skickas till databasfunktionen `kb_svara`, som räknar poängen med databasens klocka. Bara storskärmen får veta vilken låt som spelas.
- **Alla skärmar går i takt.** Varje skärm räknar ut hur mycket den egna klockan skiljer sig från databasens.
- **Realtid.** Storskärmen och mobilerna lyssnar på ändringar i tabellerna `kb_rum`, `kb_spelare` och `kb_svar`.
- **Laddas en sida om**, eller somnar mobilen, hittar den tillbaka till rätt läge.
- **Städning.** Rum som inte använts på 12 timmar tas bort varje natt.

## Filerna

| Fil | Vad den gör |
|---|---|
| `supabase/kalabalik.sql` | Hela databasen: tabeller, regler, alla funktioner, frågor, låtar och uppskattningar |
| `docs/index.html`, `docs/spelare.js` | Spelarens sida |
| `docs/vard.html`, `docs/vard.js` | Storskärmen |
| `docs/musik.js` | Hämtar och spelar låtarna på storskärmen |
| `docs/utmaningar/*.js` | En fil per utmaning: hur den spelas på mobilen, visas på storskärmen och redovisas efteråt |
| `docs/gemensamt.js` | Knappsatsen, ljudeffekter, klocka, konfetti med mera |
| `docs/style.css` | Utseendet |
| `arkiv/action/` | Action-utmaningarna, vilande |
| `test/` | Automatiska tester (se nedan) |

## Testerna

Mappen `test/` innehåller en låtsas-Supabase som kör den riktiga SQL-filen i en lokal Postgres, med en låtsasversion av musikfunktionen. Den behövs inte för att spela, men gör det möjligt att prova hela spelet med en storskärm och tre mobiler i en automatisk webbläsare:

```bash
cd test && npm install && npm run vendor
node fake-supabase.mjs &      # kräver en lokal Postgres med supabase_stub.sql, kalabalik.sql och realtime_stub.sql
node sql-test.mjs              # databasen: poäng, rättigheter, fuskskydd
node flode-test.mjs            # en hel omgång från lobby till pall
```

Typsnittet är Fredoka (SIL Open Font License, se `docs/fonts/OFL.txt`).
