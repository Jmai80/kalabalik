// Alla utmaningstyper. En ny typ behöver en egen fil här, en rad nedan,
// en rad i TYPER i gemensamt.js och en del i kb_ny_utmaning och kb_svara
// i supabase/kalabalik.sql.

import fraga from "./fraga.js";
import matte from "./matte.js";
import snabbast from "./snabbast.js";
import fanga from "./fanga.js";
import bana from "./bana.js";

export const UTMANINGAR = { fraga, matte, snabbast, fanga, bana };
