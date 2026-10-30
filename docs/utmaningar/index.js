// Alla utmaningstyper. En ny typ behöver en egen fil här, en rad nedan,
// en rad i TYPER i gemensamt.js och en del i kb_ny_utmaning, kb_svara och
// kb_vikter i supabase/kalabalik.sql.
//
// Action-utmaningarna från första versionen ligger i arkiv/action.

import fraga from "./fraga.js";
import gissaar from "./gissaar.js";
import vemsjunger from "./vemsjunger.js";
import narmast from "./narmast.js";
import matte from "./matte.js";

export const UTMANINGAR = { fraga, gissaar, vemsjunger, narmast, matte };

// Utmaningar där storskärmen spelar en låt
export const MUSIK = new Set(["gissaar", "vemsjunger"]);
