import { chromium } from "playwright";
import fs from "fs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--js-flags=--max-old-space-size=6000"] });
const p = await b.newPage({ viewport: { width: 800, height: 800 } });
p.on("pageerror", e => console.log("err", e.message));
fs.mkdirSync("/tmp/claude-0/plants/out", { recursive: true });
const metas = fs.existsSync("/tmp/claude-0/plants/out/meta.json") ? JSON.parse(fs.readFileSync("/tmp/claude-0/plants/out/meta.json")) : {};
for (const spec of process.argv.slice(2)) {
  const [name, src, f='512', only=''] = spec.split('|');
  await p.goto(`http://127.0.0.1:8111/impostor.html?src=${encodeURIComponent(src)}&f=${f}${only?'&only='+encodeURIComponent(only):''}&v=${Date.now()}`);
  try { await p.waitForFunction(() => document.title === 'done', null, { timeout: 600000 }); } catch { console.log(name, 'timeout'); continue; }
  const r = await p.evaluate(() => window.RESULT);
  for (const k of ['albedo','normal']) fs.writeFileSync(`/tmp/claude-0/plants/out/${name}_${k}.png`, Buffer.from(r[k].split(',')[1], 'base64'));
  metas[name] = r.meta; console.log(name, JSON.stringify(r.meta));
  fs.writeFileSync("/tmp/claude-0/plants/out/meta.json", JSON.stringify(metas, null, 1));
}
await b.close();
