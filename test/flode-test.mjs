// Hela spelet: en storskärm och tre mobiler spelar en omgång från lobbyn
// till pallen. Tar skärmdumpar längs vägen.
// Kör: node flode-test.mjs [antal rundor]   (testservern måste vara igång)

import { startaWebblasare, nySida, WEBB, SKOTT } from "./webblasare.mjs";

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
const ljudfiler = [];
tv.on("request", (r) => { if (r.url().includes("/ljud.wav")) ljudfiler.push(r.url()); });

await tv.click(`.rundval button[data-antal="8"]`);
await tv.click("#starta");

async function knappa(p, tal) {
  for (const n of String(tal)) await p.click(`.knappsats button[data-n="${n}"]`);
  await p.click(".knappsats .ok");
}

async function spela(p, typ) {
  const g = p.info.grupp;
  await vila(400 + Math.random() * 1200);
  if (typ === "fraga" || typ === "vemsjunger") {
    await p.click(`.svar >> nth=${Math.floor(Math.random() * 4)}`);
  } else if (typ === "matte") {
    if (g === "liten") await p.click(".svar >> nth=0");
    else await knappa(p, 12);
  } else if (typ === "gissaar") {
    if (g === "mellan") {
      // Ett omöjligt årtal ger ett felmeddelande först
      await knappa(p, 1234);
      await p.waitForSelector(".knappsats-fel:not(:empty)");
      for (let i = 0; i < 4; i++) await p.click('.knappsats button[data-n="sudda"]');
    }
    await knappa(p, 1960 + Math.floor(Math.random() * 60));
  } else if (typ === "narmast") {
    await knappa(p, 1 + Math.floor(Math.random() * 2000));
  }
}

const NAMN = { "Kunskap": "fraga", "Gissa året": "gissaar", "Vem sjunger?": "vemsjunger", "Närmast vinner": "narmast", "Mattedags": "matte" };
const typerSedda = [];
for (let runda = 1; runda <= 8; runda++) {
  await tv.waitForSelector("#tvintro:not([hidden])", { timeout: 20000 });
  await vila(800);
  await tv.screenshot({ path: `${SKOTT}/tv-r${runda}-intro.png` });

  await tv.waitForSelector("#tvspel:not([hidden])", { timeout: 15000 });
  const typNamn = (await tv.locator("#speltyp").innerText()).replace(/^\S+\s/, "").trim();
  const t = NAMN[typNamn];
  typerSedda.push(t);
  console.log(`Runda ${runda}: ${typNamn}`);
  await Promise.all(mobiler.map((p) => p.waitForSelector("#spel:not([hidden])", { timeout: 10000 })));
  await vila(1500);
  await tv.screenshot({ path: `${SKOTT}/tv-r${runda}-${t}-spel.png` });
  for (const p of mobiler) await p.screenshot({ path: `${SKOTT}/mobil-r${runda}-${t}-${p.info.grupp}.png` });

  if (t === "gissaar" || t === "vemsjunger") {
    const snurrar = await tv.locator(".skiva.snurrar").count();
    const status = await tv.locator(".musikstatus").innerText().catch(() => "");
    kolla(snurrar === 1 || /gick inte att spela/.test(status), `musiken: ${snurrar ? "spelar" : status.trim()}`);
    const okKnapp = await tv.locator("#musikknapp").isVisible();
    kolla(okKnapp, "pausknappen för musiken syns");
  }

  await Promise.all(mobiler.map((p) => spela(p, t)));
  await Promise.all(mobiler.map((p) => p.waitForSelector("#skickat:not([hidden]), #resultat:not([hidden])", { timeout: 15000 })));
  await tv.waitForSelector("#tvresultat:not([hidden])", { timeout: 40000 });
  await Promise.all(mobiler.map((p) => p.waitForSelector("#resultat:not([hidden])", { timeout: 10000 })));
  await vila(1200);
  await tv.screenshot({ path: `${SKOTT}/tv-r${runda}-${t}-resultat.png` });
  for (const p of mobiler) await p.screenshot({ path: `${SKOTT}/mobil-r${runda}-${t}-${p.info.grupp}-resultat.png` });
  const rad = await mobiler[0].locator("#resultatkort").innerText();
  console.log(`  Farmor: ${rad.replace(/\n+/g, " | ")}`);

  if (runda === 2) {
    await mobiler[1].reload();
    await mobiler[1].waitForSelector("#resultat:not([hidden])", { timeout: 10000 });
    kolla(true, "Ella laddade om och kom tillbaka till resultatet");
  }
  if (runda === 3) {
    await tv.click("#paus");
    await vila(500);
    kolla(/Pausat/.test(await tv.locator("#vantetid").innerText()), "pausen stoppar nedräkningen");
  }
  await tv.click("#nasta");
}

kolla(!ljudfiler.some((u) => u.includes("fel=live")), `rätt inspelning valdes (${ljudfiler.length} ljudfiler hämtades)`);
await tv.waitForSelector("#tvslut:not([hidden])", { timeout: 20000 });
await Promise.all(mobiler.map((p) => p.waitForSelector("#slut:not([hidden])", { timeout: 10000 })));
await vila(3500);
await tv.screenshot({ path: `${SKOTT}/tv-slut.png` });
for (const p of mobiler) await p.screenshot({ path: `${SKOTT}/mobil-slut-${p.info.grupp}.png` });
kolla(new Set(typerSedda).size === 5, `alla fem typer kom med: ${typerSedda.join(", ")}`);
const sokningar = await (await fetch("http://localhost:54321/musiksok")).json();
console.log(`  musiksökningar: ${sokningar.join(" | ")}`);

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
