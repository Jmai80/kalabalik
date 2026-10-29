// Spelar varje utmaning i övningsläget och tar skärmdumpar.
import { startaWebblasare, nySida, WEBB, SKOTT } from "./webblasare.mjs";

const browser = await startaWebblasare();
const fel = [];
const vila = (ms) => new Promise((r) => setTimeout(r, ms));

const fall = [
  ["fraga", "mellan"], ["matte", "liten"], ["matte", "stor"], ["snabbast", "stor"],
  ["fanga", "mellan"], ["bana", "liten"], ["bana", "stor"],
];

const startsida = await nySida(browser, { namn: "ova" });
await startsida.goto(`${WEBB}/ova.html`);
await vila(400);
await startsida.screenshot({ path: `${SKOTT}/ova-val.png` });
fel.push(...startsida.fel);

for (const [typ, grupp] of fall) {
  const page = await nySida(browser, { namn: `${typ}-${grupp}` });
  await page.goto(`${WEBB}/ova.html?typ=${typ}&grupp=${grupp}`);
  await vila(700);
  await page.screenshot({ path: `${SKOTT}/ova-${typ}-${grupp}-intro.png` });
  await vila(1900);

  if (typ === "fraga") {
    await page.screenshot({ path: `${SKOTT}/ova-${typ}-${grupp}.png` });
    await page.click(".svar >> nth=0");
  } else if (typ === "matte") {
    await page.screenshot({ path: `${SKOTT}/ova-${typ}-${grupp}.png` });
    if (grupp === "liten") await page.click(".svar >> nth=1");
    else {
      for (const n of ["4", "2"]) await page.click(`.knappsats button[data-n="${n}"]`);
      await page.screenshot({ path: `${SKOTT}/ova-${typ}-${grupp}-skrivet.png` });
      await page.click(".knappsats .ok");
    }
  } else if (typ === "snabbast") {
    await page.screenshot({ path: `${SKOTT}/ova-${typ}-${grupp}-vanta.png` });
    await page.waitForSelector('.snabbknapp[data-lage="tryck"]', { timeout: 9000 });
    await vila(250);
    await page.screenshot({ path: `${SKOTT}/ova-${typ}-${grupp}-gront.png` });
    await page.locator(".snabbknapp").dispatchEvent("pointerdown");
    await vila(300);
    await page.screenshot({ path: `${SKOTT}/ova-${typ}-${grupp}-tid.png` });
  } else if (typ === "fanga") {
    const slut = Date.now() + 15500;
    let tagna = 0;
    let bild = false;
    while (Date.now() < slut) {
      const djur = page.locator(".fangbar:not(.kaktus):not([data-tagen])");
      if (!bild && (await djur.count()) >= 2) {
        await page.screenshot({ path: `${SKOTT}/ova-${typ}-${grupp}.png` });
        bild = true;
      }
      if (await djur.count()) {
        await djur.first().dispatchEvent("pointerdown").catch(() => {});
        tagna++;
      }
      await vila(120);
    }
    console.log(`    fånga: tryckte ${tagna} gånger`);
  } else if (typ === "bana") {
    for (let i = 0; i < 12; i++) {
      await page.mouse.click(i % 3 === 0 ? 60 : 330, 500);
      await vila(450);
      if (i === 5) await page.screenshot({ path: `${SKOTT}/ova-${typ}-${grupp}.png` });
    }
    await vila(20000);
  }

  await page.waitForSelector("#klar:not([hidden])", { timeout: 30000 });
  await vila(600);
  const text = await page.locator("#resultatkort").innerText();
  console.log(`  ${typ}/${grupp}: ${text.replace(/\n+/g, " | ")}`);
  await page.screenshot({ path: `${SKOTT}/ova-${typ}-${grupp}-klar.png` });
  fel.push(...page.fel);
  await page.context().close();
}

await browser.close();
if (fel.length) {
  console.log("FEL I KONSOLEN:\n" + fel.join("\n"));
  process.exit(1);
}
console.log("Övningsläget: inga fel");
