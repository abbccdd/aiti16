/* 生成分享图上的二维码 → assets/qr.png
   只在构建时联网，产物进仓库；页面运行时不再请求任何东西。
   跑法：node tools/qr.mjs            用默认站点地址
        $env:AITI_SITE=...; node tools/qr.mjs
*/
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = (process.env.AITI_SITE || "https://abbccdd.github.io/aiti16").replace(/\/+$/, "") + "/";
const SIZE = 240; // 画到长图上会缩到 ~120px，2 倍图保证清晰

const url =
  "https://api.qrserver.com/v1/create-qr-code/" +
  `?size=${SIZE}x${SIZE}&margin=0&ecc=M&color=2c2825&bgcolor=fffdfb` +
  `&data=${encodeURIComponent(SITE)}`;

try {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const isPng = buf.length > 64 && buf.readUInt32BE(0) === 0x89504e47;
  if (!isPng) throw new Error("返回的不是 PNG");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const out = path.join(ROOT, "assets", "qr.png");
  fs.writeFileSync(out, buf);
  console.log(`assets/qr.png ${width}×${height}，${(buf.length / 1024).toFixed(1)} KB，指向 ${SITE}`);
} catch (err) {
  console.warn(`二维码生成失败（${err.message}）。长图会省略二维码，其余部分不受影响。`);
  process.exitCode = 0;
}
