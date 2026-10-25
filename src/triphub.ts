import { setIcon } from "obsidian";
import type WorldMapPlugin from "./main";
import { TRIP_STATUS_LABEL, Trip, tripDates, tripStatus } from "./types";

/** A trip's complete note collection, independent of the card's short preview. */
export function renderTripHub(parent: HTMLElement, plugin: WorldMapPlugin, trip: Trip,
	query: string, onQuery: (value: string) => void, onBack: () => void, onEdit: () => void) {
	const hub = parent.createDiv({ cls: "world-map-trip-hub" });
	hub.createEl("button", { text: "← All trips" }).addEventListener("click", onBack);
	hub.createEl("h3", { text: trip.title });
	hub.createDiv({ cls: "world-map-trip-meta", text: `${tripDates(trip)} · ${TRIP_STATUS_LABEL[tripStatus(trip)]}` });
	hub.createDiv({ cls: "world-map-trip-meta", text: trip.countries.map((id) => plugin.countries.find((c) => c.id === id)?.name ?? id).join(" · ") });
	hub.createEl("button", { text: "Edit trip / manage notes" }).addEventListener("click", onEdit);
	const search = hub.createEl("input", { type: "search", placeholder: "Find a linked note…", attr: { "aria-label": "Find a linked note" } });
	search.value = query;
	const count = hub.createDiv({ cls: "world-map-trip-meta", attr: { "aria-live": "polite" } });
	const list = hub.createDiv({ cls: "world-map-hub-notes" });
	const renderNotes = () => {
		list.empty();
		const paths = [...new Set(trip.notes)].sort((a, b) => a.localeCompare(b));
		const matching = paths.filter((path) => path.toLowerCase().includes(search.value.trim().toLowerCase()));
		count.setText(`${matching.length} of ${paths.length} linked notes`);
		if (!matching.length) list.createDiv({ cls: "world-map-empty", text: paths.length ? "No linked notes match your search." : "No notes linked yet. Use “Edit trip / manage notes” to add notes or a whole folder." });
		for (const path of matching) {
			const row = list.createEl("button", { cls: "world-map-hub-note", attr: { title: path, "aria-label": `Open ${path} in a new tab` } });
			setIcon(row.createSpan({ cls: "world-map-icon" }), "file-text");
			const label = row.createDiv();
			label.createDiv({ text: path.split("/").pop()!.replace(/\.md$/, "") });
			label.createDiv({ cls: "world-map-hub-note-path", text: path });
			row.addEventListener("click", () => void plugin.openNote(path, true));
		}
	};
	search.addEventListener("input", () => { onQuery(search.value); renderNotes(); });
	renderNotes();
}
