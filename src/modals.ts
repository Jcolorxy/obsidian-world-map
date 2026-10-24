import { App, FuzzySuggestModal, Modal, Notice, Setting, TAbstractFile, TFile, TFolder } from "obsidian";
import { Country, searchCountries } from "./geo";
import { TRIP_STATUS_LABEL, Trip, TripStatus, Visit, formatYears, thisYear, tripDates, tripStatus } from "./types";
import type WorldMapPlugin from "./main";

/** Pick any country by name — the reliable way to add somewhere tiny to click. */
export class CountryPickerModal extends FuzzySuggestModal<Country> {
	constructor(app: App, private countries: Country[], private onPick: (country: Country) => void, placeholder = "Which country?") {
		super(app);
		this.setPlaceholder(placeholder);
	}
	getItems(): Country[] {
		return this.countries;
	}
	getItemText(country: Country): string {
		return [country.name, country.region, country.alpha2, country.alias !== country.name ? country.alias : ""].filter(Boolean).join(" · ");
	}
	onChooseItem(country: Country) {
		this.onPick(country);
	}
}

/** Add or edit the years for one country. */
export class VisitModal extends Modal {
	private years: number[];
	private note: string;

	constructor(app: App, private plugin: WorldMapPlugin, private country: Country, private onDone?: () => void) {
		super(app);
		const existing: Visit | undefined = plugin.data.visits[country.id];
		this.years = existing ? [...existing.years] : [];
		this.note = existing?.note ?? "";
	}

	onOpen() {
		this.draw();
	}

	private draw() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("world-map-visit");
		contentEl.createEl("h3", { text: this.country.name });
		if (this.country.region) {
			contentEl.createDiv({ cls: "setting-item-description", text: [this.country.region, this.country.subRegion].filter(Boolean).join(" · ") });
		}

		const trips = this.plugin.tripsFor(this.country.id);
		if (trips.length) {
			const box = contentEl.createDiv({ cls: "world-map-visit-trips" });
			for (const trip of trips) {
				const row = box.createDiv({ cls: "world-map-trip-note" });
				row.createSpan({ text: `${trip.title} · ${tripDates(trip)} · ${TRIP_STATUS_LABEL[tripStatus(trip)]}` });
				for (const path of trip.notes.slice(0, 3)) {
					const note = box.createDiv({ cls: "world-map-trip-notelink" });
					note.setText("↳ " + path.split("/").pop()!.replace(/\.md$/, ""));
					note.addEventListener("click", () => { void this.plugin.openNote(path); this.close(); });
				}
			}
		}
		new Setting(contentEl).addButton((b) => b.setButtonText(trips.length ? "Add another trip here" : "Add a trip here").onClick(() => {
			this.close();
			new TripModal(this.app, this.plugin, null, this.onDone, this.country.id).open();
		}));

		const list = contentEl.createDiv({ cls: "world-map-years" });
		if (!this.years.length) list.createSpan({ cls: "world-map-years-empty", text: "No years yet." });
		for (const year of [...this.years].sort((a, b) => a - b)) {
			const chip = list.createSpan({ cls: "world-map-year" });
			chip.createSpan({ text: String(year) });
			const remove = chip.createEl("button", { text: "×", attr: { "aria-label": `Remove ${year}` } });
			remove.addEventListener("click", () => {
				this.years = this.years.filter((y) => y !== year);
				this.draw();
			});
		}

		let pending = "";
		new Setting(contentEl)
			.setName("Add a year")
			.setDesc("The year you went. Add as many as you like.")
			.addText((t) => {
				t.inputEl.type = "number";
				t.inputEl.min = "1900";
				t.inputEl.max = String(thisYear() + 5);
				t.setPlaceholder(String(thisYear())).onChange((v) => (pending = v));
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key !== "Enter") return;
					e.preventDefault();
					this.addYear(pending || String(thisYear()));
				});
				setTimeout(() => t.inputEl.focus(), 0);
			})
			.addButton((b) => b.setButtonText("Add").onClick(() => this.addYear(pending || String(thisYear()))));

		const quick = contentEl.createDiv({ cls: "world-map-quick" });
		for (const offset of [0, 1, 2, 3]) {
			const year = thisYear() - offset;
			if (this.years.includes(year)) continue;
			const b = quick.createEl("button", { text: String(year) });
			b.addEventListener("click", () => this.addYear(String(year)));
		}

		new Setting(contentEl).setName("Note").addText((t) =>
			t.setPlaceholder("Optional — who with, highlights…").setValue(this.note).onChange((v) => (this.note = v)),
		);

		const footer = new Setting(contentEl);
		if (this.plugin.data.visits[this.country.id]) {
			footer.addExtraButton((b) =>
				b.setIcon("trash").setTooltip("Remove this country").onClick(async () => {
					await this.plugin.removeVisit(this.country.id);
					this.onDone?.();
					this.close();
				}),
			);
		}
		footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		footer.addButton((b) =>
			b.setButtonText("Save").setCta().onClick(async () => {
				if (!this.years.length) {
					new Notice("Add at least one year, or remove the country.");
					return;
				}
				await this.plugin.setVisit(this.country, this.years, this.note.trim() || null);
				this.onDone?.();
				this.close();
			}),
		);
		contentEl.createDiv({ cls: "setting-item-description", text: this.years.length ? `Saving: ${formatYears(this.years)}` : "" });
	}

	private addYear(raw: string) {
		const year = Math.round(Number(raw));
		if (!year || year < 1900 || year > thisYear() + 5) {
			new Notice("That does not look like a year.");
			return;
		}
		if (!this.years.includes(year)) this.years.push(year);
		this.draw();
	}

	onClose() {
		this.contentEl.empty();
	}
}

export { searchCountries };

/** Pick a note in the vault. */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private exclude: Set<string>, private onPick: (file: TFile) => void) {
		super(app);
		this.setPlaceholder("Link a note to this trip…");
	}
	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter((f) => !this.exclude.has(f.path)).sort((a, b) => b.stat.mtime - a.stat.mtime);
	}
	getItemText(file: TFile): string {
		return file.path.replace(/\.md$/, "");
	}
	onChooseItem(file: TFile) {
		this.onPick(file);
	}
}

/** Pick a folder in the vault. */
export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
	constructor(app: App, private onPick: (folder: TFolder) => void, placeholder = "Which folder?") {
		super(app);
		this.setPlaceholder(placeholder);
	}
	getItems(): TFolder[] {
		const out: TFolder[] = [];
		const walk = (f: TAbstractFile) => {
			if (f instanceof TFolder) { if (f.path && f.path !== "/") out.push(f); f.children.forEach(walk); }
		};
		walk(this.app.vault.getRoot());
		return out.sort((a, b) => a.path.localeCompare(b.path));
	}
	getItemText(folder: TFolder): string {
		return folder.path;
	}
	onChooseItem(folder: TFolder) {
		this.onPick(folder);
	}
}

/** A date field that only commits a finished date (typing a year passes through 0002, 0020…). */
function bindDate(input: HTMLInputElement, initial: string | null, commit: (v: string | null) => void) {
	input.type = "date";
	input.value = initial ?? "";
	let last = input.value;
	const done = () => {
		const v = input.value;
		if (v === last) return;
		const year = Number(v.slice(0, 4));
		if (v && (year < 1900 || year > 2100)) { new Notice("That date doesn't look finished — check the year."); input.value = last; return; }
		last = v;
		commit(v || null);
	};
	input.addEventListener("blur", done);
	input.addEventListener("keydown", (e) => { if (e.key === "Enter") done(); });
}

/** Create or edit a trip: where, when, and the notes that go with it. */
export class TripModal extends Modal {
	private trip: Trip;

	constructor(app: App, private plugin: WorldMapPlugin, existing: Trip | null, private onDone?: () => void, presetCountry?: string) {
		super(app);
		this.trip = existing
			? { ...existing, countries: [...existing.countries], notes: [...existing.notes] }
			: { id: plugin.newTripId(), title: "", countries: presetCountry ? [presetCountry] : [], start: null, end: null,
				year: thisYear(), status: null, notes: [], updated: Date.now() };
	}

	onOpen() {
		this.draw();
	}

	private draw() {
		const { contentEl } = this;
		const t = this.trip;
		contentEl.empty();
		contentEl.addClass("world-map-trip-editor");
		contentEl.createEl("h3", { text: t.title || "New trip" });

		new Setting(contentEl).setName("Name").addText((x) => {
			x.setPlaceholder("e.g. Japan 2026").setValue(t.title).onChange((v) => (t.title = v));
			setTimeout(() => { if (!t.title) x.inputEl.focus(); }, 0);
		});

		// countries, as removable chips
		const where = new Setting(contentEl).setName("Countries");
		const chips = where.controlEl.createDiv({ cls: "world-map-chips" });
		for (const id of t.countries) {
			const c = this.plugin.countries.find((x) => x.id === id);
			const chip = chips.createSpan({ cls: "world-map-year" });
			chip.createSpan({ text: c?.name ?? id });
			chip.createEl("button", { text: "×", attr: { "aria-label": "Remove" } }).addEventListener("click", () => {
				t.countries = t.countries.filter((x) => x !== id);
				this.draw();
			});
		}
		where.addButton((b) => b.setButtonText("Add country").onClick(() =>
			new CountryPickerModal(this.app, this.plugin.countries.filter((c) => !t.countries.includes(c.id)), (c) => { t.countries.push(c.id); this.draw(); }).open()));

		new Setting(contentEl).setName("Dates").setDesc("Leave blank if you only know the year.")
			.addText((x) => { x.inputEl.title = "Start"; bindDate(x.inputEl, t.start, (v) => { t.start = v; this.draw(); }); })
			.addText((x) => { x.inputEl.title = "End"; bindDate(x.inputEl, t.end, (v) => { t.end = v; this.draw(); }); });
		if (!t.start && !t.end) {
			new Setting(contentEl).setName("Year").addText((x) => {
				x.inputEl.type = "number";
				x.setValue(t.year ? String(t.year) : "").onChange((v) => (t.year = v ? Math.round(Number(v)) || null : null));
			});
		}

		new Setting(contentEl).setName("Status")
			.setDesc(t.status ? "Set by hand." : `Worked out from the dates: ${TRIP_STATUS_LABEL[tripStatus(t)]}.`)
			.addDropdown((d) => {
				d.addOption("", "From the dates");
				for (const [k, label] of Object.entries(TRIP_STATUS_LABEL)) d.addOption(k, label);
				d.setValue(t.status ?? "").onChange((v) => { t.status = (v || null) as TripStatus | null; this.draw(); });
			});

		// linked notes
		new Setting(contentEl).setName("Notes").setHeading();
		const list = contentEl.createDiv({ cls: "world-map-trip-notes" });
		if (!t.notes.length) list.createDiv({ cls: "world-map-empty", text: "No notes linked yet — itinerary, bookings, journal…" });
		for (const path of t.notes) {
			const row = list.createDiv({ cls: "world-map-trip-note" });
			row.createSpan({ text: path.replace(/\.md$/, "") });
			row.createEl("button", { text: "×", attr: { "aria-label": "Unlink" } }).addEventListener("click", () => {
				t.notes = t.notes.filter((p) => p !== path);
				this.draw();
			});
		}
		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Link a note").onClick(() =>
				new NotePickerModal(this.app, new Set(t.notes), (f) => { t.notes.push(f.path); this.draw(); }).open()))
			.addButton((b) => b.setButtonText("Link a whole folder").onClick(() =>
				new FolderPickerModal(this.app, (folder) => {
					const add: string[] = [];
					const walk = (f: TAbstractFile) => {
						if (f instanceof TFile && f.extension === "md" && !t.notes.includes(f.path)) add.push(f.path);
						else if (f instanceof TFolder) f.children.forEach(walk);
					};
					walk(folder);
					t.notes.push(...add.sort());
					new Notice(`Linked ${add.length} note${add.length === 1 ? "" : "s"} from ${folder.path}`);
					this.draw();
				}, "Link every note in…").open()));

		const footer = new Setting(contentEl);
		if (this.plugin.data.trips.some((x) => x.id === t.id)) {
			footer.addExtraButton((b) => b.setIcon("trash").setTooltip("Delete this trip").onClick(async () => {
				await this.plugin.removeTrip(t.id);
				this.onDone?.();
				this.close();
			}));
		}
		footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		footer.addButton((b) => b.setButtonText("Save").setCta().onClick(async () => {
			if (!t.title.trim()) { new Notice("Give the trip a name."); return; }
			if (!t.countries.length) { new Notice("Add at least one country."); return; }
			t.title = t.title.trim();
			await this.plugin.saveTrip(t);
			this.onDone?.();
			this.close();
		}));
		contentEl.createDiv({ cls: "setting-item-description", text: tripDates(t) });
	}

	onClose() {
		this.contentEl.empty();
	}
}
