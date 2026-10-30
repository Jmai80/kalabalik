// Närmast vinner: alla gissar ett tal. Den som kommer närmast får 1000 poäng,
// tvåan 800, trean 650 och så vidare. Exakt rätt ger alltid 1000.

import { esc, nedrakning, knappsats, talText } from "../gemensamt.js";

const arFraga = (u) => u.enhet === "år";
const visa = (u, n) => (arFraga(u) ? String(n) : talText(n));

export default {
  typ: "narmast",

  spela(el, { utmaning: u, slut, klar }) {
    el.innerHTML = `
      <div class="tidstapel"><i></i></div>
      <div class="mattekort">
        <p class="mobilfraga-text"><span class="mobilfraga-emoji">${esc(u.emoji ?? "🎯")}</span>${esc(u.fraga)}</p>
      </div>`;
    const stopp = [
      knappsats(el.querySelector(".mattekort"), {
        maxLangd: arFraga(u) ? 4 : 9,
        enhet: arFraga(u) ? "" : u.enhet ?? "",
        tusental: !arFraga(u),
        svara: (tal) => klar({ tal }, { visa: `${visa(u, tal)} ${arFraga(u) ? "" : u.enhet ?? ""}`.trim() }),
      }),
      nedrakning({ slut, stapel: el.querySelector(".tidstapel i") }),
    ];
    return () => stopp.forEach((f) => f());
  },

  storskarm(el, { utmaning: u }) {
    el.innerHTML = `
      <div class="tv-fraga">
        <div class="tv-emoji" aria-hidden="true">${esc(u.emoji ?? "🎯")}</div>
        <h1 class="tv-fragetext">${esc(u.fraga)}</h1>
        <p class="tv-uppmaning">Skriv din gissning på mobilen. Närmast vinner!</p>
      </div>`;
    return {};
  },

  facit(el, u, res) {
    const svar = Number(u.facit?.svar);
    const gissat = res.runda.filter((r) => r.svarade).sort((a, b) => a.avstand - b.avstand);
    const inte = res.runda.filter((r) => !r.svarade);
    el.innerHTML = `
      <div class="tv-narmast">
        <p class="tv-fragetext liten">${esc(u.fraga)}</p>
        <p class="narmast-svar">${esc(visa(u, svar))} <span>${arFraga(u) ? "" : esc(u.enhet ?? "")}</span></p>
        <ol class="snabblista">
          ${gissat.map((r, i) => `
            <li class="${i === 0 ? "forst" : ""}">
              <span class="plats">${i === 0 ? "🎯" : i + 1}</span>
              <span class="avatar">${esc(r.avatar)}</span>
              <span class="namn">${esc(r.namn)}</span>
              <span class="tid">${esc(visa(u, r.svar.tal))}${Number(r.avstand) ? ` <small>(${Number(r.svar.tal) > svar ? "+" : "−"}${esc(visa(u, r.avstand))})</small>` : " <small>exakt!</small>"}</span>
            </li>`).join("")}
        </ol>
        ${inte.length ? `<p class="tjuvstartare">${inte.map((r) => `<span>${esc(r.avatar)} ${esc(r.namn)}: inget svar</span>`).join("")}</p>` : ""}
      </div>`;
  },

  mittResultat(jag, u, res) {
    const svar = `${visa(u, u.facit?.svar)}${arFraga(u) ? "" : ` ${u.enhet ?? ""}`}`.trim();
    if (!jag.svarade) return { rubrik: "Hann inte gissa", text: `Rätt svar: ${svar}`, bra: false };
    if (Number(jag.avstand) === 0) return { rubrik: "Exakt rätt!", text: svar, bra: true };
    const plats = res.runda.filter((r) => r.svarade).sort((a, b) => a.avstand - b.avstand)
      .findIndex((r) => r.spelare_id === jag.spelare_id) + 1;
    return {
      rubrik: jag.ratt ? "Närmast av alla!" : `Plats ${plats}`,
      text: `Rätt svar: ${svar}. Du gissade ${visa(u, jag.svar?.tal)}.`,
      bra: jag.ratt,
    };
  },
};
