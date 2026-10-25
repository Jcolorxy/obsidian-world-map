import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const stub = `export class Plugin { constructor(app, manifest) { this.app = app; this.manifest = manifest; } async loadData() { return null; } async saveData() {} }
export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } update() { this.updates = (this.updates ?? 0) + 1; } }
export class Notice {} export class TFile {} export class TFolder {} export class TAbstractFile {} export class WorkspaceLeaf {}
export class Modal { constructor(app) { this.app = app; } open() { (globalThis.opened ??= []).push(this.constructor.name); } close() {} }
export class FuzzySuggestModal extends Modal { setPlaceholder() {} } export class ItemView {} export class Setting {} export class Menu {}
export function addIcon() {}
export function setIcon() {}`;
const out = await build({ stdin: { contents: `export { default as WorldMap } from "./src/main"; export { WorldMapSettingTab } from "./src/settings";`, resolveDir: ".", loader: "ts" },
	bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
	plugins: [{ name: "obsidian", setup(b) {
		b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
		b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: stub, loader: "js" }));
	} }] });
const { WorldMap, WorldMapSettingTab } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

async function setup() {
	const app = { workspace: { getLeavesOfType: () => [] } };
	const p = new WorldMap(app, { id: "map", name: "World Map" });
	await p.loadState(null);
	p.loadGeography();
	p.data.visits = {
		392: { id: "392", name: "Japan", years: [2024], note: "Spring", updated: 1 },
		352: { id: "352", name: "Iceland", years: [2026], note: null, updated: 1 },
	};
	return { p, tab: new WorldMapSettingTab(app, p) };
}

test("settings are declared: controls read the plugin's settings and save through it", async () => {
	const { p, tab } = await setup();
	const [prefs, list, summary] = tab.getSettingDefinitions();
	assert.deepEqual(prefs.items.map((d) => d.control.key), ["projection", "shadeByRecency", "labels"]);
	for (const d of prefs.items) assert.equal(tab.getControlValue(d.control.key), p.data.settings[d.control.key]);
	await tab.setControlValue("labels", true);
	assert.equal(p.data.settings.labels, true);
	assert.equal(list.type, "list");
	assert.deepEqual(list.items.map((d) => d.name), ["Iceland", "Japan"], "countries in name order");
	assert.match(list.items[1].desc, /2024 · Spring/);
	assert.match(summary.items[0].desc, /^2 countries/);
});

test("deleting a country from the list removes that visit and refreshes the page", async () => {
	const { p, tab } = await setup();
	const [, list] = tab.getSettingDefinitions();
	list.onDelete(0);
	await new Promise((r) => setTimeout(r, 0));
	assert.deepEqual(Object.keys(p.data.visits), ["392"], "Iceland (first in the list) removed");
	assert.equal(tab.updates, 1);
});

test("the add button opens the country picker", async () => {
	const { tab } = await setup();
	globalThis.opened = [];
	tab.getSettingDefinitions()[1].addItem.action();
	assert.deepEqual(globalThis.opened, ["CountryPickerModal"]);
});
