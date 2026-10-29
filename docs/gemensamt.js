// Sånt som både värdskärmen, mobilen och övningsläget använder.

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
// Namn, färg och en kort instruktion som visas (och läses upp) före varje runda.

export const TYPER = {
  fraga: {
    namn: "Frågan",
    ikon: "❓",
    farg: "sol",
    instruktion: "Svara rätt så snabbt du kan.",
  },
  matte: {
    namn: "Mattedags",
    ikon: "🧮",
    farg: "mint",
    instruktion: "Alla får ett tal som passar sin ålder.",
  },
  snabbast: {
    namn: "Vem trycker först?",
    ikon: "🚦",
    farg: "tomat",
    instruktion: "Vänta tills skärmen blir grön. Tryck då, så fort du kan!",
  },
  fanga: {
    namn: "Fånga!",
    ikon: "🐞",
    farg: "himmel",
    instruktion: "Tryck på djuren innan de försvinner. Rör inte kaktusarna!",
  },
  bana: {
    namn: "Action-banan",
    ikon: "🚀",
    farg: "rosa",
    instruktion: "Styr åt vänster och höger. Ta stjärnorna och undvik hindren!",
  },
};

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

// ---------- Uppläsning ----------

let lasUpp = true;
try { lasUpp = localStorage.getItem("kb-las") !== "av"; } catch { /* ok */ }

export const tal = {
  get pa() { return lasUpp && "speechSynthesis" in window; },
  vaxla() {
    lasUpp = !lasUpp;
    try { localStorage.setItem("kb-las", lasUpp ? "pa" : "av"); } catch { /* ok */ }
    if (!lasUpp) this.tyst();
    return lasUpp;
  },
  saga(text) {
    if (!this.pa) return;
    const s = window.speechSynthesis;
    s.cancel();
    const y = new SpeechSynthesisUtterance(text);
    y.lang = "sv-SE";
    y.rate = 0.95;
    const rost = s.getVoices().find((v) => v.lang?.toLowerCase().startsWith("sv"));
    if (rost) y.voice = rost;
    s.speak(y);
  },
  tyst() {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  },
};

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
