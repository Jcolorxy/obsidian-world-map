import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const stub = `export class TFile { constructor(path) { this.path = path; this.extension = path.split(".").pop(); this.name = path.split("/").pop(); } }
export class TFolder { constructor(path, children = []) { this.path = path; this.name = path.split("/").pop(); this.children = children; } }
export class TAbstractFile {} export class Plugin { constructor(app) { this.app = app; } async loadData() { return null; } async saveData() {} }
export class Notice { constructor(m) { globalThis.lastNotice = m; } }
export class Modal {} export class FuzzySuggestModal {} export class ItemView {} export class PluginSettingTab {} export class Setting {} export class Menu {}
export function addIcon() {}
export function setIcon() {} export class WorkspaceLeaf {}`;
const out = await build({ stdin: { contents: `export * from "./src/types"; export { default as WorldMap } from "./src/main"; export { TFile, TFolder } from "obsidian";`, resolveDir: ".", loader: "ts" },
	bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
	plugins: [{ name: "obsidian", setup(b) {
		b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
		b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: stub, loader: "js" }));
	} }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const trip = (o) => ({ id: "t", title: "T", countries: ["392"], start: null, end: null, year: null, status: null, notes: [], updated: 0, ...o });

test("status follows the dates, then the year, and a hand-set status wins", () => {
	const today = "2026-10-21";
	assert.equal(m.tripStatus(trip({ start: "2026-11-02", end: "2026-11-16" }), today), "planned");
	assert.equal(m.tripStatus(trip({ start: "2026-10-18", end: "2026-10-30" }), today), "current");
	assert.equal(m.tripStatus(trip({ start: "2026-03-01", end: "2026-03-14" }), today), "done");
	assert.equal(m.tripStatus(trip({ start: "2026-10-01" }), today), "current", "open-ended and started");
	assert.equal(m.tripStatus(trip({ year: 2027 }), today), "planned");
	assert.equal(m.tripStatus(trip({ year: 2024 }), today), "done");
	assert.equal(m.tripStatus(trip({ year: 2027, status: "done" }), today), "done");
});

test("travel folder names give a country name and year", () => {
	assert.deepEqual(m.parseTripFolder("Japan 2026"), { name: "Japan", year: 2026 });
	assert.deepEqual(m.parseTripFolder("New Zealand_2019"), { name: "New Zealand", year: 2019 });
	assert.equal(m.parseTripFolder("Packing lists"), null);
});

test("done and current trips count as visits; planned ones are only outlined", async () => {
	const p = new m.WorldMap({ vault: { on() {} }, workspace: {} });
	p.countries = [{ id: "392", name: "Japan", alias: "Japan" }, { id: "156", name: "China", alias: "China" }, { id: "764", name: "Thailand", alias: "Thailand" }];
	p.data = { version: 1, visits: { "764": { id: "764", name: "Thailand", years: [2008], note: null, updated: 0 } }, settings: {},
		trips: [trip({ id: "a", countries: ["392"], start: "2026-03-01", end: "2026-03-14" }), trip({ id: "b", countries: ["156"], year: 2099 })] };
	assert.deepEqual([...p.visitedIds()].sort(), ["392", "764"]);
	assert.deepEqual([...p.plannedIds()], ["156"]);
	assert.deepEqual(p.effectiveVisits()["392"].years, [2026], "a done trip adds its year");
});

test("trips are created from subfolders, linking every note inside", async () => {
	const p = new m.WorldMap({ vault: { on() {} }, workspace: {} });
	p.save = async () => {};
	p.countries = [{ id: "392", name: "Japan", alias: "Japan" }, { id: "156", name: "China", alias: "China" }];
	p.data = { version: 1, visits: {}, settings: {}, trips: [] };
	const { TFile, TFolder } = m;
	const travel = new TFolder("Travel", [
		new TFolder("Travel/Japan 2026", [new TFile("Travel/Japan 2026/Flights.md"), new TFile("Travel/Japan 2026/photo.png"), new TFolder("Travel/Japan 2026/Kyoto", [new TFile("Travel/Japan 2026/Kyoto/Hike.md")])]),
		new TFolder("Travel/China 2027", [new TFile("Travel/China 2027/Visa.md")]),
		new TFolder("Travel/Ideas", []),
	]);
	await p.tripsFromFolders(travel);
	assert.deepEqual(p.data.trips.map((t) => [t.title, t.countries[0], t.year, t.notes]), [
		["Japan 2026", "392", 2026, ["Travel/Japan 2026/Flights.md", "Travel/Japan 2026/Kyoto/Hike.md"]],
		["China 2027", "156", 2027, ["Travel/China 2027/Visa.md"]],
	]);
	assert.match(globalThis.lastNotice, /skipped Ideas/);
	await p.tripsFromFolders(travel);
	assert.equal(p.data.trips.length, 2, "running it again doesn't duplicate trips");
});
