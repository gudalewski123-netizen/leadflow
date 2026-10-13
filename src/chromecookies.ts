/**
 * Read the Instagram login out of Gregg's everyday browser on this Mac.
 *
 * Gregg, 2026-10-13: "Connect Instagram" must open in the browser the
 * dashboard is in, not a separate window. So the dashboard opens instagram.com
 * in a new tab of that browser, he logs in there like normal, and the helper
 * copies just the instagram.com cookies from that browser's cookie store into
 * the bot's own profile. No password ever passes through here.
 *
 * Chrome on macOS encrypts cookie values with a key kept in the login keychain
 * ("Chrome Safe Storage"); the first read shows a macOS prompt that Gregg
 * answers with "Always Allow". The key is asked for only when that browser
 * actually holds an Instagram session.
 */
import { execFileSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AS = join(homedir(), "Library", "Application Support");
const BROWSERS = [
  { name: "Chrome", dir: join(AS, "Google", "Chrome"), service: "Chrome Safe Storage" },
  { name: "Brave", dir: join(AS, "BraveSoftware", "Brave-Browser"), service: "Brave Safe Storage" },
];

export type IgCookie = {
  name: string; value: string; domain: string; path: string;
  expires: number; httpOnly: boolean; secure: boolean; sameSite: "Strict" | "Lax" | "None";
};
export type IgSession = { browser: string; profile: string; userId: string; cookies: IgCookie[] };

const keys = new Map<string, Buffer>(); // one keychain prompt per browser per process

function sql(db: string, q: string): string[][] {
  const out = execFileSync("/usr/bin/sqlite3", ["-separator", "\x1f", `file:${db}?immutable=1`, q], { encoding: "utf8" });
  return out.split("\n").filter(Boolean).map((l) => l.split("\x1f"));
}

function keyFor(service: string): Buffer {
  let k = keys.get(service);
  if (!k) {
    const pass = execFileSync("/usr/bin/security", ["find-generic-password", "-w", "-s", service], { encoding: "utf8" }).trim();
    k = pbkdf2Sync(pass, "saltysalt", 1003, 16, "sha1");
    keys.set(service, k);
  }
  return k;
}

function decrypt(hex: string, key: Buffer, metaVersion: number): string {
  const buf = Buffer.from(hex, "hex");
  if (buf.subarray(0, 3).toString() !== "v10") return buf.toString("utf8");
  const d = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  let out = Buffer.concat([d.update(buf.subarray(3)), d.final()]);
  if (metaVersion >= 24) out = out.subarray(32); // Chrome 130+: SHA-256 of the host is prepended
  return out.toString("utf8");
}

const chromeTime = (t: string) => Math.floor(Number(t) / 1e6 - 11644473600); // µs since 1601 → unix s
const SAME = ["None", "Lax", "Strict"] as const;

/** The most recently used Instagram session across Chrome/Brave profiles, or null. */
export function readInstagramSession(): IgSession | null {
  const found: { b: (typeof BROWSERS)[number]; profile: string; db: string; access: number }[] = [];
  for (const b of BROWSERS) {
    if (!existsSync(b.dir)) continue;
    for (const p of readdirSync(b.dir)) {
      if (p !== "Default" && !p.startsWith("Profile ")) continue;
      const db = join(b.dir, p, "Cookies");
      if (!existsSync(db) || !statSync(db).isFile()) continue;
      try {
        const r = sql(db, `SELECT last_access_utc FROM cookies WHERE host_key LIKE '%instagram.com' AND name='sessionid'
                             AND expires_utc/1000000-11644473600 > CAST(strftime('%s','now') AS INTEGER)`);
        if (r[0]) found.push({ b, profile: p, db, access: Number(r[0][0]) });
      } catch {}
    }
  }
  found.sort((x, y) => y.access - x.access);
  for (const f of found) {
    const meta = Number(sql(f.db, "SELECT value FROM meta WHERE key='version'")[0]?.[0] ?? 0);
    const key = keyFor(f.b.service);
    const rows = sql(f.db, `SELECT host_key, name, path, expires_utc, is_secure, is_httponly, samesite, value, hex(encrypted_value)
                              FROM cookies WHERE host_key LIKE '%instagram.com'`);
    const cookies: IgCookie[] = [];
    for (const [host, name, path, exp, sec, ho, ss, plain, enc] of rows) {
      let value = plain;
      if (!value && enc) { try { value = decrypt(enc, key, meta); } catch { continue; } }
      if (!value) continue;
      const expires = Number(exp) ? chromeTime(exp) : -1;
      if (expires !== -1 && expires < Date.now() / 1000) continue;
      cookies.push({ name, value, domain: host, path: path || "/", expires, httpOnly: ho === "1", secure: sec === "1",
                     sameSite: SAME[Number(ss)] ?? "Lax" });
    }
    const userId = cookies.find((c) => c.name === "ds_user_id")?.value;
    if (cookies.some((c) => c.name === "sessionid") && userId && /^\d+$/.test(userId))
      return { browser: f.b.name, profile: f.profile, userId, cookies };
  }
  return null;
}
