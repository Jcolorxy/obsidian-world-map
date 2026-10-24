// README screenshots: the plugin's real view, rendered with invented travel data.
// Nothing here reads a vault. Run `node screenshots/shoot.mjs`.
import WorldMap from "../src/main";
import { WorldMapView } from "../src/view";
import { fakeApp } from "obsidian";

const year = new Date().getFullYear();
const iso = (offset: number) => {
	const d = new Date(Date.now() + offset * 86_400_000);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ISO numeric codes
const C = { japan: "392", vietnam: "704", thailand: "764", italy: "380", france: "250", spain: "724", portugal: "620",
	peru: "604", chile: "152", canada: "124", usa: "840", nz: "554", morocco: "504", iceland: "352", kenya: "404", tanzania: "834", mexico: "484" };

const visit = (id: string, name: string, years: number[]) => ({ id, name, years, note: null, updated: 0 });
let n = 0;
const trip = (title: string, countries: string[], o: Record<string, unknown>, notes: string[]) =>
	({ id: `trip-${++n}`, title, countries, start: null, end: null, year: null, status: null, notes, updated: 0, ...o });

const data = {
	version: 1,
	visits: {
		[C.thailand]: visit(C.thailand, "Thailand", [2012]),
		[C.canada]: visit(C.canada, "Canada", [2015]),
		[C.usa]: visit(C.usa, "United States of America", [2015, 2022]),
		[C.italy]: visit(C.italy, "Italy", [2016]),
		[C.france]: visit(C.france, "France", [2016]),
		[C.spain]: visit(C.spain, "Spain", [2016]),
		[C.morocco]: visit(C.morocco, "Morocco", [2017]),
		[C.mexico]: visit(C.mexico, "Mexico", [2019]),
		[C.nz]: visit(C.nz, "New Zealand", [2021]),
	},
	trips: [
		trip("Iceland ring road", [C.iceland], { start: iso(-4), end: iso(6) }, ["Travel/Iceland/Itinerary.md", "Travel/Iceland/Campervan booking.md", "Travel/Iceland/Packing list.md"]),
		trip("Lisbon & Porto", [C.portugal], { start: iso(24), end: iso(33) }, ["Travel/Portugal/Ideas.md", "Travel/Portugal/Flights.md"]),
		trip(`Safari ${year + 1}`, [C.kenya, C.tanzania], { year: year + 1 }, ["Travel/Safari/Research.md"]),
		trip("Japan in spring", [C.japan], { start: `${year - 2}-03-28`, end: `${year - 2}-04-12` },
			["Travel/Japan/Itinerary.md", "Travel/Japan/Kyoto walks.md", "Travel/Japan/Food list.md", "Travel/Japan/Rail pass.md", "Travel/Japan/Journal.md"]),
		trip("Vietnam north to south", [C.vietnam], { start: `${year - 3}-09-02`, end: `${year - 3}-09-20` }, ["Travel/Vietnam/Route.md", "Travel/Vietnam/Journal.md"]),
		trip("Andes", [C.peru, C.chile], { year: 2018 }, ["Travel/Andes/Inca trail.md"]),
	],
	settings: { projection: "globe", shadeByRecency: true, labels: false },
};

export async function render(scene: string) {
	const host = document.getElementById("app")!;
	// an Obsidian pane has a fixed height; without one the map stretches to the sidebar's length
	host.style.height = "100vh";
	const app = fakeApp({});
	const p = new WorldMap(app as never, { id: "world-map", version: "0.2.0" } as never) as any;
	p.data = { ...data, settings: { ...data.settings, projection: scene === "flat" ? "flat" : "globe" } };
	p.loadGeography();
	const view = new WorldMapView({ app, host } as never, p);
	await view.onOpen();
	if (scene === "globe") {
		(view as any).state.rotate = [-10, -22];
		(view as any).state.zoom = 1.05;
	}
	view.paint();
	document.body.dataset.ready = "1";
}

(window as any).renderScene = render;
