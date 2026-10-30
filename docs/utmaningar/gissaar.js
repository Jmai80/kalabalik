// Gissa året: storskärmen spelar en låt och alla gissar vilket år den kom.
// Exakt rätt ger 1000 poäng, och poängen sjunker ju fler år man är från.
// De yngre har en större marginal (se kb_arsmarginal i SQL-filen).

import { esc, nedrakning, knappsats } from "../gemensamt.js";

export const ARSGRANS = new Date().getFullYear() + 1;

// En skiva som snurrar. Ritas i CSS, så inga bildfiler behövs.
export function skiva(bild = "") {
  return `
    <div class="skiva" aria-hidden="true">
      <div class="skiva-etikett">${bild ? `<img src="${esc(bild)}" alt="">` : ""}</div>
    </div>`;
}

export function latInfo(lat, facit) {
  const f = facit ?? {};
  return `
    <div class="latinfo">
      ${lat?.bild ? `<img class="omslag" src="${esc(lat.bild.replace("300x300", "600x600"))}" alt="">` : skiva()}
      <div class="lattext">
        <span class="lat-titel">${esc(f.titel ?? lat?.titel ?? "")}</span>
        <span class="lat-artist">${esc(f.artist ?? lat?.artist ?? "")}</span>
        ${f.ar ? `<span class="lat-ar">${esc(f.ar)}</span>` : ""}
      </div>
    </div>`;
}

export default {
  typ: "gissaar",

  spela(el, { slut, klar }) {
    el.innerHTML = `
      <div class="tidstapel"><i></i></div>
      <div class="mattekort">
        <p class="lyssna"><span aria-hidden="true">🎵</span> Lyssna på TV:n</p>
        <p class="mobilfraga-text">Vilket år kom låten?</p>
      </div>`;
    const stopp = [
      knappsats(el.querySelector(".mattekort"), {
        maxLangd: 4,
        tusental: false,
        minVarde: 1900,
        maxVarde: ARSGRANS,
        svara: (ar) => klar({ ar }, { visa: `${ar}` }),
      }),
      nedrakning({ slut, stapel: el.querySelector(".tidstapel i") }),
    ];
    return () => stopp.forEach((f) => f());
  },

  storskarm(el) {
    el.innerHTML = `
      <div class="tv-musik">
        ${skiva()}
        <h1 class="tv-fragetext">Vilket år kom låten?</h1>
        <p class="musikstatus" hidden></p>
      </div>`;
    return {};
  },

  // Facit: låten och en tidslinje där allas gissningar syns
  facit(el, u, res, { lat } = {}) {
    const f = u.facit ?? {};
    const gissningar = res.runda.filter((r) => r.svarade && Number.isFinite(r.svar?.ar));
    const ar = [f.ar, ...gissningar.map((r) => r.svar.ar)];
    const fran = Math.min(...ar) - 3;
    const till = Math.max(...ar) + 3;
    const x = (a) => ((a - fran) / (till - fran)) * 100;

    // Gissningar som hamnar nära varandra staplas på varsin rad
    const radSlut = [];
    const markorer = gissningar
      .sort((a, b) => a.svar.ar - b.svar.ar)
      .map((r) => {
        const pos = x(r.svar.ar);
        let rad = radSlut.findIndex((slut) => pos - slut >= 6);
        if (rad === -1) rad = radSlut.length;
        radSlut[rad] = pos;
        return `<span class="tl-gissning" style="left:${pos}%; --rad:${rad}" title="${esc(r.namn)}: ${r.svar.ar}">
          <span class="avatar">${esc(r.avatar)}</span><span class="tl-ar">${r.svar.ar}</span></span>`;
      });

    const decennier = [];
    for (let d = Math.ceil(fran / 10) * 10; d <= till; d += 10) decennier.push(d);

    el.innerHTML = `
      <div class="tv-musikfacit">
        ${latInfo(lat, f)}
        <div class="tidslinje">
          <div class="tl-axel" style="--rader:${Math.max(1, radSlut.length)}">
            ${decennier.map((d) => `<span class="tl-decennium" style="left:${x(d)}%">${d}</span>`).join("")}
            <span class="tl-ratt" style="left:${x(f.ar)}%"><b>${f.ar}</b></span>
            ${markorer.join("")}
          </div>
        </div>
        ${gissningar.length === 0 ? `<p class="undertext">Ingen hann gissa.</p>` : ""}
      </div>`;
  },

  mittResultat(jag, u) {
    const f = u.facit ?? {};
    const lat = `${f.titel} med ${f.artist} kom ${f.ar}`;
    if (!jag.svarade) return { rubrik: "Hann inte gissa", text: lat, bra: false };
    const fel = Number(jag.avstand);
    if (fel === 0) return { rubrik: "Exakt rätt år!", text: lat, bra: true };
    return {
      rubrik: fel === 1 ? "Bara ett år fel!" : `${fel} år fel`,
      text: `${lat}. Du gissade ${jag.svar?.ar}.`,
      bra: jag.runda_poang > 0,
    };
  },
};
