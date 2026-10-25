// A tiny screen recorder for README showreels: drives a page with puppeteer, draws a
// cursor and captions into it (headless Chromium has no visible pointer), keeps each
// frame with how long it should stay on screen, and encodes the lot as a GIF.
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OVERLAY = `
#reel-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 22px; height: 22px;
	transform: translate(-3px, -2px); filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
#reel-cursor::after { content: ""; position: absolute; left: -9px; top: -9px; width: 40px; height: 40px; border-radius: 50%;
	background: rgba(127,109,242,.45); transform: scale(0); opacity: 0; }
#reel-cursor.is-down::after { transform: scale(1); opacity: 1; }
#reel-caption { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 2147483646; pointer-events: none;
	padding: 7px 16px; border-radius: 999px; background: rgba(20,20,24,.88); color: #fff; font: 600 15px/1.3 Inter, system-ui, sans-serif;
	box-shadow: 0 4px 18px rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.12); white-space: nowrap; }
#reel-caption:empty { display: none; }`;
const ARROW = `<svg viewBox="0 0 22 22" width="22" height="22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13.3 19.3 L10.4 12.9 L16.5 12.6 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export async function startReel({ width, height, workDir }) {
	rmSync(workDir, { recursive: true, force: true });
	mkdirSync(workDir, { recursive: true });
	const browser = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--hide-scrollbars", "--disable-gpu"] });
	const page = await browser.newPage();
	await page.setViewport({ width, height, deviceScaleFactor: 1 });
	const frames = [];
	let cursor = { x: width / 2, y: height / 2 };

	const reel = {
		page,
		/** How many frames so far, to find a moment when checking a reel. */
		get frameCount() { return frames.length; },
		/** Open a page and add the cursor and caption layers to it. */
		async open(url) {
			await page.goto(url, { waitUntil: "load" });
			await page.waitForFunction(() => document.body.dataset.ready === "1", { timeout: 10000 }).catch(() => {});
			await page.evaluate((css, arrow, at) => {
				const style = document.createElement("style");
				style.textContent = css;
				document.head.appendChild(style);
				const c = document.createElement("div");
				c.id = "reel-cursor";
				c.innerHTML = arrow;
				c.style.left = `${at.x}px`;
				c.style.top = `${at.y}px`;
				document.body.appendChild(c);
				const cap = document.createElement("div");
				cap.id = "reel-caption";
				document.body.appendChild(cap);
			}, OVERLAY, ARROW, cursor);
			await reel.settle();
		},
		async settle(ms = 120) {
			await new Promise((r) => setTimeout(r, ms));
		},
		/** Keep the current screen for `ms` milliseconds of the GIF. */
		async hold(ms) {
			// a long pause shows the page's settled state, after any debounced redraw
			if (ms >= 400) await reel.settle(250);
			const file = join(workDir, `f${String(frames.length).padStart(5, "0")}.png`);
			await page.screenshot({ path: file });
			frames.push({ file, ms });
		},
		async caption(text) {
			await page.evaluate((t) => { document.getElementById("reel-caption").textContent = t; }, text);
		},
		async box(selector) {
			const el = await page.waitForSelector(selector, { timeout: 5000 });
			const b = await el.boundingBox();
			return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
		},
		async moveTo(x, y, { ms = 600, fps = 20, drag = false } = {}) {
			const from = { ...cursor };
			const steps = Math.max(2, Math.round((ms / 1000) * fps));
			for (let i = 1; i <= steps; i++) {
				const t = ease(i / steps);
				const px = from.x + (x - from.x) * t, py = from.y + (y - from.y) * t;
				await page.mouse.move(px, py);
				cursor = { x: px, y: py };
				await page.evaluate((p) => { const c = document.getElementById("reel-cursor"); c.style.left = `${p.x}px`; c.style.top = `${p.y}px`; }, cursor);
				if (drag) await reel.settle(16);
				await reel.hold(1000 / fps);
			}
		},
		async press(down) {
			await page.evaluate((d) => document.getElementById("reel-cursor").classList.toggle("is-down", d), down);
		},
		/** Glide to an element (or point) and click it. */
		async click(target, { ms = 600, after = 500 } = {}) {
			const p = typeof target === "string" ? await reel.box(target) : target;
			await reel.moveTo(p.x, p.y, { ms });
			await reel.press(true);
			await reel.hold(90);
			await page.mouse.down();
			await page.mouse.up();
			await reel.settle(150);
			await reel.press(false);
			await reel.hold(after);
		},
		async drag(from, to, { ms = 900, fps = 20 } = {}) {
			await reel.moveTo(from.x, from.y);
			await reel.press(true);
			await page.mouse.down();
			await reel.hold(120);
			await reel.moveTo(to.x, to.y, { ms, fps, drag: true });
			await page.mouse.up();
			await reel.settle(200);
			await reel.press(false);
			await reel.hold(500);
		},
		async type(text, { perChar = 70 } = {}) {
			for (const ch of text) {
				await page.keyboard.type(ch);
				await reel.settle(20);
				await reel.hold(perChar);
			}
		},
		async key(name, after = 400) {
			await page.keyboard.press(name);
			await reel.settle(200);
			await reel.hold(after);
		},
		/** Encode every frame into a GIF, with one palette tuned to this reel. */
		async finish(outFile, { scale = width, colors = 200, dither = "sierra2_4a" } = {}) {
			await browser.close();
			const list = frames.map((f) => `file '${f.file}'\nduration ${(f.ms / 1000).toFixed(3)}`).join("\n") + `\nfile '${frames[frames.length - 1].file}'\n`;
			const listFile = join(workDir, "frames.txt");
			writeFileSync(listFile, list);
			execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
				"-vf", `scale=${scale}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=full[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`,
				"-fps_mode", "vfr", "-loop", "0", outFile]);
			const seconds = frames.reduce((s, f) => s + f.ms, 0) / 1000;
			return { frames: frames.length, seconds: Math.round(seconds * 10) / 10 };
		},
	};
	return reel;
}
