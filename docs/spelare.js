// Spelarens sida (mobil eller iPad).
// Gå med → vänta → intro → lös utmaningen → se resultatet → … → placering.

import { supabase } from "./supabase.js";
import {
  $, esc, AVATARER, GRUPPER, TYPER, klocka, ljud, vibrera, hallVaken, konfetti, bekrafta,
} from "./gemensamt.js";
import { UTMANINGAR } from "./utmaningar/index.js";

const SEKTIONER = ["laddar", "anslut", "vantar", "intro", "spel", "skickat", "resultat", "slut"];

let jag = null;          // min rad i kb_spelare
let rum = null;          // rummets rad, uppdateras i realtid
let kanal = null;
let stadaUtmaning = null;
let spelarRunda = null;  // rundan som visas just nu
let svaratRunda = null;  // rundan jag senast skickade svar på
let visadNyckel = null;  // så att samma läge inte ritas om i onödan

function visa(namn) {
  for (const s of SEKTIONER) $(s).hidden = s !== namn;
  document.body.dataset.lage = namn;
  window.scrollTo(0, 0);
}

async function anropa(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

// ---------- Inloggning ----------
// Spelare loggas in anonymt. Inget konto, inget lösenord.

async function sakerstallInloggning({ ny = false } = {}) {
  if (ny) await supabase.auth.signOut().catch(() => {});
  const { data: { session } } = await supabase.auth.getSession();
  if (session && !ny) return session.user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error("Kunde inte ansluta. Kontrollera nätet och försök igen.");
  return data.user;
}

// ---------- Formuläret ----------

let valdAvatar = null;
const sparat = (() => {
  try { return JSON.parse(localStorage.getItem("kb-jag")) ?? {}; } catch { return {}; }
})();

function ritaAvatarval() {
  valdAvatar ??= sparat.avatar ?? AVATARER[Math.floor(Math.random() * AVATARER.length)];
  $("avatarval").innerHTML = AVATARER.map((a) =>
    `<button type="button" data-a="${a}" aria-pressed="${a === valdAvatar}" aria-label="Figur ${a}">${a}</button>`).join("");
}

function fyllFormular() {
  if (sparat.namn && !$("namn").value) $("namn").value = sparat.namn;
  const grupp = jag?.grupp ?? sparat.grupp;
  if (grupp) document.querySelector(`input[name="grupp"][value="${grupp}"]`).checked = true;
  if (jag) {
    $("namn").value = jag.namn;
    valdAvatar = jag.avatar;
  }
  ritaAvatarval();
}

$("avatarval").addEventListener("click", (e) => {
  const k = e.target.closest("button");
  if (!k) return;
  ljud.vakna();
  ljud.klick();
  valdAvatar = k.dataset.a;
  ritaAvatarval();
});

$("kod").addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

$("anslutform").addEventListener("submit", async (e) => {
  e.preventDefault();
  ljud.vakna();
  const knapp = e.submitter ?? e.target.querySelector("button");
  const kod = $("kod").value.trim().toUpperCase();
  const namn = $("namn").value.trim();
  const grupp = document.querySelector('input[name="grupp"]:checked')?.value;
  $("fel").textContent = "";

  if (kod.length !== 4) return ($("fel").textContent = "Koden har fyra tecken. Den står på TV:n.");
  if (!namn) return ($("fel").textContent = "Skriv ditt namn.");
  if (!grupp) return ($("fel").textContent = "Välj hur gammal du är.");

  knapp.disabled = true;
  const args = { p_kod: kod, p_namn: namn, p_grupp: grupp, p_avatar: valdAvatar };
  try {
    await sakerstallInloggning();
    let data;
    try {
      data = await anropa("kb_ga_med", args);
    } catch (err) {
      // Anonyma konton städas bort efter ett dygn. Då skapar vi ett nytt.
      if (!/foreign key|JWT|token|sub claim/i.test(err.message)) throw err;
      await sakerstallInloggning({ ny: true });
      data = await anropa("kb_ga_med", args);
    }
    try { localStorage.setItem("kb-jag", JSON.stringify({ namn, grupp, avatar: valdAvatar })); } catch { /* ok */ }
    Object.assign(sparat, { namn, grupp, avatar: valdAvatar });
    ljud.pling();
    await gaIn(data.spelare, data.rum);
  } catch (err) {
    $("fel").textContent = err.message;
  } finally {
    knapp.disabled = false;
  }
});

// ---------- Rummet ----------

async function gaIn(spelare, rumRad) {
  const sammaRum = rum?.id === rumRad.id && kanal;
  jag = spelare;
  rum = rumRad;
  hallVaken.aktiv = true;
  hallVaken();

  if (!sammaRum) {
    if (kanal) await supabase.removeChannel(kanal);
    kanal = supabase
      .channel(`kb-${rum.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "kb_rum", filter: `id=eq.${rum.id}` }, (p) => {
        if (!("utmaning" in p.new)) return synka();
        rum = p.new;
        rendera();
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "kb_rum" }, (p) => {
        if (p.old?.id === rum?.id) lamnaRummet("Värden har stängt rummet.");
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "kb_spelare" }, (p) => {
        if (p.old?.id === jag?.id) lamnaRummet("Du är inte längre med i rummet.");
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") synka();
      });
  }
  visadNyckel = null;
  await synka();
}

// Hämtar hela läget från databasen (efter anslutning, omladdning eller när
// mobilen vaknar igen) och ställer klockan.
async function synka() {
  if (!rum) return;
  try {
    const skickad = Date.now();
    const l = await anropa("kb_lage", { p_rum: rum.id });
    klocka.synka(l?.nu, skickad, Date.now());
    if (!l) return lamnaRummet("Rummet finns inte längre.");
    if (!l.jag) return lamnaRummet("Du är inte längre med i rummet.");
    jag = l.jag;
    rum = l.rum;
    if (l.mitt_svar) svaratRunda = rum.runda;
    rendera();
  } catch (err) {
    if (/inte med/.test(err.message)) lamnaRummet("Du är inte längre med i rummet.");
  }
}

async function lamnaRummet(meddelande = "") {
  avbrytUtmaning();
  if (kanal) await supabase.removeChannel(kanal);
  kanal = null;
  jag = null;
  rum = null;
  svaratRunda = null;
  spelarRunda = null;
  visadNyckel = null;
  hallVaken.aktiv = false;
  fyllFormular();
  $("fel").textContent = meddelande;
  visa("anslut");
}

function avbrytUtmaning() {
  stadaUtmaning?.();
  stadaUtmaning = null;
}

// ---------- Lägena ----------

function rendera() {
  if (!rum || !jag) return;
  const nyckel = `${rum.status}:${rum.runda}`;

  // En utmaning som den här versionen inte känner igen: vänta på värden
  if (["intro", "spel", "resultat"].includes(rum.status) && !UTMANINGAR[rum.utmaning?.typ]) {
    if (visadNyckel !== nyckel) {
      visadNyckel = nyckel;
      avbrytUtmaning();
      visaVantar();
    }
    return;
  }

  if (rum.status === "spel") {
    if (svaratRunda === rum.runda) {
      if (visadNyckel !== `skickat:${rum.runda}`) visaSkickat("");
    } else if (spelarRunda !== rum.runda) {
      startaUtmaning();
    }
    return;
  }

  if (nyckel === visadNyckel) return;
  visadNyckel = nyckel;
  avbrytUtmaning();
  spelarRunda = null;

  if (rum.status === "lobby") {
    svaratRunda = null;
    visaVantar();
  } else if (rum.status === "intro") {
    visaIntro();
  } else if (rum.status === "resultat") {
    visaResultat();
  } else if (rum.status === "slut") {
    visaSlut();
  }
}

function visaVantar() {
  $("minavatar").textContent = jag.avatar;
  $("mittnamn").textContent = jag.namn;
  $("mingrupp").textContent = `${GRUPPER[jag.grupp].ikon} ${GRUPPER[jag.grupp].namn}`;
  visa("vantar");
}

function introHtml(u) {
  const typ = TYPER[u.typ];
  return `
    <span class="runda">Runda ${rum.runda} av ${rum.antal_rundor}</span>
    <span class="typikon" aria-hidden="true">${typ.ikon}</span>
    <h1>${esc(typ.namn)}</h1>
    <p>${esc(typ.instruktion)}</p>
    <span class="redo">Gör dig redo!</span>`;
}

function visaIntro() {
  const u = rum.utmaning;
  const kort = $("introkort");
  kort.className = `introkort f-${TYPER[u.typ].farg}`;
  kort.innerHTML = introHtml(u);
  ljud.swoosh();
  vibrera(30);
  visa("intro");
}

function startaUtmaning() {
  avbrytUtmaning();
  const u = rum.utmaning;
  const modul = UTMANINGAR[u.typ];
  spelarRunda = rum.runda;
  visadNyckel = `spel:${rum.runda}`;

  const yta = $("spelyta");
  yta.innerHTML = "";
  yta.className = `spelyta f-${TYPER[u.typ].farg}`;
  visa("spel");

  const runda = rum.runda;
  const slut = rum.slut_at ? klocka.lokal(rum.slut_at) : Date.now() + u.tid * 1000;
  let skickat = false;

  stadaUtmaning = modul.spela(yta, {
    utmaning: u,
    grupp: jag.grupp,
    avatar: jag.avatar,
    slut,
    klar(svar, { visa: text = "" } = {}) {
      if (skickat) return;
      skickat = true;
      skickaSvar(runda, svar, text);
    },
  });
}

async function skickaSvar(runda, svar, text) {
  svaratRunda = runda;
  avbrytUtmaning();
  visaSkickat(text);
  try {
    await anropa("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: svar });
  } catch (err) {
    $("skickatfel").textContent = err.message;
  }
}

function visaSkickat(text) {
  visadNyckel = `skickat:${rum.runda}`;
  $("skickatrubrik").textContent = "Svar skickat!";
  $("sammanfattning").textContent = text;
  $("sammanfattning").hidden = !text;
  $("skickatfel").textContent = "";
  visa("skickat");
}

async function visaResultat() {
  const u = rum.utmaning;
  let res;
  try {
    res = await anropa("kb_resultat", { p_rum: rum.id });
  } catch {
    return;
  }
  if (!res?.jag || rum.status !== "resultat") return;
  const r = UTMANINGAR[u.typ].mittResultat({ ...res.jag, grupp: jag.grupp }, u, res);

  const kort = $("resultatkort");
  kort.className = `lapp resultatkort ${r.bra ? "bra" : "inte"}`;
  kort.innerHTML = `
    <h1>${esc(r.rubrik)}</h1>
    ${r.text ? `<p class="detalj">${esc(r.text)}</p>` : ""}
    <p class="plus">+${res.jag.runda_poang}</p>`;
  $("placeringsrad").innerHTML =
    `Du ligger på plats <b>${res.jag.placering}</b> av ${res.antal}<br>${res.jag.poang} poäng totalt`;
  r.bra ? ljud.ratt() : ljud.fel();
  vibrera(r.bra ? [40, 60, 40] : 120);
  visa("resultat");
}

async function visaSlut() {
  let res;
  try {
    res = await anropa("kb_resultat", { p_rum: rum.id });
  } catch {
    return;
  }
  if (!res?.jag) return visaVantar();
  const p = res.jag.placering;
  $("medalj").textContent = ["🥇", "🥈", "🥉"][p - 1] ?? "🎉";
  $("slutplats").textContent = p === 1 ? "Du vann!" : `Plats ${p} av ${res.antal}`;
  $("slutpoang").textContent = `${res.jag.poang} poäng`;
  if (p <= 3) {
    konfetti(p === 1 ? 160 : 70);
    ljud.fanfar();
  }
  visa("slut");
}

// ---------- Knappar ----------

$("lamna").addEventListener("click", async () => {
  if (!(await bekrafta("Vill du lämna spelet?", { ok: "Lämna", avbryt: "Stanna kvar", farlig: true }))) return;
  const id = rum.id;
  await anropa("kb_lamna", { p_rum: id }).catch(() => {});
  await lamnaRummet();
});

$("andra").addEventListener("click", () => {
  fyllFormular();
  $("kod").value = rum.kod;
  visa("anslut");
});

$("ljudknapp").addEventListener("click", () => {
  ljud.vakna();
  $("ljudknapp").textContent = ljud.vaxla() ? "🔊" : "🔇";
});
$("ljudknapp").textContent = ljud.pa ? "🔊" : "🔇";

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && rum) synka();
});

// ---------- Uppstart ----------

const kodIUrl = (new URLSearchParams(location.search).get("kod") ?? "").toUpperCase();
$("kod").value = kodIUrl;
fyllFormular();

const { data: { session } } = await supabase.auth.getSession();
let mitt = null;
if (session) mitt = await anropa("kb_mitt_spel").catch(() => null);

if (mitt && (!kodIUrl || mitt.rum.kod === kodIUrl)) {
  await gaIn(mitt.spelare, mitt.rum);
} else {
  visa("anslut");
  if (kodIUrl) $("namn").focus();
}
