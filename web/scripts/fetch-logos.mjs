// Fetches each listed company's own site icon (apple-touch-icon, else a declared icon, else /favicon.ico)
// into public/logos/<key>.<ext>, and records where each came from in src/generated/logos.json.
// Logos are the companies' trademarks, shown only to identify them. Re-run: node scripts/fetch-logos.mjs
import fs from "node:fs";
import path from "node:path";

const SITES = {
  apple: "https://www.apple.com", openai: "https://openai.com", amazon: "https://www.amazon.com",
  netflix: "https://www.netflix.com", anthropic: "https://www.anthropic.com", meta: "https://about.meta.com",
  google: "https://www.google.com", nvidia: "https://www.nvidia.com", microsoft: "https://www.microsoft.com",
  samsung: "https://www.samsung.com", tesla: "https://www.tesla.com", tiktok: "https://www.tiktok.com",
  huawei: "https://www.huawei.com", amd: "https://www.amd.com",
};
// Where a site's declared favicon is tiny or the site blocks scripted fetches, the best icon each company
// publishes on its own site/CDN (found by reading the live page's <link rel=icon> / header logo).
const OVERRIDES = {
  openai: "https://openai.com/favicon.svg",
  meta: "https://static.xx.fbcdn.net/rsrc.php/yf/r/-7pQO6hUGK_.svg",
  amd: "https://www.amd.com/content/dam/code/images/header/amd-header-logo.svg",
  tesla: "https://www.tesla.com/themes/custom/tesla_frontend/assets/favicons/favicon-196x196.png",
  google: "https://www.gstatic.com/marketing-cms/assets/images/33/52/d31eb4894f69969b24d075e0d33c/favicon.png=s180",
  amazon: "https://www.aboutamazon.com/_next/static/media/apple-touch-icon.706b1b87.png",
  netflix: "https://about.netflix.com/images/logo.png",
};
const UA = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" };
const here = import.meta.dirname;
const outDir = path.resolve(here, "../public/logos");
fs.mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(2);

function candidates(html, base) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag, a) => tag.match(new RegExp(`${a}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  const scored = [];
  for (const l of links) {
    const rel = (attr(l, "rel") ?? "").toLowerCase();
    const href = attr(l, "href");
    if (!href || !rel.includes("icon")) continue;
    const size = Number((attr(l, "sizes") ?? "").split("x")[0]) || 0;
    const svg = /\.svg(\?|$)/i.test(href) || /svg/i.test(attr(l, "type") ?? "");
    const score = (rel.includes("apple-touch-icon") ? 1000 : 0) + (svg ? 900 : 0) + size;
    scored.push({ url: new URL(href, base).href, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return [...scored.map((s) => s.url), new URL("/apple-touch-icon.png", base).href, new URL("/favicon.ico", base).href];
}

const extOf = (type, url) =>
  /\.svg(\?|$)/i.test(url) ? "svg" :
  /svg/.test(type) ? "svg" : /png/.test(type) ? "png" : /jpe?g/.test(type) ? "jpg" : /webp/.test(type) ? "webp" : /icon/.test(type) || /\.ico/.test(url) ? "ico" : "png";

const manifestPath = path.resolve(here, "../src/generated/logos.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
for (const [key, site] of Object.entries(SITES)) {
  if (only.length && !only.includes(key)) continue;
  let html = "";
  if (!OVERRIDES[key]) try { html = await (await fetch(site, { headers: UA, redirect: "follow" })).text(); } catch {}
  let saved = null;
  for (const url of OVERRIDES[key] ? [OVERRIDES[key]] : candidates(html, site)) {
    try {
      const r = await fetch(url, { headers: UA, redirect: "follow" });
      const type = r.headers.get("content-type") ?? "";
      if (!r.ok || /html/.test(type)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 200) continue;
      const ext = extOf(type, url);
      for (const f of fs.readdirSync(outDir)) if (f.startsWith(`${key}.`)) fs.unlinkSync(path.join(outDir, f));
      fs.writeFileSync(path.join(outDir, `${key}.${ext}`), buf);
      saved = { src: `/logos/${key}.${ext}`, source: url, site };
      break;
    } catch {}
  }
  if (saved) manifest[key] = saved;
  console.log(`${key.padEnd(10)} ${saved ? `${saved.src}  <- ${saved.source}` : "NOT FOUND"}`);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
