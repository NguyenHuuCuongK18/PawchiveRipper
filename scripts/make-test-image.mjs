import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

// Original geometric fixture: no downloaded artwork or external assets.
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#14141b'; ctx.fillRect(0, 0, 128, 96);
    ctx.fillStyle = '#c4afff'; ctx.fillRect(18, 18, 92, 14);
    ctx.strokeStyle = '#c4afff'; ctx.lineWidth = 6; ctx.strokeRect(24, 32, 80, 46);
    ctx.beginPath(); ctx.moveTo(64, 42); ctx.lineTo(64, 65); ctx.moveTo(52, 55); ctx.lineTo(64, 67); ctx.lineTo(76, 55); ctx.stroke();
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  await writeFile('tests/fixtures/test-image.jpg', Buffer.from(base64, 'base64'));
  console.log('Generated tests/fixtures/test-image.jpg from original geometric shapes.');
} finally { await browser.close(); }
