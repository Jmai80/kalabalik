// Övningsläget: kör en utmaning direkt på mobilen, utan rum och utan databas.
// Utmaningarna skapas här i webbläsaren, på samma sätt som databasen gör.

import { $, esc, TYPER, ljud, sekunder } from "./gemensamt.js";
import { UTMANINGAR } from "./utmaningar/index.js";

const OVNINGSFRAGOR = [
  ["Vilket djur har längst hals?", ["Giraffen", "Kamelen", "Strutsen", "Hästen"], "🦒"],
  ["Vilken planet kallas den röda planeten?", ["Mars", "Jupiter", "Venus", "Saturnus"], "🔴"],
  ["Vad blir vatten när det fryser?", ["Is", "Ånga", "Lera", "Sand"], "🧊"],
  ["Vilken färg blir det om man blandar blått och gult?", ["Grönt", "Lila", "Orange", "Brunt"], "🎨"],
  ["Hur många ben har en insekt?", ["6", "4", "8", "10"], "🐞"],
  ["Vad heter Sveriges högsta berg?", ["Kebnekaise", "Åreskutan", "Sylarna", "Helags"], "⛰️"],
];

const TID = { fraga: 25, matte: 25, snabbast: 12, fanga: 15, bana: 25 };
const FAKTOR = { liten: 2, mellan: 1.5, stor: 1 };
const r = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const blanda = (lista) => lista.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);

function mattetal(grupp) {
  if (grupp === "liten") {
    let a, b, svar, op;
    if (Math.random() < 0.7) { a = r(1, 5); b = r(1, 5); svar = a + b; op = "+"; }
    else { a = r(3, 9); b = r(1, Math.min(5, a - 1)); svar = a - b; op = "−"; }
    const alt = new Set([svar]);
    while (alt.size < 4) { const k = svar + [-2, -1, 1, 2, 3][r(0, 4)]; if (k >= 0) alt.add(k); }
    return { text: `${a} ${op} ${b}`, svar, a, b, op, alternativ: blanda([...alt]) };
  }
  if (grupp === "mellan") {
    const s = r(1, 4);
    if (s === 1) { const a = r(12, 59), b = r(8, 39); return { text: `${a} + ${b}`, svar: a + b }; }
    if (s === 2) { const a = r(30, 99), b = r(6, a - 10); return { text: `${a} − ${b}`, svar: a - b }; }
    if (s === 3) { const a = r(2, 10), b = r(3, 10); return { text: `${a} · ${b}`, svar: a * b }; }
    const b = r(2, 9), q = r(2, 10); return { text: `${b * q} / ${b}`, svar: q };
  }
  const s = r(1, 4);
  if (s === 1) { const a = r(13, 49), b = r(3, 9); return { text: `${a} · ${b}`, svar: a * b }; }
  if (s === 2) { const b = 20 * r(2, 12), p = [10, 20, 50][r(0, 2)]; return { text: `${p} % av ${b}`, svar: (p * b) / 100 }; }
  if (s === 3) { const a = r(3, 9), b = r(4, 9), c = r(5, Math.min(30, a * b - 1)); return { text: `${a} · ${b} − ${c}`, svar: a * b - c }; }
  const a = r(11, 19); return { text: `${a}²`, svar: a * a };
}

function skapa(typ, grupp) {
  const u = { typ, tid: TID[typ] };
  if (typ === "fraga") {
    const [fraga, alt, emoji] = OVNINGSFRAGOR[r(0, OVNINGSFRAGOR.length - 1)];
    const blandade = blanda(alt);
    return { ...u, fraga, emoji, alternativ: blandade, facit: { ratt: blandade.indexOf(alt[0]) } };
  }
  if (typ === "matte") {
    const t = mattetal(grupp);
    return { ...u, tal: { liten: t, mellan: t, stor: t }, facit: { [grupp]: t.svar } };
  }
  if (typ === "snabbast") {
    const vanta = r(2500, 6000);
    return { ...u, vanta_ms: vanta, falska: Array.from({ length: r(0, 2) }, () => r(900, vanta - 700)).sort((a, b) => a - b) };
  }
  if (typ === "fanga") return { ...u, fro: r(1, 999999), antal: 24 };
  return { ...u, fro: r(1, 999999), antal: 20, tema: ["rymd", "skog", "hav"][r(0, 2)] };
}

// Ungefär samma poäng som databasen ger (utom i "Vem trycker först?",
// där poängen beror på hur snabba de andra är)
function resultat(u, grupp, svar, ms) {
  if (u.typ === "fraga" || u.typ === "matte") {
    const ratt = u.typ === "fraga" ? svar.val === u.facit.ratt : svar.tal === u.facit[grupp];
    const poang = ratt ? 600 + Math.round(400 * Math.max(0, 1 - ms / (u.tid * 1000 * FAKTOR[grupp]))) : 0;
    const facit = u.typ === "fraga" ? u.alternativ[u.facit.ratt] : `${u.tal[grupp].text} = ${u.facit[grupp]}`;
    return { rubrik: ratt ? "Rätt!" : "Fel den här gången", text: ratt ? facit : `Rätt svar: ${facit}`, poang, bra: ratt };
  }
  if (u.typ === "snabbast") {
    if (svar.tjuvstart) return { rubrik: "Tjuvstart!", text: "Vänta tills skärmen blir grön.", poang: null, bra: false };
    if (!svar.ms) return { rubrik: "För sent", text: "Tryck så fort skärmen blir grön.", poang: null, bra: false };
    return { rubrik: svar.ms < 300 ? "Blixtsnabbt!" : "Bra!", text: `${sekunder(svar.ms)} sekunder`, poang: null, bra: true };
  }
  if (u.typ === "fanga") {
    const poang = Math.round((1000 * Math.max(0, svar.traffar - 2 * svar.bomber)) / u.antal);
    return { rubrik: "Bra fångat!", text: `${svar.traffar} av ${u.antal} djur${svar.bomber ? `, ${svar.bomber} 🌵` : ""}`, poang, bra: true };
  }
  const poang = Math.round((1000 * svar.stjarnor) / u.antal);
  return { rubrik: "Bra kört!", text: `${svar.stjarnor} av ${u.antal} stjärnor`, poang, bra: svar.stjarnor > 0 };
}

// ---------- Sidan ----------

const SEKTIONER = ["valj", "intro", "spel", "klar"];
const visa = (namn) => {
  SEKTIONER.forEach((s) => ($(s).hidden = s !== namn));
  document.body.dataset.lage = namn;
};
let senasteTyp = null;
let stada = null;

$("ovalista").innerHTML = Object.entries(TYPER).map(([typ, t]) => `
  <button type="button" class="typknapp f-${t.farg}" data-typ="${typ}">
    <span class="typikon" aria-hidden="true">${t.ikon}</span>
    <span><b>${esc(t.namn)}</b><small>${esc(t.instruktion)}</small></span>
  </button>`).join("");

const grupp = () => document.querySelector('input[name="grupp"]:checked').value;

function kor(typ) {
  ljud.vakna();
  senasteTyp = typ;
  const g = grupp();
  const u = skapa(typ, g);
  const t = TYPER[typ];
  $("introkort").className = `introkort f-${t.farg}`;
  $("introkort").innerHTML = `
    <span class="typikon" aria-hidden="true">${t.ikon}</span>
    <h1>${esc(t.namn)}</h1>
    <p>${esc(t.instruktion)}</p>
    <span class="redo">Gör dig redo!</span>`;
  visa("intro");
  ljud.swoosh();

  setTimeout(() => {
    const yta = $("spelyta");
    yta.innerHTML = "";
    yta.className = `spelyta f-${t.farg}`;
    visa("spel");
    const start = Date.now();
    let klart = false;
    stada = UTMANINGAR[typ].spela(yta, {
      utmaning: u,
      grupp: g,
      avatar: "🙂",
      slut: start + u.tid * 1000,
      live() {},
      klar(svar) {
        if (klart) return;
        klart = true;
        stada?.();
        visaResultat(u, g, svar, Date.now() - start);
      },
    });
    // Frågor och mattetal utan svar
    if (typ === "fraga" || typ === "matte") {
      setTimeout(() => {
        if (klart) return;
        klart = true;
        stada?.();
        visaResultat(u, g, {}, u.tid * 1000);
      }, u.tid * 1000);
    }
  }, 2200);
}

function visaResultat(u, g, svar, ms) {
  const res = resultat(u, g, svar, ms);
  $("resultatkort").className = `lapp resultatkort ${res.bra ? "bra" : "inte"}`;
  $("resultatkort").innerHTML = `
    <h1>${esc(res.rubrik)}</h1>
    <p class="detalj">${esc(res.text)}</p>
    ${res.poang !== null ? `<p class="plus">${res.poang} poäng</p>` : ""}`;
  res.bra ? ljud.ratt() : ljud.fel();
  visa("klar");
}

$("ovalista").addEventListener("click", (e) => {
  const b = e.target.closest(".typknapp");
  if (b) kor(b.dataset.typ);
});
$("igen").addEventListener("click", () => kor(senasteTyp));
$("annan").addEventListener("click", () => visa("valj"));

$("ljudknapp").addEventListener("click", () => {
  ljud.vakna();
  $("ljudknapp").textContent = ljud.vaxla() ? "🔊" : "🔇";
});
$("ljudknapp").textContent = ljud.pa ? "🔊" : "🔇";

// Gör det lätt att länka direkt till en utmaning: ova.html?typ=bana&grupp=liten
const p = new URLSearchParams(location.search);
if (p.get("grupp")) document.querySelector(`input[name="grupp"][value="${p.get("grupp")}"]`).checked = true;
if (p.get("typ") in TYPER) kor(p.get("typ"));
