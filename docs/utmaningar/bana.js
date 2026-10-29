// Action-banan: tre filer, hinder och stjärnor som rusar mot spelaren.
// Tryck till vänster eller höger på skärmen (eller använd piltangenterna)
// för att byta fil. Ta stjärnor, undvik hinder. En krock kostar en stjärna
// och gör att man snurrar en kort stund.
//
// Alla mobiler med samma åldersgrupp får exakt samma bana (samma frö).
// Banan går långsammare för de yngre, så att de hinner se vad som kommer.
//
// Lätt att bygga ut: lägg till ett tema i TEMAN, eller ändra FART.

import { esc, ljud, vibrera, slumpgenerator, nedrakning } from "../gemensamt.js";

export const TEMAN = {
  rymd: {
    namn: "Rymden",
    himmel: ["#140c34", "#3a1a6b"],
    hinder: ["🪨", "☄️", "🛸"],
    sidor: ["🪐", "🌑", "✨", "🌟"],
    linje: "rgba(255,255,255,0.12)",
  },
  skog: {
    namn: "Skogen",
    himmel: ["#123d26", "#2c7a45"],
    hinder: ["🪵", "🪨", "🦔"],
    sidor: ["🌲", "🌳", "🍄", "🌲"],
    linje: "rgba(255,255,255,0.14)",
  },
  hav: {
    namn: "Havet",
    himmel: ["#08304f", "#1474a8"],
    hinder: ["🪼", "🦀", "🪨"],
    sidor: ["🐠", "🫧", "🐚", "🐟"],
    linje: "rgba(255,255,255,0.14)",
  },
};

// Hur fort banan rör sig, i skärmhöjder per sekund
const FART = { liten: 0.4, mellan: 0.55, stor: 0.7 };
const RADAVSTAND = 0.42; // sekunder mellan varje rad på banan
const TVA_HINDER = { liten: 0.1, mellan: 0.3, stor: 0.4 }; // chans att två filer är blockerade

export function byggBana(fro, tid, antalStjarnor, grupp, temanamn) {
  const s = slumpgenerator(fro);
  const tema = TEMAN[temanamn] ?? TEMAN.rymd;
  const rader = [];
  for (let t = 1.4; t < tid - 0.6; t += RADAVSTAND) rader.push({ t, saker: [] });

  // Vilka rader som får en stjärna
  const ordning = rader.map((_, i) => i);
  for (let i = ordning.length - 1; i > 0; i--) {
    const j = Math.floor(s() * (i + 1));
    [ordning[i], ordning[j]] = [ordning[j], ordning[i]];
  }
  const stjarnrader = new Set(ordning.slice(0, antalStjarnor));

  rader.forEach((rad, i) => {
    const hinder = (bana) => ({ bana, typ: "hinder", bild: s.valj(tema.hinder) });
    if (stjarnrader.has(i)) {
      const bana = s.heltal(0, 2);
      rad.saker.push({ bana, typ: "stjarna" });
      if (grupp !== "liten" && s() < 0.45) rad.saker.push(hinder((bana + s.heltal(1, 2)) % 3));
    } else if (s() < 0.72) {
      const forsta = s.heltal(0, 2);
      rad.saker.push(hinder(forsta));
      if (s() < TVA_HINDER[grupp]) rad.saker.push(hinder((forsta + s.heltal(1, 2)) % 3));
    }
  });
  return rader;
}

// Emojis ritas en gång till en egen liten canvas och återanvänds, det går
// mycket snabbare än att rita text i varje bildruta.
const sprites = new Map();
function sprite(emoji, storlek) {
  const nyckel = `${emoji}|${storlek}`;
  if (!sprites.has(nyckel)) {
    const c = document.createElement("canvas");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.height = Math.ceil(storlek * 1.3 * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `${storlek}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.fillText(emoji, storlek * 0.65, storlek * 0.7);
    sprites.set(nyckel, { c, s: storlek * 1.3 });
  }
  return sprites.get(nyckel);
}
function ritaEmoji(ctx, emoji, x, y, storlek, alfa = 1) {
  const { c, s } = sprite(emoji, Math.round(storlek));
  ctx.globalAlpha = alfa;
  ctx.drawImage(c, x - s / 2, y - s / 2, s, s);
  ctx.globalAlpha = 1;
}

export default {
  typ: "bana",

  spela(el, { utmaning: u, grupp, avatar = "🙂", klar, live }) {
    const tema = TEMAN[u.tema] ?? TEMAN.rymd;
    const rader = byggBana(u.fro, u.tid, u.antal, grupp, u.tema);
    el.innerHTML = `
      <div class="bana">
        <canvas aria-label="Action-banan"></canvas>
        <div class="tidstapel"><i></i></div>
        <div class="bana-hud"><span><span aria-hidden="true">⭐</span> <b>0</b></span></div>
        <div class="bana-tips" aria-hidden="true"><span>◀ Tryck här</span><span>Tryck här ▶</span></div>
        <div class="kor" aria-hidden="true">Kör!</div>
      </div>`;

    const rot = el.querySelector(".bana");
    const canvas = el.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const stjarnEl = el.querySelector(".bana-hud b");

    let B = 0, H = 0;
    const storlek = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      B = r.width; H = r.height;
      canvas.width = Math.round(B * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    storlek();
    const ro = new ResizeObserver(storlek);
    ro.observe(canvas);

    // Dekorationer längs kanterna och små stjärnor/bubblor i bakgrunden
    const ds = slumpgenerator(u.fro + 7);
    const dekor = Array.from({ length: 10 }, (_, i) => ({
      x: i % 2 ? 0.955 : 0.045, y: ds(), bild: ds.valj(tema.sidor), s: 0.55 + ds() * 0.35,
    }));
    const prickar = Array.from({ length: 40 }, () => ({ x: ds(), y: ds(), r: 0.5 + ds() * 1.6, v: 0.3 + ds() * 0.7 }));

    let bana = 1;
    let x = null;
    let stjarnor = 0;
    let krockar = 0;
    let skyddadTill = 0;
    let bedovadTill = 0;
    let skakTill = 0;
    let slut = false;
    const effekter = []; // små stjärnor som sprätter, "+1" och "−1"
    const start = performance.now();

    const filX = (i) => B * (0.22 + 0.28 * i);

    const styr = (riktning) => {
      if (slut || performance.now() < bedovadTill) return;
      const ny = Math.max(0, Math.min(2, bana + riktning));
      if (ny !== bana) {
        bana = ny;
        ljud.ton(520 + bana * 90, 0.05, { typ: "triangle", volym: 0.06 });
      }
      rot.classList.add("styrd");
    };

    const tryck = (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      styr(e.clientX - r.left < r.width / 2 ? -1 : 1);
    };
    const tangent = (e) => {
      if (e.key === "ArrowLeft" || e.key === "a") styr(-1);
      if (e.key === "ArrowRight" || e.key === "d") styr(1);
    };
    rot.addEventListener("pointerdown", tryck);
    document.addEventListener("keydown", tangent);

    const krock = (nu) => {
      krockar++;
      const tappade = stjarnor > 0;
      if (tappade) stjarnor--;
      stjarnEl.textContent = stjarnor;
      live(stjarnor);
      skyddadTill = nu + 1300;
      bedovadTill = nu + 550;
      skakTill = nu + 350;
      ljud.aj();
      vibrera(140);
      effekter.push({ typ: "text", text: tappade ? "−1 ⭐" : "Krock!", x: x, y: H * 0.7, t: nu, farg: "#FF5B4F" });
    };

    const tar = (nu) => {
      stjarnor++;
      stjarnEl.textContent = stjarnor;
      live(stjarnor);
      ljud.pling();
      for (let i = 0; i < 8; i++) {
        const v = (Math.PI * 2 * i) / 8;
        effekter.push({ typ: "gnista", x, y: H * 0.78, vx: Math.cos(v) * 160, vy: Math.sin(v) * 160, t: nu });
      }
      effekter.push({ typ: "text", text: "+1", x, y: H * 0.7, t: nu, farg: "#FFC83D" });
    };

    let ruta;
    const loop = (nu) => {
      if (slut) return;
      const t = (nu - start) / 1000;
      const fart = FART[grupp] * H;
      const spelarY = H * 0.78;
      const obj = Math.min(B * 0.2, H * 0.1);
      const malX = filX(bana);
      x = x === null ? malX : x + (malX - x) * Math.min(1, 0.35);

      // Krockar och stjärnor avgörs när en rad når spelaren
      for (const rad of rader) {
        if (rad.klar || t < rad.t) continue;
        rad.klar = true;
        for (const sak of rad.saker) {
          if (sak.bana !== bana) continue;
          if (sak.typ === "stjarna") { sak.tagen = true; tar(nu); }
          else if (nu > skyddadTill) { sak.tagen = true; krock(nu); }
        }
      }

      // Bakgrund
      ctx.save();
      if (nu < skakTill) ctx.translate((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 8);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, tema.himmel[0]);
      grad.addColorStop(1, tema.himmel[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(-10, -10, B + 20, H + 20);

      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (const p of prickar) {
        const y = ((p.y * H + t * fart * p.v) % H);
        ctx.beginPath();
        ctx.arc(p.x * B, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Filernas streckade linjer rör sig med farten
      ctx.strokeStyle = tema.linje;
      ctx.lineWidth = 4;
      ctx.setLineDash([26, 22]);
      ctx.lineDashOffset = -(t * fart) % 48;
      for (const lx of [0.36, 0.64]) {
        ctx.beginPath();
        ctx.moveTo(B * lx, 0);
        ctx.lineTo(B * lx, H);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      for (const d of dekor) {
        const y = ((d.y * (H + 120) + t * fart * 0.8) % (H + 120)) - 60;
        ritaEmoji(ctx, d.bild, d.x * B, y, obj * 0.8 * d.s, 0.4);
      }

      // Hinder och stjärnor
      for (const rad of rader) {
        const y = spelarY - (rad.t - t) * fart;
        if (y < -obj || y > H + obj) continue;
        for (const sak of rad.saker) {
          if (sak.tagen) continue;
          const sx = filX(sak.bana);
          if (sak.typ === "stjarna") {
            const puls = 1 + Math.sin(t * 8 + rad.t) * 0.08;
            ritaEmoji(ctx, "⭐", sx, y, obj * 0.9 * puls);
          } else {
            ritaEmoji(ctx, sak.bild, sx, y, obj);
          }
        }
      }

      // Spelaren: den egna figuren i en bubbla
      const blink = nu < skyddadTill && Math.floor(nu / 90) % 2 === 0;
      if (!blink) {
        const snurr = nu < bedovadTill ? (bedovadTill - nu) / 550 : 0;
        ctx.save();
        ctx.translate(x, spelarY);
        ctx.rotate(snurr * Math.PI * 2);
        ctx.fillStyle = "#FFFDF6";
        ctx.strokeStyle = "#17112F";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, obj * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ritaEmoji(ctx, avatar, 0, 2, obj * 0.82);
        ctx.restore();
        // Fartstrimmor bakom spelaren
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 3;
        for (const dx of [-0.3, 0, 0.3]) {
          const l = 18 + Math.random() * 16;
          ctx.beginPath();
          ctx.moveTo(x + dx * obj, spelarY + obj * 0.7);
          ctx.lineTo(x + dx * obj, spelarY + obj * 0.7 + l);
          ctx.stroke();
        }
      }

      // Effekter
      for (let i = effekter.length - 1; i >= 0; i--) {
        const e = effekter[i];
        const ald = (nu - e.t) / 1000;
        if (ald > 0.7) { effekter.splice(i, 1); continue; }
        if (e.typ === "gnista") {
          ritaEmoji(ctx, "✨", e.x + e.vx * ald, e.y + e.vy * ald, obj * 0.35, 1 - ald / 0.7);
        } else {
          ctx.globalAlpha = 1 - ald / 0.7;
          ctx.font = `700 ${Math.round(obj * 0.5)}px Fredoka, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = e.farg;
          ctx.strokeStyle = "#17112F";
          ctx.lineWidth = 5;
          ctx.strokeText(e.text, e.x, e.y - ald * 60);
          ctx.fillText(e.text, e.x, e.y - ald * 60);
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();

      ruta = requestAnimationFrame(loop);
    };
    ruta = requestAnimationFrame(loop);

    const stopp = nedrakning({
      slut: Date.now() + u.tid * 1000,
      stapel: el.querySelector(".tidstapel i"),
      vidNoll: () => {
        slut = true;
        cancelAnimationFrame(ruta);
        klar({ stjarnor, krockar }, { visa: `${stjarnor} ⭐${krockar ? `  ·  ${krockar} krock${krockar > 1 ? "ar" : ""}` : ""}` });
      },
    });

    return () => {
      slut = true;
      stopp();
      cancelAnimationFrame(ruta);
      ro.disconnect();
      document.removeEventListener("keydown", tangent);
    };
  },

  upplasning(u) {
    return `Action-banan! ${TEMAN[u.tema]?.namn ?? ""}. Ta stjärnorna och undvik hindren.`;
  },

  // Storskärmen: en racerbana där varje spelare åker framåt med sina stjärnor
  storskarm(el, { utmaning: u, spelare }) {
    const tema = TEMAN[u.tema] ?? TEMAN.rymd;
    el.innerHTML = `
      <div class="tv-race tema-${esc(u.tema)}">
        <p class="tv-race-tema">${esc(tema.namn)} <span aria-hidden="true">${tema.hinder.join(" ")}</span></p>
        <div class="race-banor">
          ${spelare.map((s) => `
            <div class="race-bana" data-id="${s.id}">
              <span class="race-namn">${esc(s.namn)}</span>
              <span class="race-spar"><span class="race-figur">${esc(s.avatar)}</span></span>
              <span class="race-antal">0 ⭐</span>
            </div>`).join("")}
        </div>
      </div>`;
    return {
      live(varden) {
        const max = Math.max(0, ...spelare.map((s) => varden.get(s.id) ?? 0));
        el.querySelectorAll(".race-bana").forEach((rad) => {
          const v = varden.get(rad.dataset.id) ?? 0;
          rad.querySelector(".race-figur").style.left = `${(v / u.antal) * 100}%`;
          rad.querySelector(".race-antal").textContent = `${v} ⭐`;
          rad.classList.toggle("leder", v > 0 && v === max);
        });
      },
    };
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
              <span class="tid">${r.svarade ? `${r.svar?.stjarnor ?? 0} ⭐` : "–"}</span>
            </li>`).join("")}
        </ol>
      </div>`;
  },

  mittResultat(jag, u) {
    if (!jag.svarade) return { rubrik: "Hann inte vara med", text: "", bra: false };
    const s = jag.svar?.stjarnor ?? 0;
    const k = jag.svar?.krockar ?? 0;
    return {
      rubrik: s >= u.antal * 0.8 ? "Vilken åkning!" : s > 0 ? "Bra kört!" : "Nästa gång!",
      text: `${s} av ${u.antal} stjärnor${k ? `, ${k} krock${k > 1 ? "ar" : ""}` : ""}`,
      bra: s > 0,
    };
  },
};
