// Musiken på storskärmen. Låtarna hämtas från iTunes via Edge Functionen
// "media" i Supabase, samma funktion som Frågesport använder. Den ger ett
// 30 sekunders provlyssningsklipp och ett skivomslag.
//
// Databasen bestämmer låten. Här letar vi upp rätt inspelning bland
// sökträffarna: samma artist, samma titel, och helst inte en liveversion,
// remix eller karaokeversion.

import { supabase } from "./supabase.js";

const ljud = new Audio();
ljud.preload = "auto";

// Webbläsare spelar bara ljud efter att någon klickat på sidan. Safari
// kräver dessutom att just det här ljudelementet startats av ett klick en
// gång. lasUpp() anropas därför från knapparna på storskärmen.
const TYST = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
let upplast = false;

export function lasUpp() {
  if (upplast) return;
  upplast = true;
  if (!ljud.src) ljud.src = TYST;
  ljud.play().then(() => ljud.pause()).catch(() => { upplast = false; });
}

function normalisera(text) {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // é → e, men å/ä/ö blir a/a/o, det gör inget här
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s-\s.*$/, " ")                            // "Låt - Remastered 2011"
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const OONSKAT = /\b(live|karaoke|instrumental|remix|mix|cover|tribute|acoustic|akustisk|demo|version|edit|medley|re-?recorded|sped up|slowed)\b/i;

export function basta(traffar, { artist, titel }) {
  const a = normalisera(artist);
  const t = normalisera(titel);
  let bast = null;
  let bastPoang = -Infinity;
  for (const r of traffar ?? []) {
    if (!r?.ljud) continue;
    const ra = normalisera(r.artist);
    const rt = normalisera(r.titel);
    if (!ra || !rt) continue;
    const artistOk = ra === a || ra.includes(a) || a.includes(ra);
    const titelOk = rt === t || rt.startsWith(t) || t.startsWith(rt);
    if (!artistOk || !titelOk) continue;
    let poang = 0;
    if (ra === a) poang += 3;
    if (rt === t) poang += 3;
    if (OONSKAT.test(r.titel)) poang -= 5;
    if (OONSKAT.test(r.album ?? "")) poang -= 2;
    if (/greatest|best of|hits|collection|essential|gold|samlade/i.test(r.album ?? "")) poang -= 0.5;
    if (poang > bastPoang) {
      bast = r;
      bastPoang = poang;
    }
  }
  return bast;
}

const cache = new Map();

// Söker fram låten och laddar ljudet, så att det kan starta direkt.
// Returnerar { ljud, bild, titel, artist } eller null om inget hittades.
export function forbered(lat) {
  const nyckel = lat.sok;
  if (!cache.has(nyckel)) {
    const lofte = (async () => {
      const { data, error } = await supabase.functions.invoke("media", { body: { sok: lat.sok } });
      if (error || !Array.isArray(data)) throw new Error("Musiksökningen svarade inte");
      return basta(data, lat);
    })();
    cache.set(nyckel, lofte);
    lofte.catch(() => cache.delete(nyckel));
  }
  return cache.get(nyckel).then((traff) => {
    if (traff && ljud.src !== traff.ljud) {
      ljud.src = traff.ljud;
      ljud.load();
    }
    return traff;
  });
}

let tona = null;

export async function spela() {
  clearInterval(tona);
  if (!ljud.src || ljud.src === TYST) return false;
  ljud.volume = 1;
  ljud.currentTime = 0;
  try {
    await ljud.play();
    return true;
  } catch {
    return false;
  }
}

export function pausa() {
  ljud.pause();
}

export function fortsatt() {
  return ljud.play().then(() => true).catch(() => false);
}

export function spelar() {
  return !ljud.paused;
}

// Tonar ut ljudet under en dryg sekund
export function stoppa(mjukt = true) {
  clearInterval(tona);
  if (!mjukt || ljud.paused) {
    ljud.pause();
    return;
  }
  tona = setInterval(() => {
    ljud.volume = Math.max(0, ljud.volume - 0.08);
    if (ljud.volume <= 0.01) {
      clearInterval(tona);
      ljud.pause();
      ljud.volume = 1;
    }
  }, 100);
}

export function narLjudetAndras(f) {
  for (const h of ["play", "pause", "ended"]) ljud.addEventListener(h, () => f(!ljud.paused));
}
