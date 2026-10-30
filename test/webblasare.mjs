// Gemensamt för webbläsartesterna: startar Chromium, pekar sidorna mot
// testservern och ersätter esm.sh med lokala kopior av biblioteken.

import { chromium } from "playwright";
import fs from "node:fs";

export const WEBB = "http://localhost:8080";
const VENDOR = new URL("./vendor/", import.meta.url).pathname;
export const SKOTT = process.env.SKOTT ?? "/tmp/kb-skott";
fs.mkdirSync(SKOTT, { recursive: true });

export async function startaWebblasare() {
  return chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
}

export async function nySida(browser, { mobil = true, namn = "sida" } = {}) {
  const context = await browser.newContext(
    mobil
      ? { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "sv-SE" }
      : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, locale: "sv-SE" },
  );
  await context.addInitScript(() => {
    window.KB_TEST = { url: "http://localhost:54321", key: "test-nyckel" };
  });
  await context.route("https://esm.sh/**", (route) => {
    const url = route.request().url();
    const fil = url.includes("supabase-js") ? "supabase.mjs" : url.includes("qrcode") ? "qrcode.mjs" : null;
    if (!fil) return route.abort();
    route.fulfill({ path: VENDOR + fil, contentType: "text/javascript" });
  });
  const page = await context.newPage();
  page.fel = [];
  page.on("pageerror", (e) => page.fel.push(`${namn}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") page.fel.push(`${namn}: ${m.text()}`);
  });
  return page;
}
