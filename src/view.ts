import { ItemView, Menu, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import type WorldMapPlugin from "./main";
import { Country, UN_MEMBER_COUNT, searchCountries } from "./geo";
import { DEFAULT_STATE, Palette, RECENCY_LEGEND, ViewState, countryAt, draw } from "./render";
import { Projection, TRIP_STATUS_LABEL, Trip, Visit, formatYears, latestYear, thisYear, tripDates, tripStatus } from "./types";
import { CountryPickerModal, TripModal, VisitModal } from "./modals";

export const VIEW_TYPE = "world-map-view";

/** Reads the theme so the map sits in light or dark mode without its own switch. */
function palette(el: HTMLElement): Palette {
	const style = getComputedStyle(el);
	const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
	return {
		ocean: value("--background-secondary", "#1a1a1a"),
		land: value("--background-modifier-border", "#3a3a3a"),
		landEdge: value("--background-modifier-border-hover", "#555"),
		visited: value("--interactive-accent", "#3f7ddc"),
		visitedEdge: value("--background-secondary", "#1a1a1a"),
		graticule: value("--background-modifier-border", "#333"),
		text: value("--text-normal", "#eee"),
		highlight: value("--text-accent", "#ffcc66"),
	};
}

export class WorldMapView extends ItemView {
	private state: ViewState = { ...DEFAULT_STATE };
	private canvas!: HTMLCanvasElement;
	private tooltip!: HTMLElement;
	private hovered: Country | null = null;
	private query = "";
	private frame = 0;

	constructor(leaf: WorkspaceLeaf, private plugin: WorldMapPlugin) {
		super(leaf);
	}

	getViewType() { return VIEW_TYPE; }
	getDisplayText() { return "World map"; }
	getIcon() { return "globe"; }

	async onOpen() {
		this.state.projection = this.plugin.data.settings.projection;
		this.render();
	}

	async onClose() {
		this.contentEl.empty();
	}

	/** Full rebuild of the pane: chrome first, then the map paints itself. */
	render() {
		const el = this.contentEl;
		el.empty();
		const root = el.createDiv({ cls: "world-map" });
		this.renderToolbar(root.createDiv({ cls: "world-map-toolbar" }));

		if (!this.plugin.countries.length) {
			root.createDiv({
				cls: "world-map-empty",
				text: "Map data failed to load. Reload Obsidian, and if it persists reinstall the plugin.",
			});
			return;
		}

		const body = root.createDiv({ cls: "world-map-body" });
		const stage = body.createDiv({ cls: "world-map-stage" });
		this.canvas = stage.createEl("canvas", { cls: "world-map-canvas" });
		this.tooltip = stage.createDiv({ cls: "world-map-tip" });
		this.tooltip.hide();
		this.attachPointer();

		this.renderSidebar(body.createDiv({ cls: "world-map-side" }));
		this.renderLegend(root.createDiv({ cls: "world-map-legend" }));

		const observer = new ResizeObserver(() => this.paint());
		observer.observe(stage);
		this.register(() => observer.disconnect());
		window.requestAnimationFrame(() => this.paint());
	}

	/** Repaint only — cheap enough to call on every pointer move. */
	paint() {
		if (!this.canvas?.isConnected) return;
		draw(this.canvas, {
			countries: this.plugin.countries,
			visits: this.plugin.effectiveVisits(),
			planned: this.plugin.plannedIds(),
			state: this.state,
			palette: palette(this.contentEl),
			now: thisYear(),
			shadeByRecency: this.plugin.data.settings.shadeByRecency,
			labels: this.plugin.data.settings.labels,
			highlightId: this.hovered?.id ?? null,
		});
	}

	private schedulePaint() {
		if (this.frame) return;
		this.frame = window.requestAnimationFrame(() => { this.frame = 0; this.paint(); });
	}

	private renderToolbar(bar: HTMLElement) {
		const modes = bar.createDiv({ cls: "world-map-modes" });
		for (const mode of ["globe", "flat"] as Projection[]) {
			const b = modes.createEl("button", { text: mode === "globe" ? "Globe" : "Map" });
			b.toggleClass("is-active", this.state.projection === mode);
			b.addEventListener("click", async () => {
				this.state = { ...DEFAULT_STATE, projection: mode, rotate: this.state.rotate };
				await this.plugin.setSettings({ projection: mode });
				this.render();
			});
		}

		const add = bar.createEl("button", { cls: "mod-cta" });
		setIcon(add.createSpan({ cls: "world-map-icon" }), "plus");
		add.createSpan({ text: "Add country" });
		add.addEventListener("click", () => this.pickCountry());

		const trip = bar.createEl("button");
		setIcon(trip.createSpan({ cls: "world-map-icon" }), "luggage");
		trip.createSpan({ text: "Add trip" });
		trip.addEventListener("click", () => new TripModal(this.app, this.plugin, null, () => this.render()).open());

		const search = bar.createEl("input", { cls: "world-map-search", type: "search", placeholder: "Filter your list…" });
		search.value = this.query;
		search.addEventListener("input", () => {
			this.query = search.value;
			const side = this.contentEl.querySelector<HTMLElement>(".world-map-side");
			if (side) { side.empty(); this.renderSidebar(side); }
		});

		const shade = bar.createEl("label", { cls: "world-map-check" });
		const shadeBox = shade.createEl("input", { type: "checkbox" });
		shadeBox.checked = this.plugin.data.settings.shadeByRecency;
		shadeBox.addEventListener("change", async () => {
			await this.plugin.setSettings({ shadeByRecency: shadeBox.checked });
			this.render();
		});
		shade.createSpan({ text: "Shade by recency" });

		const labels = bar.createEl("label", { cls: "world-map-check" });
		const labelBox = labels.createEl("input", { type: "checkbox" });
		labelBox.checked = this.plugin.data.settings.labels;
		labelBox.addEventListener("change", async () => {
			await this.plugin.setSettings({ labels: labelBox.checked });
			this.paint();
		});
		labels.createSpan({ text: "Labels" });

		const reset = bar.createEl("button", { text: "Reset view" });
		reset.addEventListener("click", () => {
			this.state = { ...DEFAULT_STATE, projection: this.state.projection };
			this.paint();
		});
	}

	private renderLegend(el: HTMLElement) {
		const visited = this.plugin.visitedIds().size;
		const pct = Math.round((visited / UN_MEMBER_COUNT) * 100);
		el.createSpan({ cls: "world-map-stat", text: `${visited} of ${UN_MEMBER_COUNT} countries · ${pct}%` });
		const s = this.plugin.stats();
		if (s.tripCount) el.createSpan({ cls: "world-map-region", text: `${s.tripCount} trip${s.tripCount === 1 ? "" : "s"}${s.plannedTrips ? ` · ${s.plannedTrips} planned` : ""}` });

		const regions = this.plugin.byRegion();
		for (const [region, count] of regions) {
			el.createSpan({ cls: "world-map-region", text: `${region} ${count}` });
		}

		if (this.plugin.data.settings.shadeByRecency) {
			const ramp = el.createDiv({ cls: "world-map-ramp" });
			ramp.createSpan({ cls: "world-map-ramp-label", text: "Visited" });
			for (const step of RECENCY_LEGEND) {
				const chip = ramp.createSpan({ cls: "world-map-ramp-chip" });
				chip.style.background = step.colour;
				chip.title = step.label;
			}
			ramp.createSpan({ cls: "world-map-ramp-label", text: "more recently" });
		}
	}

	private renderSidebar(el: HTMLElement) {
		this.renderTrips(el);
		el.createDiv({ cls: "world-map-side-heading", text: "Countries" });
		const visits = Object.values(this.plugin.effectiveVisits());
		const filtered = this.query
			? visits.filter((v) => v.name.toLowerCase().includes(this.query.toLowerCase()) || String(v.years).includes(this.query))
			: visits;

		if (!visits.length) {
			el.createDiv({ cls: "world-map-empty", text: "No countries yet. Click one on the map, or use “Add country”." });
			return;
		}

		// grouped by year, newest first: the list reads like a travel history
		const byYear = new Map<number, Visit[]>();
		for (const visit of filtered) {
			for (const year of visit.years) {
				const list = byYear.get(year) ?? [];
				list.push(visit);
				byYear.set(year, list);
			}
		}
		const years = [...byYear.keys()].sort((a, b) => b - a);
		if (!years.length) {
			el.createDiv({ cls: "world-map-empty", text: "Nothing matches that filter." });
			return;
		}
		for (const year of years) {
			const group = el.createDiv({ cls: "world-map-group" });
			group.createDiv({ cls: "world-map-group-year", text: String(year) });
			for (const visit of byYear.get(year)!.sort((a, b) => a.name.localeCompare(b.name))) {
				const row = group.createDiv({ cls: "world-map-row" });
				row.createSpan({ cls: "world-map-row-name", text: visit.name });
				if (visit.years.length > 1) row.createSpan({ cls: "world-map-row-years", text: formatYears(visit.years) });
				row.addEventListener("click", () => this.focus(visit.id));
				row.addEventListener("contextmenu", (e) => {
					e.preventDefault();
					const menu = new Menu();
					menu.addItem((i) => i.setTitle("Edit years…").setIcon("pencil").onClick(() => this.edit(visit.id)));
					menu.addItem((i) => i.setTitle("Centre on map").setIcon("crosshair").onClick(() => this.focus(visit.id)));
					menu.addItem((i) =>
						i.setTitle("Remove").setIcon("trash").setWarning(true).onClick(async () => {
							await this.plugin.removeVisit(visit.id);
							this.render();
						}),
					);
					menu.showAtMouseEvent(e);
				});
			}
		}
	}

	/** Trips with their linked notes: travelling now, then planned, then done. */
	private renderTrips(el: HTMLElement) {
		const trips = this.plugin.sortedTrips().filter((t) => !this.query || t.title.toLowerCase().includes(this.query.toLowerCase()));
		const head = el.createDiv({ cls: "world-map-side-heading" });
		head.createSpan({ text: "Trips" });
		if (!trips.length) {
			el.createDiv({ cls: "world-map-empty", text: this.plugin.data.trips.length ? "No trips match." : "No trips yet — “Add trip” links a trip to its notes." });
			return;
		}
		for (const trip of trips) this.tripCard(el, trip);
	}

	private tripCard(parent: HTMLElement, trip: Trip) {
		const status = tripStatus(trip);
		const card = parent.createDiv({ cls: `world-map-trip is-${status}` });
		const top = card.createDiv({ cls: "world-map-trip-top" });
		const title = top.createSpan({ cls: "world-map-trip-title", text: trip.title });
		title.title = "Edit trip";
		title.addEventListener("click", () => new TripModal(this.app, this.plugin, trip, () => this.render()).open());
		top.createSpan({ cls: `world-map-trip-status is-${status}`, text: TRIP_STATUS_LABEL[status] });

		const meta = card.createDiv({ cls: "world-map-trip-meta" });
		meta.createSpan({ text: tripDates(trip) });
		for (const id of trip.countries) {
			const c = this.plugin.countries.find((x) => x.id === id);
			const link = meta.createSpan({ cls: "world-map-trip-country", text: c?.name ?? id });
			link.addEventListener("click", () => this.focus(id));
		}

		const notes = card.createDiv({ cls: "world-map-trip-notes-list" });
		for (const path of trip.notes.slice(0, 4)) {
			const row = notes.createDiv({ cls: "world-map-trip-notelink" });
			setIcon(row.createSpan({ cls: "world-map-icon" }), "file-text");
			row.createSpan({ text: path.split("/").pop()!.replace(/\.md$/, "") });
			row.title = path;
			row.addEventListener("click", () => void this.plugin.openNote(path));
		}
		if (trip.notes.length > 4) notes.createDiv({ cls: "world-map-row-years", text: `+ ${trip.notes.length - 4} more` });
		if (!trip.notes.length) notes.createDiv({ cls: "world-map-row-years", text: "No notes linked" });
	}

	/** Spin the globe (or pan the map) to put a country in the middle. */
	private focus(id: string) {
		const country = this.plugin.countries.find((c) => c.id === id);
		if (!country) return;
		const centre = this.plugin.centroid(country);
		if (!centre) return;
		if (this.state.projection === "globe") {
			this.state.rotate = [-centre[0], -centre[1]];
		} else {
			this.state.pan = [0, 0];
		}
		this.hovered = country;
		this.paint();
	}

	private edit(id: string) {
		const country = this.plugin.countries.find((c) => c.id === id);
		if (!country) { new Notice("That country is not on the map data."); return; }
		new VisitModal(this.app, this.plugin, country, () => this.render()).open();
	}

	private pickCountry() {
		new CountryPickerModal(this.app, this.plugin.countries, (country) => {
			new VisitModal(this.app, this.plugin, country, () => this.render()).open();
		}).open();
	}

	/** Drag to rotate or pan, wheel to zoom, click to record a visit. */
	private attachPointer() {
		const canvas = this.canvas;
		let dragging = false;
		let moved = false;
		let last: [number, number] = [0, 0];

		canvas.addEventListener("pointerdown", (e) => {
			dragging = true;
			moved = false;
			last = [e.clientX, e.clientY];
			canvas.setPointerCapture(e.pointerId);
		});

		canvas.addEventListener("pointermove", (e) => {
			const rect = canvas.getBoundingClientRect();
			if (dragging) {
				const dx = e.clientX - last[0];
				const dy = e.clientY - last[1];
				if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
				last = [e.clientX, e.clientY];
				if (this.state.projection === "globe") {
					const speed = 0.25 / this.state.zoom;
					this.state.rotate = [
						this.state.rotate[0] + dx * speed,
						Math.max(-90, Math.min(90, this.state.rotate[1] - dy * speed)),
					];
				} else {
					this.state.pan = [this.state.pan[0] + dx, this.state.pan[1] + dy];
				}
				this.tooltip.hide();
				this.schedulePaint();
				return;
			}
			const point: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
			const hit = countryAt(point, this.plugin.countries, this.state, rect.width, rect.height);
			if (hit?.id !== this.hovered?.id) {
				this.hovered = hit;
				this.schedulePaint();
			}
			if (!hit) { this.tooltip.hide(); return; }
			const visit = this.plugin.effectiveVisits()[hit.id];
			this.tooltip.setText(visit ? `${hit.name} — ${formatYears(visit.years)}${visit.note ? `\n${visit.note}` : ""}` : hit.name);
			this.tooltip.show();
			this.tooltip.style.left = `${Math.min(point[0] + 14, rect.width - 220)}px`;
			this.tooltip.style.top = `${point[1] + 16}px`;
		});

		const release = (e: PointerEvent) => {
			if (!dragging) return;
			dragging = false;
			canvas.releasePointerCapture(e.pointerId);
		};
		canvas.addEventListener("pointerup", (e) => {
			const wasDrag = moved;
			release(e);
			if (wasDrag) return;
			const rect = canvas.getBoundingClientRect();
			const hit = countryAt([e.clientX - rect.left, e.clientY - rect.top], this.plugin.countries, this.state, rect.width, rect.height);
			if (hit) new VisitModal(this.app, this.plugin, hit, () => this.render()).open();
		});
		canvas.addEventListener("pointercancel", release);
		canvas.addEventListener("pointerleave", () => { this.hovered = null; this.tooltip.hide(); this.schedulePaint(); });

		canvas.addEventListener("wheel", (e) => {
			e.preventDefault();
			const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
			this.state.zoom = Math.max(0.6, Math.min(12, this.state.zoom * factor));
			this.schedulePaint();
		}, { passive: false });
	}
}
