import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const serverId = process.argv[2];
if (!serverId || !/^\d{1,25}$/.test(serverId)) throw new Error('Usage: node scripts/server-recon.mjs SERVER_ID');
const root = `https://kemono.cr/discord/server/${serverId}`;
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(root, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`a[href*="/discord/server/${serverId}/"]`);
  const result = await page.evaluate(serverId => {
    const links = [...document.querySelectorAll('a[href]')].filter(a => { const url = new URL(a.href); return url.origin === 'https://kemono.cr' && url.pathname.startsWith(`/discord/server/${serverId}/`) && /^\d+\/?$/.test(url.pathname.slice(`/discord/server/${serverId}/`.length)); });
    // Keep only public channel navigation; no arbitrary page HTML or account controls.
    const safe = document.createElement('nav');
    for (const link of links) {
      const copy = document.createElement('a'); copy.href = link.href; copy.textContent = link.textContent;
      for (const attr of ['title', 'aria-label']) if (link.hasAttribute(attr)) copy.setAttribute(attr, link.getAttribute(attr));
      safe.append(copy);
    }
    return { url: location.href, title: document.title, count: links.length, unique: new Set(links.map(a => a.href)).size, sample: links.slice(0, 3).map(a => ({ href: a.href, text: a.textContent, classes: a.className, parentTag: a.parentElement?.tagName, parentClass: a.parentElement?.className })), html: safe.outerHTML };
  }, serverId);
  await mkdir('artifacts/recon', { recursive: true });
  await writeFile('artifacts/recon/server-navigation.capture.html', result.html);
  delete result.html;
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
