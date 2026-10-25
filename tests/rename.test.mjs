import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// A minimal Obsidian: the plugin's own data, plus a plugin manager that may hold an older copy.
const stub = `export class Plugin { constructor(app, manifest) { this.app = app; this.manifest = manifest; this.saved = null; }
	async loadData() { return this.app.ownData ?? null; } async saveData(d) { this.saved = structuredClone(d); } }
export class Notice { constructor(m) { (globalThis.notices ??= []).push(m); } }
export class TFile {} export class TFolder {} export class TAbstractFile {} export class WorkspaceLeaf {}
export class Modal {} export class FuzzySuggestModal {} export class ItemView {} export class PluginSettingTab {} export class Setting {} export class Menu {}
export function addIcon() {}
export function setIcon() {}`;
const out = await build({ stdin: { contents: `export { default as WorldMap } from "./src/main";`, resolveDir: ".", loader: "ts" },
	bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
	plugins: [{ name: "obsidian", setup(b) {
		b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
		b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: stub, loader: "js" }));
	} }] });
const { WorldMap } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const manifest = { id: "new-map", name: "World Map" };
const oldData = { visits: { 392: { id: "392", name: "Japan", years: [2024], note: null, updated: 1 } }, trips: [{ id: "t1", title: "Japan", countries: ["392"], notes: [] }], settings: {} };

function app({ running = null, onDisk = null, ownData = null } = {}) {
	const disabled = [];
	const plugins = {}, manifests = { "new-map": { name: "World Map", dir: ".obsidian/plugins/new-map" } };
	if (running) plugins["old-map"] = { manifest: { name: "World Map" }, data: running, activateView() {} };
	if (running || onDisk) manifests["old-map"] = { name: "World Map", dir: ".obsidian/plugins/old-map" };
	plugins["other"] = { manifest: { name: "Something else" }, data: { visits: {} }, activateView() {} };
	return {
		disabled, ownData, workspace: { getLeavesOfType: () => [] },
		plugins: { plugins, manifests, async disablePluginAndSave(id) { disabled.push(id); } },
		vault: { adapter: { async read(path) { if (onDisk && path === ".obsidian/plugins/old-map/data.json") return JSON.stringify(onDisk); throw new Error("missing"); } } },
	};
}

async function start(a) {
	const p = new WorldMap(a, manifest);
	const older = await p.retireOlderCopies();
	await p.loadState(older);
	return p;
}

test("a running older copy is switched off and its map carried over", async () => {
	const a = app({ running: oldData });
	const p = await start(a);
	assert.deepEqual(a.disabled, ["old-map"], "only the older World Map, never other plugins");
	assert.deepEqual(Object.keys(p.data.visits), ["392"]);
	assert.equal(p.data.trips.length, 1);
	assert.ok(p.saved, "the takeover is saved under the new id");
});

test("an installed but switched-off older copy is read from its folder", async () => {
	const a = app({ onDisk: oldData });
	const p = await start(a);
	assert.deepEqual(a.disabled, []);
	assert.equal(p.data.visits["392"].name, "Japan");
	assert.ok(p.saved);
});

test("existing data under the new id is never replaced", async () => {
	const mine = { visits: { 352: { id: "352", name: "Iceland", years: [2026], note: null, updated: 2 } }, trips: [], settings: {} };
	const a = app({ running: oldData, ownData: mine });
	const p = await start(a);
	assert.deepEqual(a.disabled, ["old-map"], "the older copy still has to stop, or its view clashes");
	assert.deepEqual(Object.keys(p.data.visits), ["352"]);
	assert.equal(p.saved, null);
});

test("no older copy: a fresh, empty map", async () => {
	const p = await start(app());
	assert.deepEqual(p.data.visits, {});
	assert.equal(p.saved, null);
});
