// Sånt som både storskärmen och mobilen använder.

export const $ = (id) => document.getElementById(id);

export function esc(text) {
  const d = document.createElement("div");
  d.textContent = String(text ?? "");
  return d.innerHTML;
}

export const vila = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Spelare ----------

export const AVATARER = [
  "🦊", "🐸", "🐼", "🐯", "🦁", "🐵", "🐧", "🐙",
  "🦄", "🐲", "🦖", "🐨", "🐷", "🐰", "🦉", "🐝",
];

export const GRUPPER = {
  liten: { ikon: "🐣", namn: "5–7 år" },
  mellan: { ikon: "🦊", namn: "8–12 år" },
  stor: { ikon: "🦉", namn: "13+ år" },
};

// ---------- Utmaningstyperna ----------
// Namn, färg och en kort instruktion som visas före varje runda.

export const TYPER = {
  fraga: {
    namn: "Kunskap",
    ikon: "🧠",
    farg: "sol",
    instruktion: "Svara rätt så snabbt du kan.",
  },
  gissaar: {
    namn: "Gissa året",
    ikon: "📻",
    farg: "rosa",
    instruktion: "Lyssna på låten. Vilket år kom den?",
  },
  vemsjunger: {
    namn: "Vem sjunger?",
    ikon: "🎤",
    farg: "himmel",
    instruktion: "Lyssna och välj rätt artist.",
  },
  narmast: {
    namn: "Närmast vinner",
    ikon: "🎯",
    farg: "tomat",
    instruktion: "Gissa ett tal. Den som kommer närmast vinner.",
  },
  matte: {
    namn: "Mattedags",
    ikon: "🧮",
    farg: "mint",
    instruktion: "Alla får ett tal som passar sin ålder.",
  },
};

// Kunskapsfrågornas kategorier
export const KATEGORIER = {
  geografi: { namn: "Geografi", ikon: "🌍", farg: "himmel" },
  underhallning: { namn: "Underhållning", ikon: "🎬", farg: "rosa" },
  historia: { namn: "Historia", ikon: "📜", farg: "sol" },
  kultur: { namn: "Kultur och litteratur", ikon: "🎭", farg: "lila" },
  natur: { namn: "Natur och vetenskap", ikon: "🔬", farg: "mint" },
  sport: { namn: "Sport och fritid", ikon: "🏅", farg: "orange" },
};

export const NIVAER = { 1: "Lätt", 2: "Medel", 3: "Svår" };

// Svarsalternativens färger och symboler, samma på storskärmen och mobilen.
export const SVARSFARGER = [
  { klass: "tomat", symbol: "▲", namn: "Röd" },
  { klass: "himmel", symbol: "◆", namn: "Blå" },
  { klass: "sol", symbol: "●", namn: "Gul" },
  { klass: "mint", symbol: "■", namn: "Grön" },
];

// ---------- Klockan ----------
// Databasens klocka styr. Varje skärm räknar ut hur mycket den egna klockan
// skiljer sig, så att alla nedräkningar går i takt.

let klockskillnad = 0;

export const klocka = {
  synka(serverNu, skickad, mottagen) {
    const server = Date.parse(serverNu);
    if (Number.isFinite(server)) klockskillnad = server - (skickad + mottagen) / 2;
  },
  // Lokal tidpunkt (Date.now()-skala) för en tidpunkt från databasen
  lokal(tidpunkt) {
    return Date.parse(tidpunkt) - klockskillnad;
  },
};

// ---------- Slump med frö ----------
// Alla mobiler får samma frö och bygger därför exakt samma bana.

export function slumpgenerator(fro) {
  let a = fro >>> 0;
  const slump = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  slump.heltal = (min, max) => min + Math.floor(slump() * (max - min + 1));
  slump.valj = (lista) => lista[Math.floor(slump() * lista.length)];
  return slump;
}

// ---------- Ljud ----------
// Alla ljud skapas i webbläsaren, så inga ljudfiler behövs.

let ac = null;
let ljudPa = true;
try { ljudPa = localStorage.getItem("kb-ljud") !== "av"; } catch { /* privat läge */ }

export const ljud = {
  get pa() { return ljudPa; },
  vaxla() {
    ljudPa = !ljudPa;
    try { localStorage.setItem("kb-ljud", ljudPa ? "pa" : "av"); } catch { /* ok */ }
    return ljudPa;
  },
  // Måste anropas från ett klick, annars får sidan inte spela ljud
  vakna() {
    try {
      ac ??= new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
    } catch { /* inget ljud */ }
  },
  ton(frekvens, langd = 0.12, { typ = "square", volym = 0.12, glid = 0, start = 0 } = {}) {
    if (!ljudPa || !ac) return;
    const t = ac.currentTime + start;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = typ;
    o.frequency.setValueAtTime(frekvens, t);
    if (glid) o.frequency.exponentialRampToValueAtTime(Math.max(30, frekvens + glid), t + langd);
    g.gain.setValueAtTime(volym, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + langd);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + langd + 0.02);
  },
  brus(langd = 0.25, volym = 0.15) {
    if (!ljudPa || !ac) return;
    const buf = ac.createBuffer(1, ac.sampleRate * langd, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const k = ac.createBufferSource();
    const g = ac.createGain();
    g.gain.value = volym;
    k.buffer = buf;
    k.connect(g).connect(ac.destination);
    k.start();
  },
  klick() { this.ton(660, 0.06, { typ: "triangle", volym: 0.1 }); },
  pling() { this.ton(988, 0.1, { typ: "triangle" }); this.ton(1319, 0.18, { typ: "triangle", start: 0.08 }); },
  plopp() { this.ton(420, 0.09, { typ: "sine", volym: 0.2, glid: 500 }); },
  aj() { this.ton(180, 0.3, { typ: "sawtooth", volym: 0.12, glid: -120 }); this.brus(0.2, 0.12); },
  ratt() { [523, 659, 784].forEach((f, i) => this.ton(f, 0.16, { typ: "triangle", start: i * 0.09 })); },
  fel() { this.ton(220, 0.25, { typ: "square", volym: 0.08 }); this.ton(196, 0.35, { typ: "square", volym: 0.08, start: 0.18 }); },
  tick() { this.ton(1200, 0.03, { typ: "square", volym: 0.05 }); },
  swoosh() { this.ton(200, 0.35, { typ: "sawtooth", volym: 0.06, glid: 900 }); this.brus(0.3, 0.06); },
  gong() { this.ton(110, 0.9, { typ: "sine", volym: 0.3 }); this.ton(220, 0.6, { typ: "triangle", volym: 0.08 }); },
  fanfar() {
    [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.52], [1047, 0.64]].forEach(([f, s]) =>
      this.ton(f, s === 0.64 ? 0.6 : 0.14, { typ: "square", volym: 0.08, start: s }));
  },
};

export function vibrera(monster) {
  try { navigator.vibrate?.(monster); } catch { /* ok */ }
}

// ---------- Konfetti ----------

export function konfetti(antal = 140) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const farger = ["#FFC83D", "#39D98A", "#FF5B4F", "#41AAF5", "#FF73B9", "#FFFDF6"];
  const lager = document.createElement("div");
  lager.className = "konfetti";
  for (let i = 0; i < antal; i++) {
    const bit = document.createElement("i");
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = farger[i % farger.length];
    bit.style.setProperty("--x", `${(Math.random() - 0.5) * 30}vw`);
    bit.style.setProperty("--r", `${Math.random() * 900 - 450}deg`);
    bit.style.animationDelay = `${Math.random() * 0.6}s`;
    bit.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
    lager.append(bit);
  }
  document.body.append(lager);
  setTimeout(() => lager.remove(), 5000);
}

// ---------- Skärmen ska inte slockna under spelet ----------

let vakenlas = null;
export async function hallVaken() {
  try {
    if (!vakenlas && "wakeLock" in navigator && document.visibilityState === "visible") {
      vakenlas = await navigator.wakeLock.request("screen");
      vakenlas.addEventListener("release", () => { vakenlas = null; });
    }
  } catch { /* stöds inte */ }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && vakenlas === null && hallVaken.aktiv) hallVaken();
});

// ---------- Nedräkning ----------
// Ritar en krympande stapel och/eller sekunder kvar. Returnerar en stoppfunktion.

export function nedrakning({ slut, stapel, siffra, vidNoll, tick }) {
  let senast = null;
  let stoppad = false;
  const total = Math.max(1, slut - Date.now());
  const steg = () => {
    if (stoppad) return;
    const kvar = Math.max(0, slut - Date.now());
    if (stapel) stapel.style.transform = `scaleX(${Math.min(1, kvar / total)})`;
    const sek = Math.ceil(kvar / 1000);
    if (siffra && sek !== senast) {
      siffra.textContent = sek;
      if (tick && sek <= 5 && sek > 0) tick(sek);
    }
    senast = sek;
    if (kvar <= 0) {
      stoppad = true;
      vidNoll?.();
      return;
    }
    requestAnimationFrame(steg);
  };
  steg();
  return () => { stoppad = true; };
}

export function sekunder(ms) {
  return (ms / 1000).toLocaleString("sv-SE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

// ---------- Egen bekräftelseruta (i stället för webbläsarens confirm) ----------

export function bekrafta(text, { ok = "OK", avbryt = "Avbryt", farlig = false } = {}) {
  const d = document.getElementById("dialog");
  d.innerHTML = `
    <p class="dialogtext">${esc(text)}</p>
    <div class="dialogknappar">
      <button type="button" class="diskret" data-svar="nej">${esc(avbryt)}</button>
      <button type="button" class="knapp ${farlig ? "tomat" : "mint"}" data-svar="ja">${esc(ok)}</button>
    </div>`;
  return new Promise((klar) => {
    const svar = (v) => {
      d.close();
      klar(v);
    };
    d.querySelector('[data-svar="ja"]').onclick = () => svar(true);
    d.querySelector('[data-svar="nej"]').onclick = () => svar(false);
    d.oncancel = () => klar(false);
    d.showModal();
    // Vid farliga val hamnar markören på den ofarliga knappen
    d.querySelector(farlig ? '[data-svar="nej"]' : '[data-svar="ja"]').focus();
  });
}

// ---------- Knappsats för tal och årtal ----------
// Ritar en sifferknappsats i el. Telefonens eget tangentbord används inte,
// eftersom det täcker halva skärmen och ser olika ut på olika telefoner.

export function knappsats(el, { maxLangd = 6, enhet = "", minVarde = null, maxVarde = null, tusental = true, svara }) {
  el.insertAdjacentHTML("beforeend", `
    <output class="matte-svar" aria-live="polite"><span class="varde">?</span>${enhet ? `<span class="enhet">${esc(enhet)}</span>` : ""}</output>
    <p class="knappsats-fel fel"></p>
    <div class="knappsats">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join("")}
      <button type="button" data-n="sudda" aria-label="Sudda">⌫</button>
      <button type="button" data-n="0">0</button>
      <button type="button" data-n="ok" class="ok" disabled>Svara</button>
    </div>`);

  let varde = "";
  const ut = el.querySelector(".matte-svar .varde");
  const ok = el.querySelector(".knappsats .ok");
  const fel = el.querySelector(".knappsats-fel");

  const rita = () => {
    ut.textContent = varde ? (tusental ? Number(varde).toLocaleString("sv-SE") : varde) : "?";
    ok.disabled = varde === "";
    fel.textContent = "";
  };
  const skicka = () => {
    const tal = Number(varde);
    if (varde === "") return;
    if ((minVarde !== null && tal < minVarde) || (maxVarde !== null && tal > maxVarde)) {
      fel.textContent = `Skriv ett tal mellan ${minVarde} och ${maxVarde}.`;
      return;
    }
    svara(tal);
  };
  const tryck = (n) => {
    if (n === "ok") return skicka();
    if (n === "sudda") varde = varde.slice(0, -1);
    else if (varde.length < maxLangd) varde = (varde + n).replace(/^0+(?=\d)/, "");
    rita();
  };

  el.querySelector(".knappsats").addEventListener("click", (e) => {
    const k = e.target.closest("button");
    if (!k || k.disabled) return;
    ljud.klick();
    tryck(k.dataset.n);
  });
  const tangent = (e) => {
    if (/^\d$/.test(e.key)) tryck(e.key);
    else if (e.key === "Backspace") tryck("sudda");
    else if (e.key === "Enter") tryck("ok");
  };
  document.addEventListener("keydown", tangent);
  return () => document.removeEventListener("keydown", tangent);
}

// Tal med mellanslag mellan tusental, som man skriver på svenska
export function talText(n) {
  return Number(n).toLocaleString("sv-SE");
}
