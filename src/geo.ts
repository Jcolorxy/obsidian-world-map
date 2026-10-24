import { GeoPermissibleObjects, geoArea } from "d3-geo";
import { feature } from "topojson-client";
import META from "./country-meta.json";
import TOPOLOGY from "./countries-data.json";

export interface Country {
	/** ISO 3166-1 numeric where one exists, otherwise a slug of the name. */
	id: string;
	name: string;
	/** Continent-level region, e.g. "Europe". Empty for disputed territories. */
	region: string;
	/** Formal ISO name, so searching "Republic of Korea" still finds South Korea. */
	alias: string;
	subRegion: string;
	alpha2: string;
	feature: GeoPermissibleObjects;
}

type Meta = Record<string, [string, string, string, string]>;

/** Countries without an ISO code (Kosovo, Somaliland…) still deserve a stable key. */
const slug = (name: string) => `x-${name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "")}`;

/** How many sovereign states there are, for the "x of y" count. */
export const UN_MEMBER_COUNT = 195;

/**
 * Country shapes travel with the code. They were a separate file at first, but
 * Obsidian Sync only carries a plugin's standard files (main.js, manifest.json,
 * styles.css, data.json), so a second device had the plugin and no map. The
 * geometry is simplified to about a third of full detail to keep this sane.
 */
export function loadCountries(): Country[] {
	return parseCountries(TOPOLOGY);
}

export function parseCountries(topology: unknown): Country[] {
	const topo = topology as Parameters<typeof feature>[0] & { objects: { countries: unknown } };
	const collection = feature(topo, topo.objects.countries as never) as unknown as {
		features: { id?: string; properties: { name: string } }[];
	};
	const meta = META as unknown as Meta;
	// Natural Earth gives a country's external territories the same ISO code
	// (Australia and the Ashmore Islands both carry 036), so features are grouped by
	// code and drawn as one country rather than several.
	const grouped = new Map<string, { parts: { name: string; area: number; feature: unknown }[] }>();
	for (const f of collection.features) {
		const id = f.id ?? slug(f.properties.name);
		const entry = grouped.get(id) ?? { parts: [] };
		entry.parts.push({ name: f.properties.name, area: geoArea(f as never), feature: f });
		grouped.set(id, entry);
	}

	return [...grouped.entries()]
		.map(([id, entry]) => {
			const [alpha2 = "", region = "", subRegion = "", officialName = ""] = meta[id] ?? [];
			const shape =
				entry.parts.length === 1
					? entry.parts[0].feature
					: { type: "FeatureCollection", features: entry.parts.map((p) => p.feature) };
			// the biggest part names the country, so 036 reads "Australia" rather than
			// "Ashmore and Cartier Is." — and the map's own names beat the ISO register's
			// formal ones ("South Korea", not "Korea, Republic of")
			const mainland = entry.parts.reduce((a, b) => (b.area > a.area ? b : a));
			return {
				id,
				name: mainland.name,
				alias: officialName,
				region,
				subRegion,
				alpha2,
				feature: shape as GeoPermissibleObjects,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Loose match so "korea" finds both Koreas and "uae" finds the Emirates. */
export function searchCountries(countries: Country[], query: string): Country[] {
	const q = query.trim().toLowerCase();
	if (!q) return countries;
	return countries
		.filter(
			(c) =>
				c.name.toLowerCase().includes(q) ||
				c.alias.toLowerCase().includes(q) ||
				c.alpha2.toLowerCase() === q ||
				c.region.toLowerCase().includes(q),
		)
		.sort((a, b) => {
			const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
			const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
			return aStarts - bStarts || a.name.localeCompare(b.name);
		});
}
