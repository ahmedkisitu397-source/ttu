// Generates favicon / PWA / Android icons from the TTu pigeon icon (version WITHOUT the name).
import sharp from 'sharp';
import fs from 'node:fs';
const SRC = process.env.ICON_SRC || '../ttu-pigeon-icon.png';
fs.mkdirSync('public/icons', { recursive: true });
fs.mkdirSync('assets', { recursive: true });
fs.copyFileSync(SRC, 'assets/ttu-icon-source.png');
for (const s of [16, 32, 48, 64, 128, 180, 192, 256, 512]) await sharp(SRC).resize(s, s).png().toFile(`public/icons/icon-${s}.png`);
await sharp(SRC).resize(32, 32).png().toFile('public/favicon.png');
await sharp(SRC).resize(180, 180).flatten({ background: '#14b8a6' }).png().toFile('public/icons/apple-touch-icon.png');
// Maskable: full-bleed gradient background with the pigeon inside the safe zone.
const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2dd4bf"/><stop offset="1" stop-color="#059669"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/></svg>`);
const inner = await sharp(SRC).resize(400, 400).png().toBuffer();
await sharp(bg).composite([{ input: inner, gravity: 'center' }]).png().toFile('public/icons/maskable-512.png');
await sharp('public/icons/maskable-512.png').resize(192, 192).toFile('public/icons/maskable-192.png');
await sharp(SRC).resize(256, 256).png().toFile('assets/pdf-icon.png');
console.log('icons done');
