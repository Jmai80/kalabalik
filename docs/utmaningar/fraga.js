// Frågan: en flervalsfråga ur frågebanken. Storskärmen visar och läser upp
// frågan, mobilen visar fyra färgade knappar.

import { esc, ljud, nedrakning, SVARSFARGER } from "../gemensamt.js";

function alternativHtml(alternativ, tagg, extra = () => "") {
  return alternativ
    .map((a, i) => {
      const f = SVARSFARGER[i];
      return `<${tagg} class="svar ${f.klass}" data-i="${i}" ${tagg === "button" ? 'type="button"' : ""}>
        <span class="symbol" aria-hidden="true">${f.symbol}</span>
        <span class="svartext">${esc(a)}</span>${extra(i)}
      </${tagg}>`;
    })
    .join("");
}

export default {
  typ: "fraga",

  spela(el, { utmaning: u, slut, klar }) {
    el.innerHTML = `
      <div class="tidstapel"><i></i></div>
      <div class="mobilfraga">
        <p class="mobilfraga-text"><span class="mobilfraga-emoji">${esc(u.emoji ?? "")}</span>${esc(u.fraga)}</p>
        <div class="svarsknappar antal-${u.alternativ.length}">${alternativHtml(u.alternativ, "button")}</div>
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

  upplasning(u) {
    const alt = u.alternativ.map((a, i) => `${SVARSFARGER[i].namn}: ${a}.`).join(" ");
    return `${u.fraga} ${alt}`;
  },

  storskarm(el, { utmaning: u }) {
    el.innerHTML = `
      <div class="tv-fraga">
        <div class="tv-emoji" aria-hidden="true">${esc(u.emoji ?? "❓")}</div>
        <h1 class="tv-fragetext">${esc(u.fraga)}</h1>
        <ol class="tv-alternativ antal-${u.alternativ.length}">${alternativHtml(u.alternativ, "li")}</ol>
      </div>`;
    return {};
  },

  facit(el, u, res) {
    const ratt = u.facit?.ratt;
    const antal = u.alternativ.map((_, i) => res.runda.filter((r) => r.svar?.val === i));
    el.innerHTML = `
      <div class="tv-fraga facitlage">
        <div class="tv-emoji liten" aria-hidden="true">${esc(u.emoji ?? "❓")}</div>
        <h1 class="tv-fragetext liten">${esc(u.fraga)}</h1>
        <ol class="tv-alternativ antal-${u.alternativ.length}">${alternativHtml(u.alternativ, "li", (i) => `
          <span class="vilka">${antal[i].map((r) => `<span title="${esc(r.namn)}">${esc(r.avatar)}</span>`).join("")}</span>`)}
        </ol>
      </div>`;
    el.querySelectorAll(".tv-alternativ li").forEach((li, i) => li.classList.add(i === ratt ? "ratt" : "fel"));
  },

  mittResultat(jag, u) {
    const rattText = u.alternativ[u.facit?.ratt] ?? "";
    if (!jag.svarade) return { rubrik: "Hann inte svara", text: `Rätt svar: ${rattText}`, bra: false };
    if (jag.ratt) return { rubrik: "Rätt!", text: rattText, bra: true };
    return { rubrik: "Fel den här gången", text: `Rätt svar: ${rattText}`, bra: false };
  },
};
