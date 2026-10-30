// Vem sjunger? Storskärmen spelar en låt och alla väljer rätt artist bland fyra.

import { ljud, nedrakning, SVARSFARGER } from "../gemensamt.js";
import { alternativHtml, vilkaValde } from "./fraga.js";
import { skiva, latInfo } from "./gissaar.js";

export default {
  typ: "vemsjunger",

  spela(el, { utmaning: u, slut, klar }) {
    el.innerHTML = `
      <div class="tidstapel"><i></i></div>
      <div class="mobilfraga">
        <p class="lyssna"><span aria-hidden="true">🎵</span> Lyssna på TV:n. Vem sjunger?</p>
        <div class="svarsknappar antal-4">${alternativHtml(u.alternativ, "button")}</div>
      </div>`;
    const stopp = nedrakning({ slut, stapel: el.querySelector(".tidstapel i") });
    el.querySelector(".svarsknappar").addEventListener("click", (e) => {
      const knapp = e.target.closest("button.svar");
      if (!knapp) return;
      ljud.klick();
      const i = Number(knapp.dataset.i);
      klar({ val: i }, { visa: `${SVARSFARGER[i].symbol} ${u.alternativ[i]}` });
    });
    return stopp;
  },

  storskarm(el, { utmaning: u }) {
    el.innerHTML = `
      <div class="tv-musik med-alternativ">
        ${skiva()}
        <h1 class="tv-fragetext">Vem sjunger?</h1>
        <p class="musikstatus" hidden></p>
        <ol class="tv-alternativ antal-4">${alternativHtml(u.alternativ, "li")}</ol>
      </div>`;
    return {};
  },

  facit(el, u, res, { lat } = {}) {
    const ratt = u.facit?.ratt;
    el.innerHTML = `
      <div class="tv-musikfacit">
        ${latInfo(lat, u.facit)}
        <ol class="tv-alternativ antal-4">${alternativHtml(u.alternativ, "li", (i) =>
          `<span class="vilka">${vilkaValde(res, i)}</span>`)}
        </ol>
      </div>`;
    el.querySelectorAll(".tv-alternativ li").forEach((li, i) => li.classList.add(i === ratt ? "ratt" : "fel"));
  },

  mittResultat(jag, u) {
    const f = u.facit ?? {};
    const lat = `${f.titel} (${f.ar})`;
    if (!jag.svarade) return { rubrik: "Hann inte svara", text: `Det var ${f.artist}: ${lat}`, bra: false };
    if (jag.ratt) return { rubrik: "Rätt!", text: `${f.artist}: ${lat}`, bra: true };
    return { rubrik: "Fel den här gången", text: `Det var ${f.artist}: ${lat}`, bra: false };
  },
};
