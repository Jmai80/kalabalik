import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Samma Supabase-projekt som Frågesport (wordle-projektet).
// Den publika nyckeln får synas, skyddet ligger i databasfunktionerna.
const SUPABASE_URL = "https://oyhbdwtwtjtskfzwysrc.supabase.co";
const SUPABASE_KEY = "sb_publishable_kiKGG5B390hjmaIMqi3GXA_H8Qb_vB_";

// KB_TEST finns bara när de automatiska testerna kör sidan mot en lokal testserver.
const test = globalThis.KB_TEST;

export const supabase = createClient(test?.url ?? SUPABASE_URL, test?.key ?? SUPABASE_KEY);
