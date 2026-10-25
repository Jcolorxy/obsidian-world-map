import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Exercise real DOM interactions using the same browser boundary as README screenshots.
test("trip hub exposes every note, searches paths, and preserves the map when opening a note", async () => {
  const code = `
    import { WorldMapView } from './src/view';
    import WorldMap from './src/main';
    import { fakeApp } from './screenshots/obsidian-stub';
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    try {
      const paths = ['Travel/Japan/Tokyo/Bookings.md', 'Travel/Japan/Kyoto/Bookings.md',
        'Travel/Japan/Flights.md', 'Travel/Japan/Itinerary.md', 'Travel/Japan/Journal.md',
        'Travel/Japan/Packing.md', 'Travel/Japan/Restaurants.md', 'Travel/Japan/Tickets.md'];
      const app = fakeApp(Object.fromEntries(paths.map(p => [p, ''])));
      const opened = [];
      app.workspace.getLeaf = mode => ({ openFile: async file => opened.push([mode, file.path]) });
      const plugin = new WorldMap(app, {});
      plugin.data = { visits: {}, trips: [{ id: 'japan', title: 'Japan 2026', countries: ['392'],
        year: 2026, start: null, end: null, status: 'done', notes: paths, updated: 0 }], settings: {} };
      plugin.countries = [{ id: '392', name: 'Japan' }];
      const host = document.getElementById('app');
      const view = new WorldMapView({ app, host }, plugin);
      const side = view.contentEl.createDiv({ cls: 'world-map-side' });
      view.renderSidebar(side);
      check(side.querySelectorAll('.world-map-trip-notelink').length === 4, 'card preview stays compact');
      side.querySelector('.world-map-open-hub').click();
      check(side.querySelectorAll('.world-map-hub-note').length === 8, 'all eight notes are accessible');
      const search = side.querySelector('input');
      search.value = 'kyoto'; search.dispatchEvent(new Event('input'));
      check(side.querySelectorAll('.world-map-hub-note').length === 1, 'folder search disambiguates duplicate names');
      side.querySelector('.world-map-hub-note').click();
      check(JSON.stringify(opened) === JSON.stringify([['tab', paths[1]]]), 'correct note opens in a new tab');
      check(side.querySelector('.world-map-trip-hub'), 'hub remains available');
      view.refreshSidebar();
      check(side.querySelector('input').value === 'kyoto', 'query survives refresh');
      const input = side.querySelector('input');
      input.value = 'nonexistent'; input.dispatchEvent(new Event('input'));
      check(side.textContent.includes('No linked notes match'), 'no-results message');
      side.querySelector('.world-map-trip-hub > button').click();
      check(side.querySelector('.world-map-trip-title'), 'back returns to trips');
      side.querySelector('.world-map-trip-title').click();
      check(side.querySelectorAll('.world-map-hub-note').length === 8, 'trip title opens complete hub');
      plugin.data.trips[0].notes = [];
      view.refreshSidebar();
      check(side.textContent.includes('No notes linked yet'), 'empty trip can be managed');
      plugin.data.trips[0].notes = paths;
      view.refreshSidebar();
      const banner = document.createElement('div'); banner.id = 'result'; banner.textContent = 'PASS'; document.body.append(banner);
    } catch (error) {
      const banner = document.createElement('div'); banner.id = 'result'; banner.textContent = 'FAIL: ' + error.stack; document.body.append(banner);
    }
  `;
  const out = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    alias: { obsidian: resolve('screenshots/obsidian-stub.ts') },
    plugins: [{ name: 'icons', setup(b) {
      b.onResolve({ filter: /^lucide-icons$/ }, () => ({ path: 'icons', namespace: 'icons' }));
      b.onLoad({ filter: /.*/, namespace: 'icons' }, () => ({ contents: 'export default {}' }));
    } }] });
  mkdirSync('test-tmp', { recursive: true });
  const html = resolve('test-tmp/trip-hub.html');
  writeFileSync(html, '<!doctype html><html><head><style>' + readFileSync('screenshots/theme.css', 'utf8') + readFileSync('styles.css', 'utf8') +
    '.world-map-side{width:340px;padding:20px;max-height:none}body{margin:0}#result{padding:20px}</style></head><body class="theme-dark"><div id="app"></div><script>' + out.outputFiles[0].text + '</script></body></html>');
  const output = execFileSync(process.env.CHROMIUM_BIN || 'chromium', ['--headless', '--no-sandbox', '--disable-gpu',
    '--no-proxy-server', '--disable-dev-shm-usage', '--user-data-dir=' + resolve('test-tmp/hub-browser'), '--dump-dom',
    '--screenshot=' + resolve('test-tmp/trip-hub.png'), '--window-size=600,1000', 'file://' + html],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
  assert.match(output, /id="result">PASS</, output.match(/id="result">([\s\S]*?)<\/div>/)?.[1] ?? output.slice(-2000));
});
