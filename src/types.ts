export interface Visit {
	/** Country id (ISO numeric, or a slug for places without a code). */
	id: string;
	/** Name as it was when recorded, so data survives a geodata update. */
	name: string;
	/** Years visited, ascending. */
	years: number[];
	note: string | null;
	updated: number;
}

/** A trip: one or more countries, optional dates, and the notes written for it. */
export interface Trip {
	id: string;
	title: string;
	/** Country ids, in the order travelled. */
	countries: string[];
	/** YYYY-MM-DD; either may be missing for a trip you only know the year of. */
	start: string | null;
	end: string | null;
	/** Year when the exact dates aren't known. */
	year: number | null;
	/** Set by hand; null means "work it out from the dates". */
	status: TripStatus | null;
	/** Vault paths of notes linked to the trip. */
	notes: string[];
	updated: number;
}

export type TripStatus = "planned" | "current" | "done";

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = { planned: "Planned", current: "Travelling now", done: "Done" };

export type Projection = "globe" | "flat";

export interface MapSettings {
	projection: Projection;
	/** Shade countries by how recently they were visited. */
	shadeByRecency: boolean;
	/** Show a label on each visited country. */
	labels: boolean;
}

export const SCHEMA_VERSION = 1;

export interface MapData {
	version: number;
	visits: Record<string, Visit>;
	trips: Trip[];
	settings: MapSettings;
}

export const DEFAULT_DATA: MapData = {
	version: SCHEMA_VERSION,
	visits: {},
	trips: [],
	settings: { projection: "globe", shadeByRecency: true, labels: false },
};

export const thisYear = () => new Date().getFullYear();

/** Most recent year across every visit, used for the recency ramp. */
export function latestYear(visit: Visit): number | null {
	return visit.years.length ? Math.max(...visit.years) : null;
}

export function formatYears(years: number[]): string {
	if (!years.length) return "visited";
	const sorted = [...years].sort((a, b) => a - b);
	// collapse runs: 2018, 2019, 2020 -> 2018–2020
	const runs: string[] = [];
	let start = sorted[0];
	let prev = sorted[0];
	for (const y of sorted.slice(1)) {
		if (y === prev + 1) { prev = y; continue; }
		runs.push(start === prev ? `${start}` : `${start}–${prev}`);
		start = prev = y;
	}
	runs.push(start === prev ? `${start}` : `${start}–${prev}`);
	return runs.join(", ");
}

export const todayISO = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Where a trip stands today. A status set by hand wins; otherwise the dates decide,
 * and failing those the year (this year counts as current, later years as planned).
 */
export function tripStatus(t: Trip, today = todayISO()): TripStatus {
	if (t.status) return t.status;
	if (t.start && t.start > today) return "planned";
	if (t.end && t.end < today) return "done";
	if (t.start && t.start <= today && (!t.end || t.end >= today)) return "current";
	const year = tripYear(t);
	const now = Number(today.slice(0, 4));
	if (year === null) return "planned";
	return year > now ? "planned" : year < now ? "done" : "current";
}

export function tripYear(t: Trip): number | null {
	if (t.start) return Number(t.start.slice(0, 4));
	if (t.end) return Number(t.end.slice(0, 4));
	return t.year;
}

/** "12/03/26 – 26/03/26", "from 12/03/26", or just the year. */
export function tripDates(t: Trip): string {
	const f = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
	if (t.start && t.end) return `${f(t.start)} – ${f(t.end)}`;
	if (t.start) return `from ${f(t.start)}`;
	if (t.end) return `until ${f(t.end)}`;
	return t.year ? String(t.year) : "no dates yet";
}

/** "Japan 2026" → { name: "Japan", year: 2026 }, for creating trips from travel folders. */
export function parseTripFolder(folderName: string): { name: string; year: number } | null {
	const m = /^(.*?)[\s_-]+((?:19|20)\d{2})$/.exec(folderName.trim());
	return m ? { name: m[1].trim(), year: Number(m[2]) } : null;
}
