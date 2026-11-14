import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deliberately fictional identities and media paths. Never read a live capture
// here: the complete public fixture set must be reproducible from this source.
export function syntheticFixtures() {
  const serverId = '1111111111111111111', mainId = '2222222222222222222', pagesId = '3333333333333333333', emptyId = '4444444444444444444';
  const date = '2026-01-01T12:34:56.123456';
  const media = (index, first = false) => {
    const hash = first ? 'a'.repeat(64) : BigInt(index + 256).toString(16).padStart(64, '0');
    return { name: first ? 'bird_01.png' : `fixture_${String(index).padStart(3, '0')}.png`, path: `/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.png` };
  };
  let ordinal = 0;
  const main = Array.from({ length: 32 }, (_, index) => ({
    id: (BigInt(mainId) + BigInt(index)).toString(), server: serverId, channel: mainId, published: date, content: '',
    attachments: Array.from({ length: index < 25 ? 2 : 1 }, () => { const n = ordinal++; return media(n, n === 0); })
  }));
  const paged = Array.from({ length: 209 }, (_, index) => ({
    id: (BigInt(pagesId) + BigInt(index)).toString(), server: serverId, channel: pagesId, published: date,
    content: index === 0 ? 'Synthetic pagination fixture' : '', attachments: index < 162 ? [media(index + 1000)] : []
  }));
  const channels = Array.from({ length: 65 }, (_, index) => ({
    id: [mainId, pagesId, emptyId][index] || (5555555555555555500n + BigInt(index)).toString(), server_id: serverId,
    name: index === 0 ? 'Main images' : index === 1 ? 'Multi-page channel' : index === 2 ? 'Empty channel' : `Fixture channel ${index + 1}`,
    parent_channel_id: index > 2 && index % 3 === 0 ? mainId : null,
    type: index > 2 && index % 3 === 0 ? 11 : 0, position: index, post_count: index === 0 ? 31 : index === 1 ? 208 : 0
  }));
  const server = { id: serverId, name: 'Fixture server', channels };
  const fixtures = new Map();
  const json = (name, value) => fixtures.set(name, JSON.stringify(value, null, 2) + '\n');
  for (const [channel, pages] of [[mainId, [main, [], []]], [pagesId, [paged.slice(0, 150), paged.slice(150), []]], [emptyId, [[], [], []]]]) {
    pages.forEach((page, index) => json(`channel-${channel}-${index * 150}.synthetic.json`, page));
  }
  json('server.synthetic.json', server);
  json('post-10001.synthetic.json', { id: '10001', user: '20001', service: 'fanbox', title: 'Main file with no attachments', content: '', published: '2026-01-01T12:34:56', file: { name: 'fixture-image.jpeg', node: 2, path: `/bb/bb/${'b'.repeat(64)}.jpeg` }, attachments: [], has_full: true, detail_fetched: true });
  fixtures.set('server-navigation.synthetic.html', '<nav>' + channels.map(channel => `<a href="https://kemono.cr/discord/server/${serverId}/${channel.id}">${channel.name}</a>`).join('') + '</nav>\n');
  fixtures.set('channel.synthetic.html', main.map(message => `<article id="message-${message.id}">` + message.attachments.map(attachment => `<a href="https://n3.kemono.cr/data${attachment.path}"><img src="https://img.kemono.cr/thumbnail/data${attachment.path}"></a>`).join('') + '</article>').join('\n') + '\n');
  return fixtures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../tests/fixtures/', import.meta.url)), check = process.argv.includes('--check');
  for (const [name, contents] of syntheticFixtures()) {
    const target = resolve(root, name); if (!target.startsWith(resolve(root) + sep)) throw new Error('Fixture target escaped its directory.');
    if (check) {
      if (await readFile(target, 'utf8') !== contents) throw new Error('Synthetic fixture differs from its generator: ' + name);
    } else await writeFile(target, contents);
  }
  console.log(`${check ? 'Verified' : 'Generated'} ${syntheticFixtures().size} fully synthetic metadata/HTML fixtures.`);
}
