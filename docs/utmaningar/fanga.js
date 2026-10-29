// Fånga! Djur dyker upp på skärmen och försvinner snart igen. Tryck på
// så många du hinner, men inte på kaktusarna. De yngre har djur som
// stannar kvar längre och färre kaktusar.

import { esc, ljud, vibrera, slumpgenerator, nedrakning } from "../gemensamt.js";

const DJUR = ["🐞", "🦋", "🐸", "🐭", "🐹", "🐥", "🐢", "🐿️", "🦔", "🐌"];
const KAKTUS = "🌵";
const LIVSTID = { liten: 1800, mellan: 1300, stor: 950 };
const KAKTUSAR = { liten: 3, mellan: 6, stor: 7 };
const KOLUMNER = 4;
const RADER = 5;

// Samma frö ger samma schema på alla mobiler
export function schema(fro, antal, tidMs, grupp) {
  const s = slumpgenerator(fro);
  const lista = [];
  const steg = (tidMs - 1400) / antal;
  for (let i = 0; i < antal; i++) {
    lista.push({ vid: 400 + i * steg + (s() - 0.5) * steg * 0.6, sak: s.valj(DJUR), ruta: s.heltal(0, KOLUMNER * RADER - 1), kaktus: false });
  }
  for (let i = 0; i < KAKTUSAR[grupp]; i++) {
    lista.push({ vid: s.heltal(1200, tidMs - 1500), sak: KAKTUS, ruta: s.heltal(0, KOLUMNER * RADER - 1), kaktus: true });
  }
  return lista.sort((a, b) => a.vid - b.vid);
}

export default {
  typ: "fanga",

  spela(el, { utmaning: u, grupp, klar, live }) {
    const tidMs = u.tid * 1000;
    el.innerHTML = `
      <div class="tidstapel"><i></i></div>
      <div class="fanga-huvud">
        <span class="fanga-poang"><span aria-hidden="true">🫙</span> <b>0</b></span>
        <span class="fanga-tips">Rör inte ${KAKTUS}</span>
      </div>
      <div class="fanga-arena"></div>
      <div class="kor" aria-hidden="true">Kör!</div>`;

    const arena = el.querySelector(".fanga-arena");
    const poangEl = el.querySelector(".fanga-poang b");
    const upptagna = new Set();
    const timers = [];
    let traffar = 0;
    let bomber = 0;
    let slut = false;

    const visaPoang = () => {
      poangEl.textContent = traffar;
      live(Math.max(0, traffar - 2 * bomber));
    };

    const placera = (sak) => {
      let ruta = sak.ruta;
      for (let i = 0; i < KOLUMNER * RADER && upptagna.has(ruta); i++) ruta = (ruta + 7) % (KOLUMNER * RADER);
      if (upptagna.has(ruta)) return;
      upptagna.add(ruta);

      const b = document.createElement("button");
      b.type = "button";
      b.className = `fangbar${sak.kaktus ? " kaktus" : ""}`;
      b.textContent = sak.sak;
      b.style.left = `${((ruta % KOLUMNER) + 0.5) * (100 / KOLUMNER)}%`;
      b.style.top = `${(Math.floor(ruta / KOLUMNER) + 0.5) * (100 / RADER)}%`;
      b.setAttribute("aria-label", sak.kaktus ? "Kaktus" : "Djur");
      const livstid = sak.kaktus ? 1700 : LIVSTID[grupp];
      b.style.setProperty("--livstid", `${livstid}ms`);

      const bort = () => {
        upptagna.delete(ruta);
        b.remove();
      };
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (slut || b.dataset.tagen) return;
        b.dataset.tagen = "1";
        if (sak.kaktus) {
          bomber++;
          ljud.aj();
          vibrera(120);
          arena.classList.remove("aj");
          void arena.offsetWidth;
          arena.classList.add("aj");
          b.classList.add("stack");
        } else {
          traffar++;
          ljud.plopp();
          b.classList.add("fangad");
        }
        visaPoang();
        setTimeout(bort, 260);
      });
      arena.append(b);
      timers.push(setTimeout(() => !b.dataset.tagen && bort(), livstid));
    };

    for (const sak of schema(u.fro, u.antal, tidMs, grupp)) {
      timers.push(setTimeout(() => !slut && placera(sak), sak.vid));
    }

    const stopp = nedrakning({
      slut: Date.now() + tidMs,
      stapel: el.querySelector(".tidstapel i"),
      vidNoll: () => {
        slut = true;
        timers.forEach(clearTimeout);
        arena.querySelectorAll(".fangbar").forEach((b) => b.remove());
        const text = bomber ? `${traffar} fångade, ${bomber} ${KAKTUS}` : `${traffar} fångade`;
        klar({ traffar, bomber }, { visa: text });
      },
    });

    return () => {
      slut = true;
      stopp();
      timers.forEach(clearTimeout);
    };
  },

  upplasning() {
    return "Fånga! Tryck på djuren innan de försvinner. Rör inte kaktusarna!";
  },

  // Storskärmen visar allas fångst live
  storskarm(el, { spelare }) {
    el.innerHTML = `<div class="tv-livelista"></div>`;
    const lista = el.querySelector(".tv-livelista");
    const rita = (varden) => {
      const sorterade = [...spelare].sort((a, b) => (varden.get(b.id) ?? 0) - (varden.get(a.id) ?? 0));
      lista.innerHTML = sorterade.map((s) => `
        <div class="livekort">
          <span class="avatar">${esc(s.avatar)}</span>
          <span class="namn">${esc(s.namn)}</span>
          <span class="antal">${varden.get(s.id) ?? 0}</span>
        </div>`).join("");
    };
    rita(new Map());
    return { live: rita };
  },

  facit(el, u, res) {
    el.innerHTML = `
      <div class="tv-lopp">
        <ol class="snabblista">
          ${res.runda.map((r, i) => `
            <li class="${i === 0 && r.poang > 0 ? "forst" : ""}">
              <span class="plats">${i + 1}</span>
              <span class="avatar">${esc(r.avatar)}</span>
              <span class="namn">${esc(r.namn)}</span>
              <span class="tid">${r.svarade ? `${r.svar?.traffar ?? 0} av ${u.antal}${r.svar?.bomber ? ` · ${r.svar.bomber} ${KAKTUS}` : ""}` : "–"}</span>
            </li>`).join("")}
        </ol>
      </div>`;
  },

  mittResultat(jag, u) {
    if (!jag.svarade) return { rubrik: "Hann inte vara med", text: "", bra: false };
    const t = jag.svar?.traffar ?? 0;
    const b = jag.svar?.bomber ?? 0;
    return {
      rubrik: t >= u.antal * 0.75 ? "Supersnabba fingrar!" : "Bra fångat!",
      text: `${t} av ${u.antal} djur${b ? `, ${b} ${KAKTUS} (minus ${b * 2})` : ""}`,
      bra: t > 0,
    };
  },
};
