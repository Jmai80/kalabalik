// Mattedags: varje åldersgrupp får ett eget tal. De minsta räknar frukter
// och väljer bland fyra svar, de större skriver svaret på en knappsats.

import { esc, ljud, nedrakning, knappsats, GRUPPER, SVARSFARGER } from "../gemensamt.js";

const SAKER = ["🍎", "🍓", "🍌", "⭐", "🐟", "🧁"];

function frukter(t) {
  const sak = SAKER[(t.a + t.b) % SAKER.length];
  if (t.op === "+") {
    return `<span class="hog">${sak.repeat(t.a)}</span><span class="op">+</span><span class="hog">${sak.repeat(t.b)}</span>`;
  }
  // Minus: alla frukter syns, de som tas bort är överkryssade
  return `<span class="hog">${sak.repeat(t.a - t.b)}<s>${sak.repeat(t.b)}</s></span>`;
}

export default {
  typ: "matte",

  spela(el, { utmaning: u, grupp, slut, klar }) {
    const t = u.tal[grupp];
    const stopp = [];

    if (grupp === "liten") {
      el.innerHTML = `
        <div class="tidstapel"><i></i></div>
        <div class="mattekort">
          <div class="frukter" aria-hidden="true">${frukter(t)}</div>
          <p class="matte-tal">${esc(t.text)} = ?</p>
          <div class="svarsknappar antal-4">
            ${t.alternativ.map((a, i) => `
              <button type="button" class="svar ${SVARSFARGER[i].klass}" data-v="${a}">
                <span class="svartext stor">${a}</span>
              </button>`).join("")}
          </div>
        </div>`;
      el.querySelector(".svarsknappar").addEventListener("click", (e) => {
        const k = e.target.closest("button");
        if (!k) return;
        ljud.klick();
        klar({ tal: Number(k.dataset.v) }, { visa: `${t.text} = ${k.dataset.v}` });
      });
    } else {
      el.innerHTML = `
        <div class="tidstapel"><i></i></div>
        <div class="mattekort">
          <p class="matte-tal">${esc(t.text)} =</p>
        </div>`;
      stopp.push(knappsats(el.querySelector(".mattekort"), {
        maxLangd: 5,
        tusental: false,
        svara: (tal) => klar({ tal }, { visa: `${t.text} = ${tal}` }),
      }));
    }

    stopp.push(nedrakning({ slut, stapel: el.querySelector(".tidstapel i") }));
    return () => stopp.forEach((f) => f());
  },

  storskarm(el, { utmaning: u }) {
    el.innerHTML = `
      <div class="tv-matte">
        ${["liten", "mellan", "stor"].map((g) => `
          <div class="mattetavla">
            <span class="grupp"><span aria-hidden="true">${GRUPPER[g].ikon}</span> ${GRUPPER[g].namn}</span>
            <span class="tal">${esc(u.tal[g].text)}</span>
          </div>`).join("")}
      </div>`;
    return {};
  },

  facit(el, u, res) {
    el.innerHTML = `
      <div class="tv-matte">
        ${["liten", "mellan", "stor"].map((g) => {
          const ratta = res.runda.filter((r) => r.grupp === g && r.ratt);
          const ovriga = res.runda.filter((r) => r.grupp === g && !r.ratt);
          return `
            <div class="mattetavla facit">
              <span class="grupp"><span aria-hidden="true">${GRUPPER[g].ikon}</span> ${GRUPPER[g].namn}</span>
              <span class="tal">${esc(u.tal[g].text)} = <b>${esc(u.facit?.[g])}</b></span>
              <span class="vilka">
                ${ratta.map((r) => `<span class="ratt" title="${esc(r.namn)}">${esc(r.avatar)}</span>`).join("")}
                ${ovriga.map((r) => `<span class="fel" title="${esc(r.namn)}">${esc(r.avatar)}</span>`).join("")}
              </span>
            </div>`;
        }).join("")}
      </div>`;
  },

  mittResultat(jag, u) {
    const g = jag.grupp;
    const facit = `${u.tal[g].text} = ${u.facit?.[g]}`;
    if (!jag.svarade) return { rubrik: "Hann inte svara", text: facit, bra: false };
    if (jag.ratt) return { rubrik: "Rätt räknat!", text: facit, bra: true };
    return { rubrik: "Nästan!", text: `${facit} (du svarade ${jag.svar?.tal})`, bra: false };
  },
};
