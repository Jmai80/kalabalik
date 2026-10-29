# Kalabalik

Ett partyspel för hela familjen, från 5 till 80 år. Alla går med på sina egna mobiler eller plattor genom att skanna en QR-kod, precis som i Kahoot. Sedan slumpar spelet fram en omgång utmaningar:

| | Utmaning | Vad man gör |
|---|---|---|
| ❓ | **Frågan** | En fråga ur frågebanken. Storskärmen visar och läser upp den, och man svarar med färgade knappar på mobilen. |
| 🧮 | **Mattedags** | Varje åldersgrupp får ett eget tal. De minsta räknar frukter och väljer bland fyra svar, de äldre skriver svaret på en knappsats. |
| 🚦 | **Vem trycker först?** | Skärmen är röd, blinkar ibland gult för att lura, och blir sedan grön. Den som trycker snabbast vinner. |
| 🐞 | **Fånga!** | Djur dyker upp och försvinner snart. Tryck på så många du hinner, men inte på kaktusarna. |
| 🚀 | **Action-banan** | Byt fil åt vänster och höger, ta stjärnor och undvik hinder. Storskärmen visar ett race i realtid. |

**Sidorna**

- Spelare: https://jmai80.github.io/kalabalik/
- Storskärmen (värden): https://jmai80.github.io/kalabalik/vard
- Öva på egen hand: https://jmai80.github.io/kalabalik/ova

## Rättvist mellan 5 och 80 år

Varje spelare väljer åldersgrupp när hen går med: 🐣 5–7 år, 🦊 8–12 år eller 🦉 13+ år.

- **Mattetalen** anpassas efter gruppen.
- **Fartbonusen** på frågor och mattetal räknas mot dubbelt så lång tid för de minsta och 1,5 gånger så lång tid för mellangruppen.
- **Vem trycker först?** ger 0,2 sekunders försprång till de minsta och 0,08 sekunder till mellangruppen. De minsta slipper dessutom de gula fällorna.
- **Fånga!** har djur som stannar längre och färre kaktusar för de yngre.
- **Action-banan** går långsammare och har färre hinder för de yngre.
- **Frågebanken** växlar mellan lätta, mellansvåra och kluriga frågor.

Alla siffror går att ändra, se nedan.

## Så installerar du (görs en gång)

1. **Databasen.** Öppna **SQL Editor** i Supabase-projektet **wordle**, välj **New query**, klistra in hela `supabase/kalabalik.sql` och tryck **Run**. Filen går att köra igen när du ändrat något i den.
2. **GitHub Pages.** I repot på GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Varje `git push` publicerar sedan sidan automatiskt efter någon minut.

Kalabalik använder samma värdkonto och samma anonyma inloggning som Frågesport, så inga inställningar i Supabase behöver ändras.

## Så spelar ni

1. Öppna **storskärmen** på datorn som är kopplad till TV:n, logga in och tryck **Skapa ett rum**.
2. Alla skannar QR-koden, skriver sitt namn, väljer ålder och en figur.
3. Välj antal rundor (5, 8 eller 12) och tryck **Starta!**
4. Spelet går vidare av sig självt. Efter varje runda visas resultatet i 15 sekunder. Du kan trycka **Pausa** eller **Nästa runda**.
5. Efter sista rundan visas pallen. **Spela igen** startar en ny omgång med samma spelare.

Klicka på en spelare i lobbyn för att ta bort hen. Den som kommer in mitt i ett spel är med från nästa runda.

## Ändra och bygga ut

| Vad | Var |
|---|---|
| Lägga till frågor | Längst ned i `supabase/kalabalik.sql`. Det första alternativet är alltid det rätta, spelet blandar ordningen. Kör sedan filen igen. |
| Tid per utmaning | `kb_tid` i `supabase/kalabalik.sql` |
| Hjälpen till de yngre | `kb_tidsfaktor` och `kb_forsprang` i `supabase/kalabalik.sql`, och `FART`, `LIVSTID` och `KAKTUSAR` i `docs/utmaningar/` |
| Hur ofta varje utmaning kommer | `vikter` i `kb_slumpa_plan` |
| Nya teman till action-banan | `TEMAN` i `docs/utmaningar/bana.js` |
| Namn och instruktioner | `TYPER` i `docs/gemensamt.js` |

**En ny sorts utmaning** behöver en egen fil i `docs/utmaningar/` (kopiera en befintlig), en rad i `docs/utmaningar/index.js`, en rad i `TYPER` i `docs/gemensamt.js` och en del i `kb_ny_utmaning` och `kb_svara` i SQL-filen.

## Så fungerar det

- **Ingen kan fuska till sig poäng.** Facit ligger i tabellen `kb_hemligt`, som ingen kan läsa. Svaren skickas till databasfunktionen `kb_svara`, som räknar poängen med databasens klocka. I action-utmaningarna rapporterar mobilen sitt resultat, men databasen godtar aldrig mer än vad banan innehöll.
- **Alla skärmar går i takt.** Varje skärm räknar ut hur mycket den egna klockan skiljer sig från databasens. Action-banan byggs av ett gemensamt slumptal, så alla i samma åldersgrupp får exakt samma bana.
- **Realtid.** Storskärmen och mobilerna lyssnar på ändringar i tabellerna `kb_rum`, `kb_spelare` och `kb_svar`. Live-ställningen i Fånga! och Action-banan skickas direkt mellan skärmarna (Supabase broadcast).
- **Laddas en sida om**, eller somnar mobilen, hittar den tillbaka till rätt läge.
- **Städning.** Rum som inte använts på 12 timmar tas bort varje natt.

## Filerna

| Fil | Vad den gör |
|---|---|
| `supabase/kalabalik.sql` | Hela databasen: tabeller, regler, alla funktioner och frågebanken |
| `docs/index.html`, `docs/spelare.js` | Spelarens sida |
| `docs/vard.html`, `docs/vard.js` | Storskärmen |
| `docs/ova.html`, `docs/ova.js` | Övningsläget, fungerar utan databas |
| `docs/utmaningar/*.js` | En fil per utmaning: hur den spelas på mobilen, visas på storskärmen och redovisas efteråt |
| `docs/gemensamt.js` | Ljud, uppläsning, klocka, konfetti med mera |
| `docs/style.css` | Utseendet |
| `test/` | Automatiska tester (se nedan) |

## Testerna

Mappen `test/` innehåller en låtsas-Supabase som kör den riktiga SQL-filen i en lokal Postgres. Den behövs inte för att spela, men gör det möjligt att prova hela spelet med en storskärm och tre mobiler i en automatisk webbläsare:

```bash
cd test && npm install && npm run vendor
node fake-supabase.mjs &      # kräver en lokal Postgres med supabase_stub.sql, kalabalik.sql och realtime_stub.sql
node sql-test.mjs              # databasen: poäng, rättigheter, fuskskydd
node ova-test.mjs              # alla utmaningar i övningsläget
node flode-test.mjs            # en hel omgång från lobby till pall
```

Typsnittet är Fredoka (SIL Open Font License, se `docs/fonts/OFL.txt`).
