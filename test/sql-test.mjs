// Spelar igenom en hel omgång direkt mot databasfunktionerna (via testservern)
// och kontrollerar poängräkning, rättigheter och felmeddelanden.
// Kör: node sql-test.mjs  (testservern måste vara igång)

import assert from "node:assert/strict";

const API = "http://localhost:54321";
let fel = 0;

async function loggaIn(sätt) {
  const r = await fetch(`${API}/auth/v1/${sätt === "anonym" ? "signup" : "token?grant_type=password"}`, {
    method: "POST",
    body: JSON.stringify(sätt === "anonym" ? {} : { email: "vard@test.se", password: "hemligt" }),
  });
  return (await r.json()).access_token;
}

function klient(token) {
  return async (fn, args = {}) => {
    const r = await fetch(`${API}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) {
      const e = new Error(data.message);
      e.data = data;
      throw e;
    }
    return data;
  };
}

async function test(namn, f) {
  try {
    await f();
    console.log("  ✓", namn);
  } catch (e) {
    fel++;
    console.log("  ✗", namn, "\n     ", e.message);
  }
}

const vard = klient(await loggaIn("lösenord"));
const anna = klient(await loggaIn("anonym")); // vuxen
const bo = klient(await loggaIn("anonym"));   // 10 år
const cia = klient(await loggaIn("anonym"));  // 6 år

console.log("Rum och lobby");
let rum;
await test("anonyma kan inte skapa rum", async () => {
  await assert.rejects(anna("kb_skapa_rum"), /Logga in som värd/);
});
await test("värden skapar rum med fyrteckenskod", async () => {
  rum = await vard("kb_skapa_rum");
  assert.match(rum.kod, /^[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(rum.status, "lobby");
});
await test("kan inte starta utan spelare", async () => {
  await assert.rejects(vard("kb_starta", { p_rum: rum.id, p_antal: 8 }), /inga spelare/);
});
let A, B, C;
await test("spelare går med (koden fungerar med gemener)", async () => {
  A = (await anna("kb_ga_med", { p_kod: rum.kod, p_namn: "Anna", p_grupp: "stor", p_avatar: "🦊" })).spelare;
  B = (await bo("kb_ga_med", { p_kod: rum.kod.toLowerCase(), p_namn: "Bo", p_grupp: "mellan", p_avatar: "🐸" })).spelare;
  C = (await cia("kb_ga_med", { p_kod: ` ${rum.kod} `, p_namn: "Cia", p_grupp: "liten", p_avatar: "🐣" })).spelare;
  assert.equal(C.grupp, "liten");
});
await test("upptaget namn ger begripligt fel", async () => {
  const d = klient(await loggaIn("anonym"));
  await assert.rejects(d("kb_ga_med", { p_kod: rum.kod, p_namn: "anna", p_grupp: "stor", p_avatar: "🐼" }), /redan taget/);
});
await test("fel kod ger begripligt fel", async () => {
  await assert.rejects(anna("kb_ga_med", { p_kod: "ZZZZ", p_namn: "X", p_grupp: "stor", p_avatar: "" }), /Hittar inget rum/);
});
await test("man kan byta figur genom att gå med igen", async () => {
  const ny = (await anna("kb_ga_med", { p_kod: rum.kod, p_namn: "Anna", p_grupp: "stor", p_avatar: "🦁" })).spelare;
  assert.equal(ny.id, A.id);
  assert.equal(ny.avatar, "🦁");
});
await test("spelare hittar tillbaka till sitt rum", async () => {
  const m = await bo("kb_mitt_spel");
  assert.equal(m.rum.id, rum.id);
  assert.equal(m.spelare.namn, "Bo");
});
await test("spelare kan inte styra rummet", async () => {
  await assert.rejects(anna("kb_starta", { p_rum: rum.id, p_antal: 5 }), /inte värd/);
});
await test("interna funktioner går inte att anropa", async () => {
  await assert.rejects(vard("kb_ny_utmaning", { p_rum: rum.id, p_typ: "fraga" }), /permission denied/);
  await assert.rejects(anna("kb_mattetal", { p_grupp: "stor" }), /permission denied/);
});

console.log("En hel omgång");

await vard("kb_starta", { p_rum: rum.id, p_antal: 12 });
let lage = await vard("kb_lage", { p_rum: rum.id });
const TYPER = ["fraga", "gissaar", "vemsjunger", "narmast", "matte"];
await test(`planen innehåller alla fem typer och inga dubbletter i rad (${lage.rum.plan.join(" ")})`, async () => {
  const plan = lage.rum.plan;
  assert.equal(plan.length, 12);
  for (const t of TYPER) assert.ok(plan.includes(t), t);
  for (let i = 1; i < plan.length; i++) assert.notEqual(plan[i], plan[i - 1]);
});
await test("utmaningen innehåller inget facit", async () => {
  assert.equal(lage.rum.status, "intro");
  assert.ok(!("facit" in lage.rum.utmaning));
  const text = JSON.stringify(lage.rum.utmaning);
  assert.ok(!text.includes('"svar"') && !text.includes('"ar"') && !text.includes('"sok"'), text);
});
await test("man kan inte svara under introt", async () => {
  await assert.rejects(anna("kb_svara", { p_rum: rum.id, p_runda: 1, p_svar: { val: 0 } }), /Rundan är redan slut/);
});

const sett = new Set();
const pg = (await import("pg")).default;
const db = new pg.Client({ host: "/tmp", port: 5444, user: "postgres", database: "kalabalik" });
await db.connect();
const facitFor = async (runda) =>
  (await db.query("select facit from kb_hemligt where rum_id = $1 and runda = $2", [rum.id, runda])).rows[0].facit;
const vila = (ms) => new Promise((r) => setTimeout(r, ms));
const sedda = { fraga: new Set(), lat: new Set() };

for (let runda = 1; runda <= 12; runda++) {
  lage = await vard("kb_lage", { p_rum: rum.id });
  const u = lage.rum.utmaning;
  sett.add(u.typ);
  const facit = await facitFor(runda);

  if (u.typ === "gissaar" || u.typ === "vemsjunger") {
    await test(`runda ${runda} (${u.typ}): bara värden får veta låten (${facit.artist} – ${facit.titel}, ${facit.ar})`, async () => {
      const m = await vard("kb_musik", { p_rum: rum.id });
      assert.equal(m.artist, facit.artist);
      assert.ok(m.sok.length > 3);
      assert.ok(!("ratt" in m));
      await assert.rejects(anna("kb_musik", { p_rum: rum.id }), /inte värd/);
      assert.ok(!sedda.lat.has(facit.titel), "samma låt två gånger");
      sedda.lat.add(facit.titel);
    });
  } else {
    await test(`runda ${runda} (${u.typ}): kb_musik ger inget`, async () => {
      assert.equal(await vard("kb_musik", { p_rum: rum.id }), null);
    });
  }
  await vard("kb_borja", { p_rum: rum.id });

  if (u.typ === "fraga" || u.typ === "vemsjunger") {
    assert.equal(u.alternativ.length, 4);
    if (u.typ === "vemsjunger") {
      await test(`runda ${runda}: fyra olika artister (${u.alternativ.join(", ")})`, async () => {
        assert.equal(new Set(u.alternativ).size, 4);
        assert.equal(u.alternativ[facit.ratt], facit.artist);
      });
    } else {
      sedda.fraga.add(u.fraga);
    }
    await anna("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { val: facit.ratt } });
    await bo("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { val: (facit.ratt + 1) % 4 } });
    await vila(700);
    await cia("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { val: facit.ratt } });
  } else if (u.typ === "matte") {
    await anna("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { tal: facit.stor } });
    await bo("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { tal: facit.mellan } });
    await cia("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { tal: facit.liten } });
  } else if (u.typ === "gissaar") {
    await anna("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { ar: facit.ar } });       // exakt
    await bo("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { ar: facit.ar + 3 } });     // 3 år fel, marginal 15
    await cia("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { ar: facit.ar - 25 } });   // för långt bort
    await test(`runda ${runda}: årtal måste vara ett tal`, async () => {
      const d = klient(await loggaIn("anonym"));
      await d("kb_ga_med", { p_kod: rum.kod, p_namn: `Text${runda}`, p_grupp: "stor", p_avatar: "🐢" });
      await assert.rejects(d("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { ar: "nittiotal" } }), /årtal/);
      await vard("kb_sparka", { p_spelare: (await d("kb_lage", { p_rum: rum.id })).jag.id });
    });
  } else if (u.typ === "narmast") {
    await test(`runda ${runda}: närmast-frågan har text och enhet (${u.fraga} [${u.enhet}])`, async () => {
      assert.ok(u.fraga.length > 5);
    });
    await anna("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { tal: Number(facit.svar) + 5 } });
    await bo("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { tal: Number(facit.svar) - 2 } });
    await cia("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { tal: Number(facit.svar) + 100 } });
  }

  await test(`runda ${runda} (${u.typ}): dubbelsvar ignoreras`, async () => {
    await anna("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { val: 0, tal: 0, ar: 1900 } }).catch(() => {});
  });
  const svarade = (await vard("kb_lage", { p_rum: rum.id })).svarade;
  assert.equal(svarade.length, 3);

  await vard("kb_avsluta_runda", { p_rum: rum.id });
  await vard("kb_avsluta_runda", { p_rum: rum.id }); // dubbelklick gör inget
  const res = await vard("kb_resultat", { p_rum: rum.id });
  const p = Object.fromEntries(res.runda.map((x) => [x.namn, x.poang]));

  await test(`runda ${runda} (${u.typ}): poäng ${JSON.stringify(p)}`, async () => {
    if (u.typ === "fraga" || u.typ === "vemsjunger") {
      assert.ok(p.Anna > 950, "Anna rätt och snabb");
      assert.equal(p.Bo, 0);
      assert.ok(p.Cia > 900 && p.Cia <= p.Anna, "Cia rätt, lite långsammare men med 2x tid");
    } else if (u.typ === "matte") {
      assert.ok(p.Anna >= 600 && p.Bo >= 600 && p.Cia >= 600);
    } else if (u.typ === "gissaar") {
      assert.deepEqual([p.Anna, p.Bo, p.Cia], [1000, 800, 0]);
    } else if (u.typ === "narmast") {
      assert.deepEqual([p.Bo, p.Anna, p.Cia], [1000, 800, 650]);
    }
  });

  const lageEfter = await anna("kb_lage", { p_rum: rum.id });
  await test(`runda ${runda}: facit syns i resultatet, men inte söksträngen`, async () => {
    assert.equal(lageEfter.rum.status, "resultat");
    const f = lageEfter.rum.utmaning.facit;
    assert.ok(f, "facit saknas");
    assert.ok(!("sok" in f));
    if (u.typ === "fraga") assert.equal(f.ratt, facit.ratt);
    if (u.typ === "gissaar") assert.equal(f.ar, facit.ar);
    if (u.typ === "narmast") assert.equal(Number(f.svar), Number(facit.svar));
  });
  await test(`runda ${runda}: för sent svar avvisas`, async () => {
    const d = klient(await loggaIn("anonym"));
    await d("kb_ga_med", { p_kod: rum.kod, p_namn: `Sen${runda}`, p_grupp: "stor", p_avatar: "🐢" });
    await assert.rejects(d("kb_svara", { p_rum: rum.id, p_runda: runda, p_svar: { val: 0 } }), /Rundan är redan slut/);
    const sen = (await d("kb_lage", { p_rum: rum.id })).jag;
    await vard("kb_sparka", { p_spelare: sen.id });
  });

  const jag = (await cia("kb_resultat", { p_rum: rum.id })).jag;
  await test(`runda ${runda}: Cia ser sin egen placering`, async () => {
    assert.equal(jag.namn, "Cia");
    assert.ok(jag.placering >= 1 && jag.placering <= 3);
  });

  await vard("kb_nasta", { p_rum: rum.id });
}

lage = await vard("kb_lage", { p_rum: rum.id });
await test("efter sista rundan är spelet slut", async () => {
  assert.equal(lage.rum.status, "slut");
  assert.equal(sett.size, 5);
  const { rows } = await db.query("select array_length(anvanda_fragor, 1) f, array_length(anvanda_latar, 1) l, array_position(anvanda_fragor, null) n from kb_rum where id = $1", [rum.id]);
  assert.equal(rows[0].n, null, "NULL i listan över använda frågor");
});
const slut = await vard("kb_resultat", { p_rum: rum.id });
await test(`topplistan: ${slut.topplista.map((t) => `${t.placering}. ${t.namn} ${t.poang}`).join(", ")}`, async () => {
  assert.equal(slut.topplista.length, 3);
  const summa = slut.topplista.reduce((s, t) => s + t.poang, 0);
  const { rows } = await db.query("select sum(poang)::int as s from kb_svar where rum_id = $1", [rum.id]);
  assert.equal(summa, rows[0].s);
});

console.log("Spela igen och städa");
await test("tillbaka till lobbyn nollställer poängen men behåller spelarna", async () => {
  await vard("kb_till_lobbyn", { p_rum: rum.id });
  const l = await vard("kb_lage", { p_rum: rum.id });
  assert.equal(l.rum.status, "lobby");
  assert.equal(l.spelare.length, 3);
  assert.ok(l.spelare.every((s) => s.poang === 0));
});
await test("tre rundor räcker för ett kort spel", async () => {
  await vard("kb_starta", { p_rum: rum.id, p_antal: 3 });
  const l = await vard("kb_lage", { p_rum: rum.id });
  assert.equal(l.rum.plan.length, 3);
  assert.equal(new Set(l.rum.plan).size, 3);
  assert.ok(!l.rum.plan.some((t) => ["snabbast", "fanga", "bana"].includes(t)));
});
await test("spelare kan lämna", async () => {
  await cia("kb_lamna", { p_rum: rum.id });
  const l = await vard("kb_lage", { p_rum: rum.id });
  assert.equal(l.spelare.length, 2);
  assert.equal(await cia("kb_mitt_spel"), null);
});
await test("kb_lage kräver att man är med", async () => {
  await assert.rejects(cia("kb_lage", { p_rum: rum.id }), /inte med/);
});
await test("värden hittar tillbaka till sitt rum", async () => {
  const r = await vard("kb_vardrum");
  assert.equal(r.id, rum.id);
});
await test("städningen tar bort gamla rum", async () => {
  await db.query("update kb_rum set aktiv = now() - interval '13 hours' where id = $1", [rum.id]);
  await db.query("select kb_stada()");
  const { rows } = await db.query("select count(*)::int as n from kb_spelare where rum_id = $1", [rum.id]);
  assert.equal(rows[0].n, 0);
});

await test("mattetalen ser rimliga ut (200 st per grupp)", async () => {
  for (const g of ["liten", "mellan", "stor"]) {
    const { rows } = await db.query(`select kb_mattetal($1) as t from generate_series(1, 200)`, [g]);
    for (const { t } of rows) {
      assert.ok(Number.isInteger(t.svar) && t.svar >= 0, JSON.stringify(t));
      const uttryck = t.text.replace(/·/g, "*").replace(/−/g, "-").replace(/(\d+) % av (\d+)/, "$1*$2/100").replace(/(\d+)²/, "$1*$1");
      assert.equal(eval(uttryck), t.svar, t.text);
      if (g === "liten") assert.ok(t.svar <= 10);
    }
  }
});

await db.end();
console.log(fel ? `\n${fel} test misslyckades` : "\nAlla test gick igenom");
process.exit(fel ? 1 : 0);
