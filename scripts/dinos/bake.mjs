import { chromium } from "playwright";
import fs from "fs";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
const p = await b.newPage();
p.on("pageerror", e => console.log("err", e.message));
p.on("console", m => { if (m.type()==='error') console.log("console", m.text().slice(0,200)); });
fs.mkdirSync("/tmp/claude-0/dino/baked", { recursive: true });
const metas = fs.existsSync("/tmp/claude-0/dino/baked/meta.json") ? JSON.parse(fs.readFileSync("/tmp/claude-0/dino/baked/meta.json")) : {};
for (const sp of process.argv.slice(2)) {
  await p.goto(`http://127.0.0.1:8111/bake.html?sp=${sp}&v=${Date.now()}`);
  try { await p.waitForFunction(() => document.title === 'done', null, { timeout: 240000 }); } catch { console.log(sp, 'timeout'); continue; }
  const r = await p.evaluate(() => window.RESULT);
  fs.writeFileSync(`/tmp/claude-0/dino/baked/${sp}.raw.glb`, Buffer.from(r.glb, 'base64'));
  fs.writeFileSync(`/tmp/claude-0/dino/baked/${sp}.anim`, Buffer.from(r.anim, 'base64'));
  metas[sp] = r.meta;
  console.log(sp, JSON.stringify(r.meta), (r.glb.length*0.75/1e6).toFixed(2)+'MB', (r.anim.length*0.75/1e6).toFixed(2)+'MB');
}
fs.writeFileSync("/tmp/claude-0/dino/baked/meta.json", JSON.stringify(metas, null, 1));
await b.close();
