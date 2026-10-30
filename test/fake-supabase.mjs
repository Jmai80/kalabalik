// En liten låtsas-Supabase för automatiska tester.
// Den riktiga databaslogiken körs i en lokal Postgres (samma kalabalik.sql
// som i Supabase). Servern efterliknar bara det som supabase-js pratar med:
//   /auth/v1        anonym inloggning, lösenordsinloggning
//   /rest/v1/rpc    anrop till databasfunktionerna
//   /realtime/v1    postgres_changes och broadcast över websocket (protokoll 2.0.0)
// Dessutom serveras mappen docs/ på en egen port.

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { WebSocketServer } from "ws";

const API_PORT = Number(process.env.API_PORT ?? 54321);
const WEB_PORT = Number(process.env.WEB_PORT ?? 8080);
const DOCS = path.resolve(process.env.DOCS ?? new URL("../docs", import.meta.url).pathname);
const PG = { host: "/tmp", port: 5444, user: "postgres", database: process.env.PGDB ?? "kalabalik" };
const HEMLIGHET = "test-hemlighet";
const LOGG = process.env.LOGG === "1";

const pool = new pg.Pool({ ...PG, max: 20 });
const MUSIKSOK = [];

// 30 sekunder lågmäld ton som "låt" (wav, 8 kHz mono)
const LJUD = (() => {
  const hz = 8000, sek = 30, n = hz * sek;
  const b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(hz, 24);
  b.writeUInt32LE(hz, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) b[44 + i] = 128 + Math.round(10 * Math.sin((2 * Math.PI * 440 * i) / hz));
  return b;
})();

// ---------- JWT ----------

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(anvandare) {
  const nu = Math.floor(Date.now() / 1000);
  const kropp = b64({
    sub: anvandare.id, role: "authenticated", aud: "authenticated",
    is_anonymous: anvandare.is_anonymous, email: anvandare.email ?? "",
    iat: nu, exp: nu + 24 * 3600,
  });
  const huvud = b64({ alg: "HS256", typ: "JWT" });
  const sig = crypto.createHmac("sha256", HEMLIGHET).update(`${huvud}.${kropp}`).digest("base64url");
  return `${huvud}.${kropp}.${sig}`;
}
function lasJwt(token) {
  if (!token) return null;
  const [h, k, s] = token.split(".");
  if (!s) return null;
  const vantad = crypto.createHmac("sha256", HEMLIGHET).update(`${h}.${k}`).digest("base64url");
  if (vantad !== s) return null;
  return JSON.parse(Buffer.from(k, "base64url").toString());
}

function anvandarObjekt(a) {
  return {
    id: a.id, aud: "authenticated", role: "authenticated", email: a.email ?? "",
    is_anonymous: a.is_anonymous, app_metadata: {}, user_metadata: {},
    created_at: a.created_at, identities: [],
  };
}
function session(a) {
  return {
    access_token: jwt(a), token_type: "bearer", expires_in: 24 * 3600,
    expires_at: Math.floor(Date.now() / 1000) + 24 * 3600,
    refresh_token: a.id, user: anvandarObjekt(a),
  };
}

// ---------- RPC ----------

const funktioner = new Map();
async function funktionsInfo(namn) {
  if (funktioner.has(namn)) return funktioner.get(namn);
  const { rows } = await pool.query(
    `select p.proargnames as namn,
            array(select format_type(t, null) from unnest(p.proargtypes) t) as typer,
            format_type(p.prorettype, null) as retur
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`, [namn]);
  const info = rows[0] ?? null;
  funktioner.set(namn, info);
  return info;
}

async function rpc(namn, argument, claims) {
  const info = await funktionsInfo(namn);
  if (!info) return { status: 404, kropp: { code: "PGRST202", message: `Funktionen ${namn} finns inte` } };

  const varden = [];
  const delar = [];
  (info.namn ?? []).forEach((n, i) => {
    if (!(n in argument)) return;
    const v = argument[n];
    varden.push(v === null ? null : info.typer[i] === "jsonb" ? JSON.stringify(v) : String(v));
    delar.push(`${n} := $${varden.length}::${info.typer[i]}`);
  });
  const anrop = `public.${namn}(${delar.join(", ")})`;
  const sql = info.retur === "void" ? `select ${anrop}` : `select to_jsonb(${anrop}) as r`;

  const klient = await pool.connect();
  try {
    await klient.query("begin");
    await klient.query(claims ? "set local role authenticated" : "set local role anon");
    await klient.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role: "anon" })]);
    const { rows } = await klient.query(sql, varden);
    await klient.query("commit");
    return { status: 200, kropp: info.retur === "void" ? null : rows[0]?.r ?? null };
  } catch (e) {
    await klient.query("rollback").catch(() => {});
    return { status: 400, kropp: { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null } };
  } finally {
    klient.release();
  }
}

// ---------- HTTP ----------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function svara(res, status, kropp) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(kropp === undefined ? "" : JSON.stringify(kropp));
}

async function lasKropp(req) {
  let data = "";
  for await (const bit of req) data += bit;
  return data ? JSON.parse(data) : {};
}

const api = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") return svara(res, 204);
  const claims = lasJwt((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  if (LOGG) console.log(req.method, url.pathname);

  try {
    if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
      const { rows } = await pool.query("insert into auth.users (is_anonymous) values (true) returning *");
      return svara(res, 200, session(rows[0]));
    }
    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const kropp = await lasKropp(req);
      const typ = url.searchParams.get("grant_type");
      let rows = [];
      if (typ === "password") {
        ({ rows } = await pool.query("select * from auth.users where email = $1 and losenord = $2", [kropp.email, kropp.password]));
        if (!rows[0]) return svara(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      } else if (typ === "refresh_token") {
        ({ rows } = await pool.query("select * from auth.users where id::text = $1", [kropp.refresh_token]));
        if (!rows[0]) return svara(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      }
      return svara(res, 200, session(rows[0]));
    }
    if (url.pathname === "/auth/v1/user") {
      if (!claims) return svara(res, 401, { code: 401, msg: "invalid JWT" });
      const { rows } = await pool.query("select * from auth.users where id = $1", [claims.sub]);
      if (!rows[0]) return svara(res, 403, { code: 403, error_code: "user_not_found", msg: "User not found" });
      return svara(res, 200, anvandarObjekt(rows[0]));
    }
    if (url.pathname === "/auth/v1/logout") return svara(res, 204);

    const m = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (m && req.method === "POST") {
      const { status, kropp } = await rpc(m[1], await lasKropp(req), claims);
      if (LOGG && status !== 200) console.log("  ->", status, kropp?.message);
      return svara(res, status, kropp);
    }

    // Musikfunktionen (Edge Function "media"). Svarar med låten ur kb_latar,
    // en liveversion av den och en annan låt, som iTunes brukar göra.
    // Var femte låt "saknas", så att det testas vad som händer då.
    if (url.pathname === "/functions/v1/media" && req.method === "POST") {
      const { sok } = await lasKropp(req);
      const { rows } = await pool.query(
        "select * from kb_latar where coalesce(nullif(trim(sok), ''), artist || ' ' || titel) = $1", [sok]);
      const l = rows[0];
      MUSIKSOK.push(sok);
      if (!l || l.id % 5 === 0) return svara(res, 200, []);
      const bas = { album: "Testskiva", ar: "2015", bild: `http://localhost:${API_PORT}/omslag.svg?t=${encodeURIComponent(l.titel)}`, ljud: `http://localhost:${API_PORT}/ljud.wav?id=${l.id}` };
      return svara(res, 200, [
        { ...bas, id: `${l.id}1`, titel: `${l.titel} (Live)`, artist: l.artist, ljud: `http://localhost:${API_PORT}/ljud.wav?fel=live` },
        { ...bas, id: `${l.id}2`, titel: `${l.titel} - Remastered 2011`, artist: l.artist, album: "Greatest Hits" },
        { ...bas, id: `${l.id}3`, titel: "Någon helt annan låt", artist: "Okänd artist" },
      ]);
    }
    if (url.pathname === "/ljud.wav") {
      res.writeHead(200, { ...CORS, "Content-Type": "audio/wav", "Content-Length": LJUD.length });
      return res.end(LJUD);
    }
    if (url.pathname === "/omslag.svg") {
      const t = (url.searchParams.get("t") ?? "").replace(/[<&>"]/g, "");
      res.writeHead(200, { ...CORS, "Content-Type": "image/svg+xml" });
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="#ff73b9"/><circle cx="150" cy="150" r="90" fill="#221a4e"/><text x="150" y="280" font-size="22" text-anchor="middle" font-family="sans-serif" fill="#17112f">${t}</text></svg>`);
    }
    if (url.pathname === "/musiksok") return svara(res, 200, MUSIKSOK);

    console.error("OKÄNT ANROP:", req.method, url.pathname + url.search);
    return svara(res, 404, { message: `Testservern känner inte till ${url.pathname}` });
  } catch (e) {
    console.error(e);
    return svara(res, 500, { message: e.message });
  }
});

// ---------- Realtime ----------

const wss = new WebSocketServer({ noServer: true });
const klienter = new Set();
let nastaId = 1;

function skicka(ws, join_ref, ref, topic, event, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify([join_ref, ref, topic, event, payload]));
}

function avkodaBinarBroadcast(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const [joinLen, refLen, topicLen, eventLen, metaLen, kodning] = [1, 2, 3, 4, 5, 6].map((i) => v.getUint8(i));
  let o = 7;
  const las = (n) => { const s = buf.subarray(o, o + n).toString("utf8"); o += n; return s; };
  const join_ref = las(joinLen), ref = las(refLen), topic = las(topicLen), event = las(eventLen);
  las(metaLen);
  const rest = buf.subarray(o).toString("utf8");
  return { join_ref, ref, topic, event, payload: kodning === 1 ? JSON.parse(rest) : rest };
}

wss.on("connection", (ws) => {
  const klient = { ws, kanaler: new Map() };
  klienter.add(klient);
  ws.on("close", () => klienter.delete(klient));

  ws.on("message", (data, arBinar) => {
    if (arBinar) {
      const b = avkodaBinarBroadcast(Buffer.from(data));
      for (const annan of klienter) {
        if (annan === klient || !annan.kanaler.has(b.topic)) continue;
        skicka(annan.ws, null, null, b.topic, "broadcast", { type: "broadcast", event: b.event, payload: b.payload });
      }
      skicka(ws, b.join_ref, b.ref, b.topic, "phx_reply", { status: "ok", response: {} });
      return;
    }

    const [join_ref, ref, topic, event, payload] = JSON.parse(data.toString());
    const ok = (response = {}) => skicka(ws, join_ref, ref, topic, "phx_reply", { status: "ok", response });

    if (event === "heartbeat") return ok();
    if (event === "phx_join") {
      const bindningar = (payload?.config?.postgres_changes ?? []).map((b) => ({ ...b, id: nastaId++ }));
      klient.kanaler.set(topic, { join_ref, bindningar });
      return ok({ postgres_changes: bindningar.map(({ id, event, schema, table, filter }) => ({ id, event, schema, table, filter })) });
    }
    if (event === "phx_leave") {
      klient.kanaler.delete(topic);
      return ok();
    }
    if (event === "broadcast") {
      for (const annan of klienter) {
        if (annan === klient || !annan.kanaler.has(topic)) continue;
        skicka(annan.ws, null, null, topic, "broadcast", payload);
      }
      return ok();
    }
    return ok(); // access_token m.m.
  });
});

api.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/realtime/v1/websocket")) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

function matchar(b, andring) {
  if (b.schema && b.schema !== "*" && b.schema !== "public") return false;
  if (b.table && b.table !== "*" && b.table !== andring.table) return false;
  if (b.event !== "*" && b.event !== andring.type) return false;
  if (b.filter && andring.type !== "DELETE") {
    const [, kol, varde] = b.filter.match(/^(\w+)=eq\.(.*)$/) ?? [];
    if (kol && String(andring.record?.[kol]) !== varde) return false;
  }
  return true;
}

const lyssnare = new pg.Client(PG);
await lyssnare.connect();
await lyssnare.query("listen kb_andring");
lyssnare.on("notification", (n) => {
  const andring = JSON.parse(n.payload);
  for (const klient of klienter) {
    for (const [topic, kanal] of klient.kanaler) {
      const ids = kanal.bindningar.filter((b) => matchar(b, andring)).map((b) => b.id);
      if (!ids.length) continue;
      skicka(klient.ws, null, null, topic, "postgres_changes", {
        ids,
        data: {
          schema: "public", table: andring.table, commit_timestamp: new Date().toISOString(),
          type: andring.type, columns: [], record: andring.record ?? {},
          old_record: andring.old_record ?? {}, errors: null,
        },
      });
    }
  }
});

// ---------- Statiska filer ----------

const TYPER = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
};
const webb = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  let fil = path.join(DOCS, p);
  if (!fs.existsSync(fil) && fs.existsSync(fil + ".html")) fil += ".html"; // som GitHub Pages
  if (!fil.startsWith(DOCS) || !fs.existsSync(fil) || fs.statSync(fil).isDirectory()) {
    res.writeHead(404); return res.end("404");
  }
  res.writeHead(200, { "Content-Type": TYPER[path.extname(fil)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(fil).pipe(res);
});

api.listen(API_PORT, () => console.log(`Låtsas-Supabase på http://localhost:${API_PORT}`));
webb.listen(WEB_PORT, () => console.log(`docs/ på http://localhost:${WEB_PORT}`));
