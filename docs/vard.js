// Storskärmen (dator kopplad till TV eller projektor).
// Den styr tempot: visar introt, startar utmaningen, avslutar rundan när
// tiden är ute eller alla svarat, och går vidare efter resultatet.

import { supabase } from "./supabase.js";
import QRCode from "https://esm.sh/qrcode@1";
import {
  $, esc, GRUPPER, TYPER, klocka, ljud, konfetti, hallVaken, nedrakning, bekrafta,
} from "./gemensamt.js";
import { UTMANINGAR, MUSIK } from "./utmaningar/index.js";
import * as musik from "./musik.js";

const INTRO_MS = 6000;      // hur länge introt visas
const AUTO_NASTA_S = 15;    // sekunder innan nästa runda startar av sig själv
const SEKTIONER = ["laddar", "login", "start", "lobby", "tvintro", "tvspel", "tvresultat", "tvslut"];

let rum = null;
let spelare = [];             // [{ id, namn, avatar, grupp, poang }]
let svarade = new Set();      // spelare som svarat på aktuell runda
let kanal = null;
let lat = null;               // { runda, traff, info, lofte }: låten i aktuell musikrunda
let visadNyckel = null;
let modulVy = null;
let timers = [];
let stoppNedrakning = null;
let pausad = false;
let antalRundor = 12;
try { antalRundor = Number(localStorage.getItem("kb-rundor")) || 12; } catch { /* ok */ }

function visa(namn) {
  for (const s of SEKTIONER) $(s).hidden = s !== namn;
}

async function anropa(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

function rensaTimers() {
  timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
  timers = [];
  stoppNedrakning?.();
  stoppNedrakning = null;
}

function typMarke(el, typ) {
  const t = TYPER[typ];
  el.className = `typmarke f-${t.farg}`;
  el.innerHTML = `<span aria-hidden="true">${t.ikon}</span> ${esc(t.namn)}`;
}

// ---------- Rummet ----------

async function oppnaRum(r) {
  rum = r;
  const adress = new URL("./", location.href);
  $("adress").textContent = (adress.host + adress.pathname).replace(/\/$/, "");
  $("rumskod").innerHTML = [...rum.kod].map((c) => `<span>${c}</span>`).join("");
  const lank = new URL(`./?kod=${rum.kod}`, location.href).href;
  $("qr").innerHTML = await QRCode.toString(lank, {
    type: "svg",
    margin: 1,
    color: { dark: "#17112f", light: "#fffdf6" },
  });

  if (kanal) await supabase.removeChannel(kanal);
  const id = rum.id;
  kanal = supabase
    .channel(`kb-${id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "kb_rum", filter: `id=eq.${id}` }, (p) => {
      if (!("utmaning" in p.new)) return synka();
      rum = p.new;
      rendera();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "kb_spelare", filter: `rum_id=eq.${id}` }, (p) => {
      if (!spelare.some((s) => s.id === p.new.id)) spelare.push(p.new);
      if (rum.status === "lobby") ljud.plopp();
      ritaSpelare();
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "kb_spelare", filter: `rum_id=eq.${id}` }, (p) => {
      spelare = spelare.map((s) => (s.id === p.new.id ? { ...s, ...p.new } : s));
      ritaSpelare();
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "kb_spelare" }, (p) => {
      spelare = spelare.filter((s) => s.id !== p.old?.id);
      ritaSpelare();
      kollaOmAllaSvarat();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "kb_svar", filter: `rum_id=eq.${id}` }, (p) => {
      if (p.new.runda !== rum.runda) return;
      svarade.add(p.new.spelare_id);
      ritaSvarade();
      kollaOmAllaSvarat();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") synka();
    });

  hallVaken.aktiv = true;
  hallVaken();
  await synka();
}

async function synka() {
  if (!rum) return;
  const skickad = Date.now();
  const l = await anropa("kb_lage", { p_rum: rum.id }).catch(() => null);
  if (!l) {
    stangRum();
    return visa("start");
  }
  klocka.synka(l.nu, skickad, Date.now());
  rum = l.rum;
  spelare = l.spelare;
  svarade = new Set(l.svarade);
  visadNyckel = null;
  rendera();
}

async function stangRum() {
  rensaTimers();
  musik.stoppa(false);
  if (kanal) await supabase.removeChannel(kanal);
  kanal = null;
  rum = null;
  spelare = [];
  hallVaken.aktiv = false;
}

// ---------- Rendering ----------

function rendera() {
  if (!rum) return;
  const nyckel = `${rum.status}:${rum.runda}`;
  if (nyckel === visadNyckel) {
    ritaSpelare();
    return;
  }
  visadNyckel = nyckel;
  rensaTimers();
  modulVy = null;

  if (rum.status === "lobby") visaLobby();
  else if (rum.status === "intro") visaIntro();
  else if (rum.status === "spel") visaSpel();
  else if (rum.status === "resultat") visaResultat();
  else if (rum.status === "slut") visaSlut();
}

// ---------- Lobbyn ----------

function visaLobby() {
  musik.stoppa();
  ritaSpelare();
  ritaVal();
  $("lobbyfel").textContent = "";
  visa("lobby");
}

function ritaVal() {
  document.querySelectorAll(".rundval button").forEach((b) =>
    b.setAttribute("aria-pressed", String(Number(b.dataset.antal) === antalRundor)));
  $("vaxelljud").setAttribute("aria-pressed", String(ljud.pa));
  $("vaxelljud").textContent = ljud.pa ? "🔊 Ljudeffekter" : "🔇 Inga ljudeffekter";
}

function ritaSpelare() {
  if (rum?.status === "lobby") {
    $("antalspelare").textContent = spelare.length === 0
      ? "Väntar på spelare …"
      : spelare.length === 1 ? "1 spelare är med" : `${spelare.length} spelare är med`;
    $("spelarbubblor").innerHTML = spelare.length
      ? spelare.map((s) => `
          <li><button type="button" class="spelarbubbla" data-id="${s.id}" title="Klicka för att ta bort ${esc(s.namn)}">
            <span class="avatar">${esc(s.avatar)}</span>
            <span class="namn">${esc(s.namn)}</span>
            <span class="grupp">${GRUPPER[s.grupp]?.ikon ?? ""} ${GRUPPER[s.grupp]?.namn ?? ""}</span>
          </button></li>`).join("")
      : `<li class="tomt">Skanna QR-koden med mobilen för att vara med.</li>`;
    $("starta").disabled = spelare.length === 0;
  }
  if (rum?.status === "spel") ritaSvarade();
}

// ---------- Introt ----------

function visaIntro() {
  const u = rum.utmaning;
  const t = TYPER[u.typ];
  svarade = new Set();
  musik.stoppa();
  if (MUSIK.has(u.typ)) forberedLat();
  const kort = $("tvintrokort");
  kort.className = `introkort f-${t.farg}`;
  kort.innerHTML = `
    <span class="runda">Runda ${rum.runda} av ${rum.antal_rundor}</span>
    <span class="typikon" aria-hidden="true">${t.ikon}</span>
    <h1>${esc(t.namn)}</h1>
    <p>${esc(t.instruktion)}</p>`;
  visa("tvintro");
  ljud.swoosh();

  const stapel = $("introstapel");
  stoppNedrakning = nedrakning({ slut: Date.now() + INTRO_MS, stapel });
  timers.push(setTimeout(borja, INTRO_MS));
}

async function borja() {
  try {
    await anropa("kb_borja", { p_rum: rum.id });
  } catch {
    timers.push(setTimeout(borja, 1500)); // försök igen om nätet hackade
  }
}

// ---------- Musiken ----------
// Under introt letar storskärmen upp låten och laddar ljudet, så att det
// kan starta direkt när rundan börjar.

function forberedLat() {
  const runda = rum.runda;
  if (lat?.runda === runda) return lat.lofte;
  const ny = { runda, traff: null, info: null };
  ny.lofte = (async () => {
    try {
      ny.info = await anropa("kb_musik", { p_rum: rum.id });
      if (ny.info) ny.traff = await musik.forbered(ny.info);
    } catch {
      ny.traff = null;
    }
    return ny;
  })();
  lat = ny;
  return ny.lofte;
}

// Visar en rad under skivan när låten inte går att spela
function musikstatus(text, knapp = false) {
  const el = $("tvinnehall").querySelector(".musikstatus");
  if (!el) return;
  el.hidden = !text;
  el.innerHTML = text + (knapp ? ` <button type="button" class="knapp krita" id="spelalat">▶ Spela låten</button>` : "");
}

async function startaMusik() {
  const runda = rum.runda;
  const u = rum.utmaning;
  const l = await Promise.race([forberedLat(), new Promise((r) => setTimeout(() => r(null), 4000))]);
  if (rum?.runda !== runda || rum.status !== "spel") return;

  if (!l?.traff) {
    // Låten fanns inte hos iTunes. Då blir det en vanlig fråga i stället.
    const info = l?.info;
    if (!info) return musikstatus("Låten gick inte att hämta.");
    musikstatus(u.typ === "gissaar"
      ? `Låten gick inte att spela. Det är <b>${esc(info.titel)}</b> med <b>${esc(info.artist)}</b>.`
      : `Låten gick inte att spela. Den heter <b>${esc(info.titel)}</b>.`);
    return;
  }
  $("tvinnehall").querySelector(".skiva")?.classList.add("snurrar");
  if (!(await musik.spela())) {
    musikstatus("Webbläsaren stoppade ljudet.", true);
  }
}

$("tvinnehall").addEventListener("click", async (e) => {
  if (!e.target.closest("#spelalat")) return;
  if (await musik.spela()) musikstatus("");
});

musik.narLjudetAndras((spelar) => {
  $("musikknapp").textContent = spelar ? "⏸ Pausa musiken" : "▶ Spela musiken";
  document.querySelector(".skiva")?.classList.toggle("snurrar", spelar);
});
$("musikknapp").addEventListener("click", () => {
  if (musik.spelar()) musik.pausa();
  else musik.fortsatt();
});

// ---------- Spelet ----------

function visaSpel() {
  const u = rum.utmaning;
  const modul = UTMANINGAR[u.typ];
  $("spelrunda").textContent = `Runda ${rum.runda} av ${rum.antal_rundor}`;
  typMarke($("speltyp"), u.typ);
  $("musikknapp").hidden = !MUSIK.has(u.typ);

  const slut = klocka.lokal(rum.slut_at);
  modulVy = modul.storskarm($("tvinnehall"), { utmaning: u, spelare: [...spelare], slut }) ?? {};
  ritaSvarade();
  visa("tvspel");
  if (MUSIK.has(u.typ)) startaMusik();

  const nedEl = $("nedrakning");
  nedEl.classList.remove("brattom");
  stoppNedrakning = nedrakning({
    slut,
    siffra: nedEl,
    tick: (sek) => {
      if (!MUSIK.has(u.typ)) ljud.tick();
      if (sek <= 5) nedEl.classList.add("brattom");
    },
  });

  // setInterval i stället för requestAnimationFrame, så att rundan avslutas
  // även om fliken råkar ligga i bakgrunden
  timers.push(setInterval(() => {
    if (Date.now() >= slut + 700) avslutaRunda();
  }, 250));
  kollaOmAllaSvarat();
}

function ritaSvarade() {
  if (rum?.status !== "spel") return;
  $("svaradeavatarer").innerHTML = spelare.map((s) =>
    `<span class="${svarade.has(s.id) ? "klar" : ""}" title="${esc(s.namn)}">${esc(s.avatar)}</span>`).join("");
  const klara = spelare.filter((s) => svarade.has(s.id)).length;
  $("svaradeantal").textContent = `${klara} av ${spelare.length} klara`;
}

let avslutar = false;
function kollaOmAllaSvarat() {
  if (rum?.status !== "spel" || spelare.length === 0) return;
  if (spelare.every((s) => svarade.has(s.id))) timers.push(setTimeout(avslutaRunda, 800));
}

async function avslutaRunda() {
  if (avslutar || rum?.status !== "spel") return;
  avslutar = true;
  try {
    await anropa("kb_avsluta_runda", { p_rum: rum.id });
  } catch {
    /* nästa tick försöker igen */
  } finally {
    avslutar = false;
  }
}

// ---------- Resultatet ----------

async function visaResultat() {
  const u = rum.utmaning;
  const runda = rum.runda;
  let res;
  try {
    res = await anropa("kb_resultat", { p_rum: rum.id });
  } catch {
    return;
  }
  if (!res || rum.status !== "resultat" || rum.runda !== runda) return;

  $("resrunda").textContent = `Runda ${rum.runda} av ${rum.antal_rundor}`;
  typMarke($("restyp"), u.typ);
  // Musiken fortsätter spela medan resultatet visas
  let traff = null;
  if (MUSIK.has(u.typ)) traff = (await forberedLat())?.traff ?? null;
  if (rum.status !== "resultat" || rum.runda !== runda) return;
  UTMANINGAR[u.typ].facit($("facitdel"), u, res, { lat: traff });
  $("resmusik").hidden = !MUSIK.has(u.typ) || !traff;

  const rundpoang = Object.fromEntries(res.runda.map((r) => [r.spelare_id, r.poang]));
  $("topplista").innerHTML = res.topplista.slice(0, 8).map((t) => `
    <li>
      <span class="plats">${t.placering}</span>
      <span class="avatar">${esc(t.avatar)}</span>
      <span class="namn">${esc(t.namn)}</span>
      <span class="plus ${rundpoang[t.spelare_id] ? "" : "noll"}">+${rundpoang[t.spelare_id] ?? 0}</span>
      <span class="summa">${t.poang}</span>
    </li>`).join("");

  const sista = rum.runda >= rum.antal_rundor;
  $("nasta").textContent = sista ? "Vem vann?" : "Nästa runda";
  visa("tvresultat");
  if (!MUSIK.has(u.typ)) ljud.gong();

  startaAutoNasta();
}

function startaAutoNasta() {
  rensaTimers();
  const vantetid = $("vantetid");
  if (pausad) {
    vantetid.textContent = "Pausat. Tryck på Nästa när ni är redo.";
    $("paus").textContent = "Fortsätt";
    return;
  }
  $("paus").textContent = "Pausa";
  const slut = Date.now() + AUTO_NASTA_S * 1000;
  const sista = rum.runda >= rum.antal_rundor;
  const tick = () => {
    const kvar = Math.max(0, Math.ceil((slut - Date.now()) / 1000));
    vantetid.textContent = sista ? `Vinnaren visas om ${kvar} s` : `Nästa runda om ${kvar} s`;
    if (kvar === 0) nasta();
  };
  tick();
  timers.push(setInterval(tick, 250));
}

async function nasta() {
  rensaTimers();
  pausad = false; // pausen gäller bara den här resultatsidan
  try {
    await anropa("kb_nasta", { p_rum: rum.id });
  } catch (err) {
    $("vantetid").textContent = err.message;
  }
}

// ---------- Slutet ----------

async function visaSlut() {
  musik.stoppa();
  let res;
  try {
    res = await anropa("kb_resultat", { p_rum: rum.id });
  } catch {
    return;
  }
  if (!res) return;
  const lista = res.topplista;
  const plats = (i) => {
    const t = lista[i];
    if (!t) return `<div class="pallplats p${i + 1}"></div>`;
    return `
      <div class="pallplats p${i + 1}">
        <span class="avatar">${esc(t.avatar)}</span>
        <span class="namn">${esc(t.namn)}</span>
        <span class="poang">${t.poang} poäng</span>
        <span class="kloss">${t.placering}</span>
      </div>`;
  };
  $("pall").innerHTML = plats(1) + plats(0) + plats(2);
  $("ovriga").innerHTML = lista.slice(3).map((t) =>
    `<span>${t.placering}. ${esc(t.avatar)} ${esc(t.namn)} ${t.poang}</span>`).join("");
  visa("tvslut");
  timers.push(setTimeout(() => {
    konfetti(220);
    ljud.fanfar();
  }, 1500));
}

// ---------- Knappar ----------

$("loginform").addEventListener("submit", async (e) => {
  e.preventDefault();
  ljud.vakna();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: $("epost").value.trim(),
    password: $("losen").value,
  });
  if (error) {
    $("loginfel").textContent = "Fel e-post eller lösenord.";
    return;
  }
  $("loginfel").textContent = "";
  await efterInloggning(data.user);
});

$("loggaut").addEventListener("click", async () => {
  await supabase.auth.signOut();
  visa("login");
});

$("skapa").addEventListener("click", async () => {
  ljud.vakna();
  $("startfel").textContent = "";
  try {
    await oppnaRum(await anropa("kb_skapa_rum"));
  } catch (err) {
    $("startfel").textContent = err.message;
  }
});

document.querySelector(".rundval").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  antalRundor = Number(b.dataset.antal);
  try { localStorage.setItem("kb-rundor", String(antalRundor)); } catch { /* ok */ }
  ljud.klick();
  ritaVal();
});

$("vaxelljud").addEventListener("click", () => {
  ljud.vakna();
  ljud.vaxla();
  ljud.klick();
  ritaVal();
});


$("starta").addEventListener("click", async () => {
  ljud.vakna();
  $("lobbyfel").textContent = "";
  $("starta").disabled = true;
  try {
    await anropa("kb_starta", { p_rum: rum.id, p_antal: antalRundor });
  } catch (err) {
    $("lobbyfel").textContent = err.message;
    $("starta").disabled = false;
  }
});

$("spelarbubblor").addEventListener("click", async (e) => {
  const b = e.target.closest(".spelarbubbla");
  if (!b) return;
  const s = spelare.find((x) => x.id === b.dataset.id);
  if (!s || !(await bekrafta(`Ta bort ${s.namn} från rummet?`, { ok: "Ta bort", farlig: true }))) return;
  await anropa("kb_sparka", { p_spelare: s.id }).catch(() => {});
});

$("hoppa").addEventListener("click", avslutaRunda);

$("nasta").addEventListener("click", () => {
  ljud.vakna();
  nasta();
});

$("paus").addEventListener("click", () => {
  pausad = !pausad;
  startaAutoNasta();
});

async function tillbakaTillLobbyn() {
  rensaTimers();
  await anropa("kb_till_lobbyn", { p_rum: rum.id }).catch(() => {});
}

$("avbryt").addEventListener("click", async () => {
  const pa = !pausad;
  if (pa) { pausad = true; startaAutoNasta(); }
  if (await bekrafta("Avbryta spelet? Poängen nollställs, men alla spelare är kvar i lobbyn.", {
    ok: "Avbryt spelet", avbryt: "Fortsätt spela", farlig: true,
  })) {
    pausad = false;
    await tillbakaTillLobbyn();
  } else if (pa) {
    pausad = false;
    startaAutoNasta();
  }
});

$("igen").addEventListener("click", tillbakaTillLobbyn);

async function stangRummet() {
  if (!(await bekrafta("Stänga rummet? Alla spelare kopplas bort.", { ok: "Stäng rummet", farlig: true }))) return;
  const id = rum.id;
  await stangRum();
  await anropa("kb_stang_rum", { p_rum: id }).catch(() => {});
  visa("start");
}
$("stangrum").addEventListener("click", stangRummet);
$("stangrum2").addEventListener("click", stangRummet);

// Ljud får bara spelas efter ett klick på sidan. Första klicket låser upp.
for (const h of ["pointerdown", "keydown"]) {
  document.addEventListener(h, () => {
    ljud.vakna();
    musik.lasUpp();
  });
}
$("resmusik").addEventListener("click", () => {
  if (musik.spelar()) musik.pausa();
  else musik.fortsatt();
});
musik.narLjudetAndras((spelar) => {
  $("resmusik").textContent = spelar ? "⏸ Pausa musiken" : "▶ Spela musiken";
});

// ---------- Uppstart ----------

async function efterInloggning() {
  const r = await anropa("kb_vardrum").catch(() => null);
  if (r) await oppnaRum(r);
  else visa("start");
}

const { data: { session } } = await supabase.auth.getSession();
if (session && !session.user.is_anonymous) await efterInloggning();
else visa("login");
