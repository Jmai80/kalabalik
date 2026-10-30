# Action-utmaningarna (vilande)

Här ligger de tre action-utmaningarna från första versionen av Kalabalik. De är inte med i spelet just nu, men koden finns kvar så att den kan tas tillbaka.

| Fil | Utmaning |
|---|---|
| `snabbast.js` | Vem trycker först? Skärmen blir grön, snabbast vinner. |
| `fanga.js` | Fånga! Tryck på djuren, undvik kaktusarna. |
| `bana.js` | Action-banan. Byt fil, ta stjärnor och undvik hinder. |
| `action.css` | Stilarna till de tre. |

## Så tar man tillbaka en

1. Flytta filen till `docs/utmaningar/` och lägg till den i `docs/utmaningar/index.js` och i `TYPER` i `docs/gemensamt.js`.
2. Klistra in stilarna från `action.css` i `docs/style.css`.
3. Databasen behöver delarna för typen i `kb_ny_utmaning`, `kb_svara`, `kb_avsluta_runda` och `kb_vikter`. De finns i första versionen av `supabase/kalabalik.sql`, i commit `75e17df` (`git show 75e17df:supabase/kalabalik.sql`).
4. Fånga och Action-banan skickar live-ställning till storskärmen via `live(...)`. Det stödet togs bort ur `spelare.js` och `vard.js` och finns i samma commit.
