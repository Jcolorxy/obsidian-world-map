// Builds each README scene with the plugin's real views and photographs it in
// headless Chromium. Demo data only — see scenes.ts.  Usage: node screenshots/shoot.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(here, "out");
const docs = join(root, "docs");
mkdirSync(out, { recursive: true });
mkdirSync(docs, { recursive: true });

// Obsidian's icon set is Lucide; inline every icon so setIcon() draws the real glyphs.
const iconDir = join(root, "node_modules/lucide-static/icons");
const icons = Object.fromEntries(readdirSync(iconDir).filter((f) => f.endsWith(".svg"))
	.map((f) => [f.slice(0, -4), readFileSync(join(iconDir, f), "utf8").replace(/<!--[\s\S]*?-->/g, "").trim()]));

const bundle = await build({
	entryPoints: [join(here, "scenes.ts")], bundle: true, write: false, format: "iife", platform: "browser",
	target: "es2020", logLevel: "warning",
	alias: { obsidian: join(here, "obsidian-stub.ts"), },
	plugins: [{ name: "lucide", setup(b) {
		b.onResolve({ filter: /^lucide-icons$/ }, () => ({ path: "lucide-icons", namespace: "lucide" }));
		b.onLoad({ filter: /.*/, namespace: "lucide" }, () => ({ contents: `export default ${JSON.stringify(icons)};`, loader: "js" }));
	} }],
});

const theme = readFileSync(join(here, "theme.css"), "utf8");
const styles = readFileSync(join(root, "styles.css"), "utf8");
// Pin the clock to a Wednesday morning so the scenes don't depend on the day they're shot
// (at a weekend the Today view rightly hides work, which would hide most of the demo).
const FIXED_NOW = new Date(2026, 9, 21, 9, 0, 0).getTime();
const clock = `<script>(() => { const Real = Date, offset = ${FIXED_NOW} - Real.now();
  class Fixed extends Real { constructor(...a) { super(...(a.length ? a : [Real.now() + offset])); } static now() { return Real.now() + offset; } }
  globalThis.Date = Fixed; })();</script>`;
const scenes = [
	{ name: "globe", width: 1360, height: 860 },
	{ name: "flat", width: 1360, height: 820 },
];
for (const s of scenes) {
	const html = `<!doctype html><html><head><meta charset="utf-8"><style>${theme}\n${styles}</style></head>
<body class="theme-dark">${clock}<div id="app" class="workspace-leaf-content"></div>
<script>${bundle.outputFiles[0].text}</script>
<script>renderScene(${JSON.stringify(s.name)});</script></body></html>`;
	const page = join(out, `${s.name}.html`);
	writeFileSync(page, html);
	execFileSync("chromium", ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
		`--window-size=${s.width},${s.height}`, "--virtual-time-budget=4000",
		`--screenshot=${join(docs, `${s.name}.png`)}`, `file://${page}`], { stdio: "ignore" });
	console.log(`docs/${s.name}.png`);
}
