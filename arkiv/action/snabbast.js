// Vem trycker först? Skärmen är röd, blinkar ibland gult för att lura,
// och blir sedan grön. Mobilen mäter själv tiden från grönt till tryck,
// så det spelar ingen roll om någon har långsammare nät.

import { esc, ljud, vibrera, sekunder } from "../gemensamt.js";

export default {
  typ: "snabbast",

  spela(el, { utmaning: u, grupp, klar }) {
    // De minsta slipper de gula fällorna
    const fallor = grupp === "liten" ? [] : u.falska ?? [];
    el.innerHTML = `
      <button type="button" class="snabbknapp" data-lage="vanta">
        <span class="snabbikon" aria-hidden="true">✋</span>
        <span class="snabbtext">Vänta …</span>
      </button>`;

    const knapp = el.querySelector("button");
    const ikon = el.querySelector(".snabbikon");
    const text = el.querySelector(".snabbtext");
    const timers = [];
    let gront = null;
    let klart = false;

    const satt = (lage, i, t) => {
      knapp.dataset.lage = lage;
      ikon.textContent = i;
      text.textContent = t;
    };

    const slutfor = (svar, visa) => {
      if (klart) return;
      klart = true;
      timers.forEach(clearTimeout);
      setTimeout(() => klar(svar, { visa }), 900);
    };

    for (const ms of fallor) {
      timers.push(setTimeout(() => {
        if (gront !== null || klart) return;
        satt("falla", "🟡", "Inte än!");
        timers.push(setTimeout(() => gront === null && !klart && satt("vanta", "✋", "Vänta …"), 450));
      }, ms));
    }

    timers.push(setTimeout(() => {
      if (klart) return;
      satt("tryck", "👆", "Tryck nu!");
      requestAnimationFrame(() => { gront = performance.now(); });
      timers.push(setTimeout(() => {
        satt("sent", "🐢", "För sent!");
        slutfor({ ms: null }, "För sent");
      }, 3000));
    }, u.vanta_ms));

    knapp.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (klart) return;
      if (gront === null) {
        ljud.fel();
        vibrera([80, 40, 80]);
        satt("tjuvstart", "😅", "Tjuvstart!");
        slutfor({ tjuvstart: true }, "Tjuvstart!");
      } else {
        const ms = Math.round(performance.now() - gront);
        ljud.pling();
        satt("klar", "⚡", `${sekunder(ms)} s`);
        slutfor({ ms }, `${sekunder(ms)} sekunder`);
      }
    });

    return () => {
      klart = true;
      timers.forEach(clearTimeout);
    };
  },

  upplasning() {
    return "Vem trycker först? Vänta tills din skärm blir grön.";
  },

  storskarm(el) {
    el.innerHTML = `
      <div class="tv-snabbast">
        <div class="trafikljus" aria-hidden="true"><i></i><i></i><i></i></div>
        <p class="tv-uppmaning">Vänta på grönt på din skärm …</p>
      </div>`;
    return {};
  },

  facit(el, u, res) {
    const giltiga = res.runda.filter((r) => r.ratt).sort((a, b) => b.poang - a.poang || a.tid_ms - b.tid_ms);
    const ovriga = res.runda.filter((r) => !r.ratt);
    el.innerHTML = `
      <div class="tv-lopp">
        <ol class="snabblista">
          ${giltiga.map((r, i) => `
            <li class="${i === 0 ? "forst" : ""}">
              <span class="plats">${i === 0 ? "⚡" : i + 1}</span>
              <span class="avatar">${esc(r.avatar)}</span>
              <span class="namn">${esc(r.namn)}</span>
              <span class="tid">${sekunder(r.tid_ms)} s</span>
            </li>`).join("")}
        </ol>
        ${ovriga.length ? `<p class="tjuvstartare">${ovriga.map((r) =>
          `<span>${esc(r.avatar)} ${esc(r.namn)}: ${r.svar?.tjuvstart ? "tjuvstart" : "inget tryck"}</span>`).join("")}</p>` : ""}
      </div>`;
  },

  mittResultat(jag, u, res) {
    if (!jag.svarade) return { rubrik: "Hann inte trycka", text: "", bra: false };
    if (jag.svar?.tjuvstart) return { rubrik: "Tjuvstart!", text: "Vänta på grönt nästa gång", bra: false };
    if (!jag.ratt) return { rubrik: "För sent", text: "", bra: false };
    const plats = res.runda.filter((r) => r.ratt).sort((a, b) => b.poang - a.poang || a.tid_ms - b.tid_ms)
      .findIndex((r) => r.spelare_id === jag.spelare_id) + 1;
    return {
      rubrik: plats === 1 ? "Snabbast av alla!" : `Plats ${plats}`,
      text: `${sekunder(jag.tid_ms)} sekunder`,
      bra: true,
    };
  },
};
