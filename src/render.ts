import { GeoPath, GeoProjection, geoCentroid, geoContains, geoDistance, geoEqualEarth, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { Country } from "./geo";
import { Projection, Visit, latestYear } from "./types";

export interface ViewState {
	projection: Projection;
	/** Globe: [lon, lat] rotation. Flat: unused. */
	rotate: [number, number];
	/** 1 = whole world in view. */
	zoom: number;
	/** Flat map pan, in pixels at zoom 1. */
	pan: [number, number];
}

export const DEFAULT_STATE: ViewState = { projection: "globe", rotate: [-20, -25], zoom: 1, pan: [0, 0] };

/** Sequential ramp: the longer ago a visit was, the paler the country. */
const RECENCY_STEPS = ["#8fb8f0", "#6699e8", "#3f7ddc", "#2660c4", "#16439a"];

export interface Palette {
	ocean: string;
	land: string;
	landEdge: string;
	visited: string;
	visitedEdge: string;
	graticule: string;
	text: string;
	highlight: string;
}

export function recencyColour(visit: Visit, now: number, shade: boolean): string {
	if (!shade) return RECENCY_STEPS[3];
	const year = latestYear(visit);
	if (year === null) return RECENCY_STEPS[3];
	const age = now - year;
	// 0–1 years, 2–4, 5–9, 10–19, 20+
	const step = age <= 1 ? 4 : age <= 4 ? 3 : age <= 9 ? 2 : age <= 19 ? 1 : 0;
	return RECENCY_STEPS[step];
}

export const RECENCY_LEGEND: { label: string; colour: string }[] = [
	{ label: "20+ years ago", colour: RECENCY_STEPS[0] },
	{ label: "10–19", colour: RECENCY_STEPS[1] },
	{ label: "5–9", colour: RECENCY_STEPS[2] },
	{ label: "2–4", colour: RECENCY_STEPS[3] },
	{ label: "This year / last", colour: RECENCY_STEPS[4] },
];

export function makeProjection(state: ViewState, width: number, height: number): GeoProjection {
	const size = Math.min(width, height);
	if (state.projection === "globe") {
		return geoOrthographic()
			.rotate([state.rotate[0], state.rotate[1]])
			.scale((size / 2 - 4) * state.zoom)
			.translate([width / 2, height / 2])
			.clipAngle(90);
	}
	const projection = geoEqualEarth()
		.scale(((width / 6.2) * state.zoom))
		.translate([width / 2 + state.pan[0], height / 2 + state.pan[1]]);
	return projection;
}

export interface DrawOptions {
	countries: Country[];
	visits: Record<string, Visit>;
	state: ViewState;
	palette: Palette;
	now: number;
	shadeByRecency: boolean;
	labels: boolean;
	/** Country drawn with a highlight ring, e.g. the one under the pointer. */
	highlightId?: string | null;
	/** Countries only on planned trips: drawn with a dashed outline, not filled. */
	planned?: Set<string>;
}

/** Ink for planned-trip outlines: the recent end of the visited ramp, so it reads as "soon". */
export const PLANNED_COLOUR = "#8fb8f0";

/** Paints the whole map. Canvas keeps globe rotation smooth at 50m detail. */
export function draw(canvas: HTMLCanvasElement, o: DrawOptions) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	const dpr = window.devicePixelRatio || 1;
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	if (!width || !height) return;
	if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, width, height);

	const projection = makeProjection(o.state, width, height);
	const path = geoPath(projection, ctx as unknown as CanvasRenderingContext2D) as GeoPath;

	// ocean: a disc for the globe, the whole pane for the flat map
	ctx.beginPath();
	if (o.state.projection === "globe") {
		path({ type: "Sphere" });
	} else {
		ctx.rect(0, 0, width, height);
	}
	ctx.fillStyle = o.palette.ocean;
	ctx.fill();

	ctx.beginPath();
	path(geoGraticule10());
	ctx.strokeStyle = o.palette.graticule;
	ctx.lineWidth = 0.4;
	ctx.stroke();

	for (const country of o.countries) {
		const visit = o.visits[country.id];
		ctx.beginPath();
		path(country.feature);
		ctx.fillStyle = visit ? recencyColour(visit, o.now, o.shadeByRecency) : o.palette.land;
		ctx.fill();
		ctx.strokeStyle = visit ? o.palette.visitedEdge : o.palette.landEdge;
		ctx.lineWidth = visit ? 0.6 : 0.35;
		ctx.stroke();
	}

	// planned trips: a dashed outline on top, so the country is marked but not claimed
	if (o.planned?.size) {
		ctx.save();
		ctx.setLineDash([3, 2.5]);
		ctx.strokeStyle = PLANNED_COLOUR;
		ctx.lineWidth = 1.4;
		for (const country of o.countries) {
			if (!o.planned.has(country.id)) continue;
			ctx.beginPath();
			path(country.feature);
			ctx.fillStyle = "rgba(143, 184, 240, 0.14)";
			ctx.fill();
			ctx.stroke();
		}
		ctx.restore();
	}

	if (o.highlightId) {
		const country = o.countries.find((c) => c.id === o.highlightId);
		if (country) {
			ctx.beginPath();
			path(country.feature);
			ctx.strokeStyle = o.palette.highlight;
			ctx.lineWidth = 1.8;
			ctx.stroke();
		}
	}

	// outline of the globe itself, over the top so the edge stays crisp
	if (o.state.projection === "globe") {
		ctx.beginPath();
		path({ type: "Sphere" });
		ctx.strokeStyle = o.palette.landEdge;
		ctx.lineWidth = 1;
		ctx.stroke();
	}

	if (o.labels) {
		ctx.fillStyle = o.palette.text;
		ctx.font = "600 10px system-ui, sans-serif";
		ctx.textAlign = "center";
		const centre: [number, number] = [-o.state.rotate[0], -o.state.rotate[1]];
		for (const country of o.countries) {
			if (!o.visits[country.id]) continue;
			// on a globe, anything more than a quarter turn away is on the far side
			if (o.state.projection === "globe" && geoDistance(centroidOf(country), centre) > Math.PI / 2 - 0.05) continue;
			// a shape smaller than its own label just makes a mess of the map
			if (Math.abs(path.area(country.feature)) < 400) continue;
			const point = path.centroid(country.feature);
			if (!isFinite(point[0]) || !isFinite(point[1])) continue;
			ctx.fillText(country.name, point[0], point[1]);
		}
	}
}

const centroidCache = new Map<string, [number, number]>();

/** Country centre in lon/lat, cached — geoCentroid is not cheap at 50m detail. */
function centroidOf(country: Country): [number, number] {
	const hit = centroidCache.get(country.id);
	if (hit) return hit;
	const centre = geoCentroid(country.feature as never) as [number, number];
	centroidCache.set(country.id, centre);
	return centre;
}

/** Country under a pixel, or null. */
export function countryAt(
	point: [number, number],
	countries: Country[],
	state: ViewState,
	width: number,
	height: number,
): Country | null {
	const projection = makeProjection(state, width, height);
	const coords = projection.invert?.(point);
	if (!coords || !isFinite(coords[0]) || !isFinite(coords[1])) return null;
	for (const country of countries) {
		if (geoContains(country.feature as never, coords)) return country;
	}
	return null;
}
