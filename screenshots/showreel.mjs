// Records docs/showreel.gif: the plugin's real map view, driven with a mouse and
// keyboard, on the same invented demo data as the screenshots.
// Usage: node screenshots/showreel.mjs (runs shoot.mjs first; needs Chromium and ffmpeg).
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startReel } from "./reel.mjs";

const here = dirname(fileURLToPath(import.meta.url));
execFileSync("node", [join(here, "shoot.mjs")], { stdio: "ignore" });
const scene = (name) => `file://${join(here, "out", `${name}.html`)}`;

const reel = await startReel({ width: 1360, height: 860, workDir: join(here, "out", "reel-frames") });
const { page } = reel;

/** Centre of the first element matching `selector` whose text includes `text`. */
async function byText(selector, text) {
	const p = await page.evaluate((sel, t) => {
		const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t));
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	}, selector, text);
	if (!p) throw new Error(`no ${selector} containing "${text}"`);
	return p;
}

/** Wheel-zoom in steps, a frame per step. */
async function zoom(at, steps, delta) {
	await reel.moveTo(at.x, at.y, { ms: 500 });
	for (let i = 0; i < steps; i++) {
		await page.mouse.wheel({ deltaY: delta });
		await reel.settle(40);
		await reel.hold(70);
	}
}

// ---- the globe ----
await reel.open(scene("globe"));
await reel.caption("Every country you've been to, shaded by how recently you went");
await reel.hold(1800);
await reel.moveTo(534, 241, { ms: 700 });
await reel.hold(1300);
await reel.caption("Drag to spin the globe");
// a spinning globe changes every pixel, so drags are recorded at a lower frame rate
await reel.drag({ x: 760, y: 470 }, { x: 330, y: 430 }, { ms: 1400, fps: 12 });
await reel.hold(900);
await reel.drag({ x: 330, y: 430 }, { x: 900, y: 470 }, { ms: 1400, fps: 12 });
await reel.hold(700);

// ---- the flat map ----
await reel.caption("Or as a flat map, with labels one click away");
await reel.click(await byText(".world-map-modes button", "Map"), { after: 1000 });
await reel.click(await byText(".world-map-check", "Labels"), { after: 1600 });
await reel.caption("Scroll to zoom, drag to pan — planned trips are outlined");
// the map zooms about its centre (off West Africa), so zoom, then pan Europe into view
await zoom({ x: 540, y: 470 }, 4, -120);
await reel.drag({ x: 400, y: 250 }, { x: 403, y: 385 }, { ms: 1000, fps: 12 });
await reel.hold(1600);
await reel.click(await byText("button", "Reset view"), { after: 900 });

// ---- trips ----
await reel.caption("Trips link to the notes you wrote along the way");
const trip = await byText(".world-map-trip-title", "Japan in spring");
await reel.moveTo(trip.x, trip.y, { ms: 700 });
await reel.hold(1200);
const note = await byText(".world-map-trip-notelink", "Kyoto walks");
await reel.moveTo(note.x, note.y, { ms: 500 });
await reel.caption("Click a note to open it");
await reel.hold(1800);

const out = join(here, "..", "docs", "showreel.gif");
// the globe's shading compresses far better with ordered dithering
const { frames, seconds } = await reel.finish(out, { scale: 960, colors: 128, dither: "bayer:bayer_scale=5" });
console.log(`docs/showreel.gif — ${frames} frames, ${seconds}s, ${(statSync(out).size / 1e6).toFixed(1)} MB`);
