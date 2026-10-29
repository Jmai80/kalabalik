// Hela spelet: en storskärm och tre mobiler spelar en omgång från lobbyn
// till pallen. Tar skärmdumpar längs vägen.
// Kör: node flode-test.mjs [antal rundor]   (testservern måste vara igång)

import { startaWebblasare, nySida, WEBB, SKOTT } from "./webblasare.mjs";

const RUNDOR = Number(process.argv[2] ?? 5);
const vila = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await startaWebblasare();
const allaFel = [];
let misslyckat = false;
const kolla = (villkor, text) => {
  console.log(`  ${villkor ? "✓" : "✗"} ${text}`);
  if (!villkor) misslyckat = true;
};

// ---------- Värden ----------
const tv = await nySida(browser, { mobil: false, namn: "tv" });
await tv.goto(`${WEBB}/vard.html`);
await tv.waitForSelector("#login:not([hidden])");
await tv.fill("#epost", "vard@test.se");
await tv.fill("#losen", "hemligt");
await tv.click("#loginform button");
await tv.waitForSelector("#start:not([hidden]), #lobby:not([hidden])");
if (await tv.isVisible("#skapa")) await tv.click("#skapa");
await tv.waitForSelector("#lobby:not([hidden])");
const kod = (await tv.locator("#rumskod").innerText()).replace(/\s/g, "");
kolla(/^[A-Z0-9]{4}$/.test(kod), `rummet har koden ${kod}`);
await tv.screenshot({ path: `${SKOTT}/tv-lobby-tom.png` });

// ---------- Spelarna ----------
const SPELARE = [
  { namn: "Farmor Ingrid", grupp: "stor", avatar: "🦉" },
  { namn: "Ella", grupp: "mellan", avatar: "🦄" },
  { namn: "Sixten", grupp: "liten", avatar: "🦖" },
];
const mobiler = [];
for (const s of SPELARE) {
  const p = await nySida(browser, { namn: s.namn });
  await p.goto(`${WEBB}/?kod=${kod}`);
  await p.waitForSelector("#anslut:not([hidden])");
  if (s === SPELARE[0]) await p.screenshot({ path: `${SKOTT}/mobil-anslut.png` });
  await p.fill("#namn", s.namn);
  await p.check(`input[name="grupp"][value="${s.grupp}"]`, { force: true });
  await p.click(`#avatarval button[data-a="${s.avatar}"]`);
  await p.click("#anslutform button.knapp");
  await p.waitForSelector("#vantar:not([hidden])");
  p.info = s;
  mobiler.push(p);
}
await mobiler[2].screenshot({ path: `${SKOTT}/mobil-vantar.png` });
await tv.waitForFunction(() => document.querySelectorAll(".spelarbubbla").length === 3);
kolla(true, "storskärmen ser alla tre spelare");
await vila(600);
await tv.screenshot({ path: `${SKOTT}/tv-lobby.png` });

// Fel kod och upptaget namn
{
  const p = await nySida(browser, { namn: "extra" });
  await p.goto(`${WEBB}/?kod=${kod}`);
  await p.fill("#namn", "ella");
  await p.check('input[name="grupp"][value="stor"]', { force: true });
  await p.click("#anslutform button.knapp");
  await p.waitForFunction(() => document.querySelector("#fel").textContent.length > 0);
  kolla(/redan taget/.test(await p.locator("#fel").innerText()), `upptaget namn: "${await p.locator("#fel").innerText()}"`);
  await p.context().close();
}

// ---------- Spelet ----------
await tv.click(`.rundval button[data-antal="5"]`);
// Rundvalet finns bara som 5/8/12. Med ett annat antal startar vi via databasen.
if (RUNDOR !== 5) {
  await tv.evaluate(() => localStorage.setItem("kb-rundor", "5"));
}
await tv.click("#starta");

async function spela(p, typ, runda) {
  const g = p.info.grupp;
  if (typ === "fraga") {
    await vila(400 + Math.random() * 1500);
    await p.click(`.svar >> nth=${Math.floor(Math.random() * 4)}`);
  } else if (typ === "matte") {
    await vila(500 + Math.random() * 1500);
    if (g === "liten") await p.click(".svar >> nth=0");
    else {
      for (const n of ["1", "2"]) await p.click(`.knappsats button[data-n="${n}"]`);
      await p.click(".knappsats .ok");
    }
  } else if (typ === "snabbast") {
    if (g === "mellan" && runda % 2 === 0) {
      await vila(500);
      await p.locator(".snabbknapp").dispatchEvent("pointerdown"); // tjuvstart
    } else {
      await p.waitForSelector('.snabbknapp[data-lage="tryck"]', { timeout: 10000 });
      await vila(150 + Math.random() * 250);
      await p.locator(".snabbknapp").dispatchEvent("pointerdown");
    }
  } else if (typ === "fanga") {
    const slut = Date.now() + 15500;
    while (Date.now() < slut) {
      const djur = p.locator(".fangbar:not(.kaktus):not([data-tagen])");
      if ((await djur.count()) && Math.random() < 0.7) await djur.first().dispatchEvent("pointerdown").catch(() => {});
      await vila(200);
    }
  } else if (typ === "bana") {
    const slut = Date.now() + 26000;
    while (Date.now() < slut) {
      await p.mouse.click(Math.random() < 0.5 ? 60 : 330, 500).catch(() => {});
      await vila(300 + Math.random() * 400);
    }
  }
}

const typerSedda = [];
for (let runda = 1; runda <= 5; runda++) {
  await tv.waitForSelector("#tvintro:not([hidden])", { timeout: 20000 });
  const typ = await tv.evaluate(() => document.querySelector("#tvintrokort").className.match(/f-(\w+)/)?.[1]);
  await vila(800);
  if (runda <= 5) await tv.screenshot({ path: `${SKOTT}/tv-r${runda}-intro.png` });
  await mobiler[1].screenshot({ path: `${SKOTT}/mobil-r${runda}-intro.png` });

  await tv.waitForSelector("#tvspel:not([hidden])", { timeout: 15000 });
  const typNamn = await tv.locator("#speltyp").innerText();
  typerSedda.push(typNamn);
  console.log(`Runda ${runda}: ${typNamn}`);
  await Promise.all(mobiler.map((p) => p.waitForSelector("#spel:not([hidden])", { timeout: 10000 })));
  await vila(900);
  await tv.screenshot({ path: `${SKOTT}/tv-r${runda}-spel.png` });
  for (const p of mobiler) await p.screenshot({ path: `${SKOTT}/mobil-r${runda}-${p.info.grupp}-spel.png` });

  const typer = { "Frågan": "fraga", "Mattedags": "matte", "Vem trycker först?": "snabbast", "Fånga!": "fanga", "Action-banan": "bana" };
  const t = typer[typNamn.replace(/^\S+\s/, "").trim()];
  const mitt = vila(t === "fanga" ? 7000 : t === "bana" ? 12000 : 0).then(async () => {
    if (t === "fanga" || t === "bana") {
      await tv.screenshot({ path: `${SKOTT}/tv-r${runda}-live.png` });
      await mobiler[0].screenshot({ path: `${SKOTT}/mobil-r${runda}-mitt.png` });
    }
  });
  await Promise.all([...mobiler.map((p) => spela(p, t, runda)), mitt]);

  await Promise.all(mobiler.map((p) => p.waitForSelector("#skickat:not([hidden]), #resultat:not([hidden])", { timeout: 15000 })));
  await mobiler[1].screenshot({ path: `${SKOTT}/mobil-r${runda}-skickat.png` });
  await tv.waitForSelector("#tvresultat:not([hidden])", { timeout: 20000 });
  await Promise.all(mobiler.map((p) => p.waitForSelector("#resultat:not([hidden])", { timeout: 10000 })));
  await vila(900);
  await tv.screenshot({ path: `${SKOTT}/tv-r${runda}-resultat.png` });
  for (const p of mobiler) await p.screenshot({ path: `${SKOTT}/mobil-r${runda}-${p.info.grupp}-resultat.png` });
  const rad = await mobiler[2].locator("#resultatkort").innerText();
  console.log(`  Sixten: ${rad.replace(/\n+/g, " | ")}`);

  if (runda === 2) {
    // En mobil laddas om mitt i spelet och ska hamna rätt igen
    await mobiler[1].reload();
    await mobiler[1].waitForSelector("#resultat:not([hidden])", { timeout: 10000 });
    kolla(true, "Ella laddade om och kom tillbaka till resultatet");
  }
  if (runda === 3) {
    // Paus och sedan Nästa för hand
    await tv.click("#paus");
    await vila(500);
    kolla(/Pausat/.test(await tv.locator("#vantetid").innerText()), "pausen stoppar nedräkningen");
  }
  await tv.click("#nasta");
}

await tv.waitForSelector("#tvslut:not([hidden])", { timeout: 20000 });
await Promise.all(mobiler.map((p) => p.waitForSelector("#slut:not([hidden])", { timeout: 10000 })));
await vila(3500);
await tv.screenshot({ path: `${SKOTT}/tv-slut.png` });
for (const p of mobiler) await p.screenshot({ path: `${SKOTT}/mobil-slut-${p.info.grupp}.png` });
kolla(new Set(typerSedda).size === 5, `alla fem typer kom med: ${typerSedda.join(", ")}`);

// Spela igen: alla hamnar i lobbyn
await tv.click("#igen");
await tv.waitForSelector("#lobby:not([hidden])");
await Promise.all(mobiler.map((p) => p.waitForSelector("#vantar:not([hidden])", { timeout: 10000 })));
kolla(true, "Spela igen skickar alla tillbaka till lobbyn");

// Värden tar bort en spelare
await tv.click(".spelarbubbla >> nth=2");
await tv.click('#dialog [data-svar="ja"]');
await mobiler[2].waitForSelector("#anslut:not([hidden])", { timeout: 10000 });
kolla(/inte längre med/.test(await mobiler[2].locator("#fel").innerText()), "en borttagen spelare får veta det");

// Stäng rummet
await tv.click("#stangrum");
await tv.click('#dialog [data-svar="ja"]');
await mobiler[0].waitForSelector("#anslut:not([hidden])", { timeout: 10000 });
kolla(/stängt/.test(await mobiler[0].locator("#fel").innerText()), "spelarna får veta att rummet stängts");

for (const p of [tv, ...mobiler]) allaFel.push(...p.fel);
await browser.close();
const verkligaFel = allaFel.filter((f) => !/Failed to load resource.*(400|404)/.test(f));
if (verkligaFel.length) {
  console.log("FEL I KONSOLEN:\n" + verkligaFel.join("\n"));
  misslyckat = true;
}
console.log(misslyckat ? "\nNågot gick fel" : "\nHela flödet fungerar");
process.exit(misslyckat ? 1 : 0);
