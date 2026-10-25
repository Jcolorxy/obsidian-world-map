import { Notice, Plugin, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { geoCentroid } from "d3-geo";
import { Country, UN_MEMBER_COUNT, loadCountries } from "./geo";
import { DEFAULT_DATA, MapData, MapSettings, SCHEMA_VERSION, Trip, Visit, parseTripFolder, thisYear, tripStatus } from "./types";
import { VIEW_TYPE, WorldMapView } from "./view";
import { CountryPickerModal, FolderPickerModal, TripModal, VisitModal } from "./modals";
import { WorldMapSettingTab } from "./settings";
import { renderMapBlock } from "./block";

export default class WorldMapPlugin extends Plugin {
	data: MapData = DEFAULT_DATA;
	countries: Country[] = [];
	private centroids = new Map<string, [number, number]>();

	async onload() {
		// an older copy under another id would register the same view and stop this one loading
		const older = await this.retireOlderCopies();
		await this.loadState(older);
		this.loadGeography();

		this.registerView(VIEW_TYPE, (leaf) => new WorldMapView(leaf, this));
		this.addRibbonIcon("globe", "Open world map", () => this.activateView());
		this.addCommand({ id: "open", name: "Open map", callback: () => this.activateView() });
		this.addCommand({
			id: "add-country",
			name: "Add a country you have visited",
			callback: () =>
				new CountryPickerModal(this.app, this.countries, (country) => new VisitModal(this.app, this, country).open()).open(),
		});
		this.addCommand({ id: "add-trip", name: "Add a trip", callback: () => new TripModal(this.app, this, null).open() });
		this.addCommand({
			id: "trips-from-folders",
			name: "Create trips from travel folders",
			callback: () => new FolderPickerModal(this.app, (folder) => void this.tripsFromFolders(folder), "Folder holding a subfolder per trip, e.g. Travel").open(),
		});
		this.addCommand({
			id: "insert-map",
			name: "Insert a map here",
			editorCallback: (editor) => editor.replaceSelection("```worldmap\nprojection: flat\n```\n"),
		});

		this.addSettingTab(new WorldMapSettingTab(this.app, this));
		this.registerMarkdownCodeBlockProcessor("worldmap", (source, el) => renderMapBlock(this, el, source));

		// linked notes follow renames and disappear when deleted
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => void this.onRename(file, oldPath)));
		this.registerEvent(this.app.vault.on("delete", (file) => void this.onDelete(file)));
	}

	// ---------- data ----------

	/**
	 * Switch off any other copy of this plugin installed under a different id, and
	 * return its data so a fresh install can take it over. Copies are recognised by
	 * their manifest name and data shape, not by id.
	 */
	private async retireOlderCopies(): Promise<Partial<MapData> | null> {
		const manager = (this.app as unknown as {
			plugins?: { plugins?: Record<string, unknown>; manifests?: Record<string, { name?: string; dir?: string }>;
				disablePlugin?(id: string): Promise<void>; disablePluginAndSave?(id: string): Promise<void> };
		}).plugins;
		const isMapData = (d: unknown): d is Partial<MapData> => !!d && typeof (d as MapData).visits === "object";
		let found: Partial<MapData> | null = null;

		for (const [id, p] of Object.entries(manager?.plugins ?? {})) {
			const o = p as { manifest?: { name?: string }; data?: unknown; activateView?: unknown } | null;
			if (id === this.manifest.id || o?.manifest?.name !== this.manifest.name || typeof o.activateView !== "function" || !isMapData(o.data)) continue;
			found ??= o.data;
			try {
				// saved, so the enabled list that Sync carries no longer names the older copy
				if (manager?.disablePluginAndSave) await manager.disablePluginAndSave(id);
				else await manager?.disablePlugin?.(id);
			} catch (e) {
				new Notice(`World Map: could not switch off the older copy "${id}". Disable it under Community plugins.`);
				console.error(e);
			}
		}
		if (found) return found;

		// not running: read its saved data straight from its folder
		for (const [id, m] of Object.entries(manager?.manifests ?? {})) {
			if (id === this.manifest.id || m.name !== this.manifest.name || !m.dir) continue;
			try {
				const data = JSON.parse(await this.app.vault.adapter.read(`${m.dir}/data.json`)) as unknown;
				if (isMapData(data)) return data;
			} catch {
				// no data there
			}
		}
		return null;
	}

	private async loadState(older: Partial<MapData> | null = null) {
		let stored = (await this.loadData()) as Partial<MapData> | null;
		// first run under this id: carry over the older copy's map
		const adopt = !stored && !!older;
		if (adopt) stored = older;
		this.data = {
			...DEFAULT_DATA,
			...(stored ?? {}),
			version: SCHEMA_VERSION,
			visits: { ...(stored?.visits ?? {}) },
			trips: [...(stored?.trips ?? [])],
			settings: { ...DEFAULT_DATA.settings, ...(stored?.settings ?? {}) },
		};
		for (const visit of Object.values(this.data.visits)) {
			visit.years = Array.from(new Set(visit.years ?? [])).sort((a, b) => a - b);
			visit.note ??= null;
			visit.updated ??= Date.now();
		}
		if (adopt) {
			await this.save();
			new Notice("World Map: moved your map over from the older copy.");
		}
	}

	// ---------- trips ----------

	newTripId(): string {
		return `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
	}

	tripsFor(countryId: string): Trip[] {
		return this.data.trips.filter((t) => t.countries.includes(countryId));
	}

	/** Trips newest first: travelling now, then planned (soonest first), then done (latest first). */
	sortedTrips(): Trip[] {
		const rank = { current: 0, planned: 1, done: 2 } as const;
		const key = (t: Trip) => t.start ?? (t.year ? `${t.year}-00-00` : "");
		return [...this.data.trips].sort((a, b) => {
			const sa = tripStatus(a), sb = tripStatus(b);
			if (sa !== sb) return rank[sa] - rank[sb];
			return sa === "planned" ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a));
		});
	}

	async saveTrip(trip: Trip) {
		trip.updated = Date.now();
		const at = this.data.trips.findIndex((t) => t.id === trip.id);
		if (at >= 0) this.data.trips[at] = trip;
		else this.data.trips.push(trip);
		await this.save();
	}

	async removeTrip(id: string) {
		this.data.trips = this.data.trips.filter((t) => t.id !== id);
		await this.save();
	}

	/**
	 * Countries shaded as visited: the ones recorded with years, plus every country on
	 * a trip that is done or under way. A planned trip doesn't count until you go.
	 */
	visitedIds(): Set<string> {
		const ids = new Set(Object.keys(this.data.visits));
		for (const t of this.data.trips) if (tripStatus(t) !== "planned") t.countries.forEach((c) => ids.add(c));
		return ids;
	}

	/** Countries only on planned trips — drawn as an outline on the map. */
	plannedIds(): Set<string> {
		const visited = this.visitedIds();
		const ids = new Set<string>();
		for (const t of this.data.trips) if (tripStatus(t) === "planned") t.countries.forEach((c) => { if (!visited.has(c)) ids.add(c); });
		return ids;
	}

	/** Visits for drawing: recorded visits merged with the years of done or current trips. */
	effectiveVisits(): Record<string, Visit> {
		const out: Record<string, Visit> = {};
		for (const [id, v] of Object.entries(this.data.visits)) out[id] = { ...v, years: [...v.years] };
		for (const t of this.data.trips) {
			if (tripStatus(t) === "planned") continue;
			const year = t.start ? Number(t.start.slice(0, 4)) : t.year;
			for (const id of t.countries) {
				const country = this.countries.find((c) => c.id === id);
				const v = (out[id] ??= { id, name: country?.name ?? id, years: [], note: null, updated: t.updated });
				if (year && !v.years.includes(year)) v.years = [...v.years, year].sort((a, b) => a - b);
			}
		}
		return out;
	}

	/**
	 * One trip per subfolder named like "Japan 2026": the country matched by name, the
	 * year from the folder, and every note inside linked. Existing trips are left alone.
	 */
	async tripsFromFolders(parent: TFolder) {
		let made = 0;
		const skipped: string[] = [];
		for (const child of parent.children) {
			if (!(child instanceof TFolder)) continue;
			const parsed = parseTripFolder(child.name);
			const country = parsed && this.countries.find((c) => c.name.toLowerCase() === parsed.name.toLowerCase() || c.alias.toLowerCase() === parsed.name.toLowerCase());
			if (!parsed || !country) { skipped.push(child.name); continue; }
			if (this.data.trips.some((t) => t.title === child.name)) continue;
			const notes: string[] = [];
			const walk = (f: TAbstractFile) => {
				if (f instanceof TFile && f.extension === "md") notes.push(f.path);
				else if (f instanceof TFolder) f.children.forEach(walk);
			};
			walk(child);
			this.data.trips.push({
				id: this.newTripId(), title: child.name, countries: [country.id], start: null, end: null,
				year: parsed.year, status: null, notes: notes.sort(), updated: Date.now(),
			});
			made++;
		}
		await this.save();
		new Notice(`World Map: ${made} trip${made === 1 ? "" : "s"} created${skipped.length ? `; skipped ${skipped.join(", ")} (no country/year in the name)` : ""}.`, 8000);
	}

	private async onRename(file: TAbstractFile, oldPath: string) {
		let changed = false;
		for (const t of this.data.trips) {
			const next = t.notes.map((p) => (p === oldPath ? file.path : file instanceof TFolder && p.startsWith(oldPath + "/") ? file.path + p.slice(oldPath.length) : p));
			if (next.some((p, i) => p !== t.notes[i])) { t.notes = next; changed = true; }
		}
		if (changed) await this.save();
	}

	private async onDelete(file: TAbstractFile) {
		let changed = false;
		for (const t of this.data.trips) {
			const next = t.notes.filter((p) => p !== file.path && !(file instanceof TFolder && p.startsWith(file.path + "/")));
			if (next.length !== t.notes.length) { t.notes = next; changed = true; }
		}
		if (changed) await this.save();
	}

	async openNote(path: string) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
		else new Notice(`Not found: ${path}`);
	}

	private loadGeography() {
		this.countries = loadCountries();
	}

	async save() {
		await this.saveData(this.data);
		this.refreshViews();
	}

	refreshViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof WorldMapView) leaf.view.render();
		}
	}

	// ---------- visits ----------

	async setVisit(country: Country, years: number[], note: string | null) {
		const clean = Array.from(new Set(years.filter((y) => y > 1900 && y <= thisYear() + 5))).sort((a, b) => a - b);
		if (!clean.length) return this.removeVisit(country.id);
		this.data.visits[country.id] = {
			id: country.id,
			name: country.name,
			years: clean,
			note,
			updated: Date.now(),
		};
		await this.save();
	}

	async addYear(country: Country, year: number) {
		const existing = this.data.visits[country.id];
		await this.setVisit(country, [...(existing?.years ?? []), year], existing?.note ?? null);
	}

	async removeVisit(id: string) {
		delete this.data.visits[id];
		await this.save();
	}

	async setSettings(patch: Partial<MapSettings>) {
		this.data.settings = { ...this.data.settings, ...patch };
		await this.save();
	}

	// ---------- derived ----------

	/** Visited counts per continent, busiest first. */
	byRegion(): [string, number][] {
		const counts = new Map<string, number>();
		for (const visit of Object.values(this.effectiveVisits())) {
			const country = this.countries.find((c) => c.id === visit.id);
			const region = country?.region || "Other";
			counts.set(region, (counts.get(region) ?? 0) + 1);
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	}

	stats() {
		const visits = Object.values(this.effectiveVisits());
		const years = visits.flatMap((v) => v.years);
		return {
			countries: visits.length,
			percent: Math.round((visits.length / UN_MEMBER_COUNT) * 100),
			trips: years.length,
			firstYear: years.length ? Math.min(...years) : null,
			lastYear: years.length ? Math.max(...years) : null,
			regions: this.byRegion(),
			tripCount: this.data.trips.length,
			plannedTrips: this.data.trips.filter((t) => tripStatus(t) === "planned").length,
		};
	}

	/** Country centre in lon/lat, cached. */
	centroid(country: Country): [number, number] | null {
		const hit = this.centroids.get(country.id);
		if (hit) return hit;
		const centre = geoCentroid(country.feature);
		if (!centre || !isFinite(centre[0])) return null;
		this.centroids.set(country.id, centre);
		return centre;
	}

	// ---------- view ----------

	async activateView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		let leaf: WorkspaceLeaf | null = existing[0] ?? null;
		if (!leaf) {
			leaf = this.app.workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	visitsList(): Visit[] {
		return Object.values(this.data.visits).sort((a, b) => a.name.localeCompare(b.name));
	}
}
