import { Notice, setIcon } from "obsidian";
import type WorldMapPlugin from "./main";
import { DEFAULT_STATE, RECENCY_LEGEND, ViewState, countryAt, draw } from "./render";
import { Projection, formatYears, thisYear } from "./types";
import { UN_MEMBER_COUNT } from "./geo";
import { VisitModal } from "./modals";

interface BlockOptions {
	projection: Projection;
	height: number;
	/** Spin the globe to this [lon, lat]. */
	centre: [number, number] | null;
	zoom: number;
	stats: boolean;
	labels: boolean;
	interactive: boolean;
}

function parseBlock(source: string): BlockOptions {
	const o: BlockOptions = { projection: "flat", height: 420, centre: null, zoom: 1, stats: true, labels: false, interactive: true };
	const bool = (v: string) => /^(true|yes|1|on)$/i.test(v);
	for (const raw of source.split("\n")) {
		const line = raw.trim();
		const at = line.indexOf(":");
		if (!line || at < 0) continue;
		const key = line.slice(0, at).trim().toLowerCase();
		const value = line.slice(at + 1).trim();
		if (key === "projection" && ["globe", "flat"].includes(value)) o.projection = value as Projection;
		else if (key === "height") o.height = Math.max(200, Math.min(1200, Number(value) || 420));
		else if (key === "zoom") o.zoom = Math.max(0.6, Math.min(12, Number(value) || 1));
		else if (key === "centre" || key === "center") {
			const [lon, lat] = value.split(/[, ]+/).map(Number);
			if (isFinite(lon) && isFinite(lat)) o.centre = [lon, lat];
		} else if (key === "stats") o.stats = bool(value);
		else if (key === "labels") o.labels = bool(value);
		else if (key === "interactive") o.interactive = bool(value);
	}
	return o;
}

/** ```worldmap — the same map, embedded in a note. */
export function renderMapBlock(plugin: WorldMapPlugin, el: HTMLElement, source: string) {
	const o = parseBlock(source);
	const root = el.createDiv({ cls: "world-map world-map-embed" });
	const stage = root.createDiv({ cls: "world-map-stage" });
	stage.style.height = `${o.height}px`;
	const canvas = stage.createEl("canvas", { cls: "world-map-canvas" });
	const tip = stage.createDiv({ cls: "world-map-tip" });
	tip.hide();

	const state: ViewState = {
		...DEFAULT_STATE,
		projection: o.projection,
		zoom: o.zoom,
		rotate: o.centre ? [-o.centre[0], -o.centre[1]] : DEFAULT_STATE.rotate,
	};

	const paint = () => {
		if (!canvas.isConnected) return;
		draw(canvas, {
			countries: plugin.countries,
			visits: plugin.effectiveVisits(),
			planned: plugin.plannedIds(),
			state,
			palette: paletteOf(root),
			now: thisYear(),
			shadeByRecency: plugin.data.settings.shadeByRecency,
			labels: o.labels,
			highlightId: null,
		});
	};

	if (o.interactive) {
		let dragging = false;
		let moved = false;
		let last: [number, number] = [0, 0];
		canvas.addEventListener("pointerdown", (e) => { dragging = true; moved = false; last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
		canvas.addEventListener("pointermove", (e) => {
			const rect = canvas.getBoundingClientRect();
			if (dragging) {
				const dx = e.clientX - last[0];
				const dy = e.clientY - last[1];
				if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
				last = [e.clientX, e.clientY];
				if (state.projection === "globe") {
					state.rotate = [state.rotate[0] + dx * 0.25, Math.max(-90, Math.min(90, state.rotate[1] - dy * 0.25))];
				} else {
					state.pan = [state.pan[0] + dx, state.pan[1] + dy];
				}
				tip.hide();
				paint();
				return;
			}
			const point: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];
			const hit = countryAt(point, plugin.countries, state, rect.width, rect.height);
			if (!hit) { tip.hide(); return; }
			const visit = plugin.effectiveVisits()[hit.id];
			tip.setText(visit ? `${hit.name} — ${formatYears(visit.years)}` : hit.name);
			tip.show();
			tip.style.left = `${Math.min(point[0] + 14, rect.width - 200)}px`;
			tip.style.top = `${point[1] + 16}px`;
		});
		canvas.addEventListener("pointerup", (e) => {
			dragging = false;
			canvas.releasePointerCapture(e.pointerId);
			if (moved) return;
			const rect = canvas.getBoundingClientRect();
			const hit = countryAt([e.clientX - rect.left, e.clientY - rect.top], plugin.countries, state, rect.width, rect.height);
			if (hit) new VisitModal(plugin.app, plugin, hit, paint).open();
		});
		canvas.addEventListener("pointerleave", () => tip.hide());
		canvas.addEventListener("wheel", (e) => {
			e.preventDefault();
			state.zoom = Math.max(0.6, Math.min(12, state.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
			paint();
		}, { passive: false });
	}

	if (o.stats) {
		const bar = root.createDiv({ cls: "world-map-legend" });
		const stats = plugin.stats();
		bar.createSpan({ cls: "world-map-stat", text: `${stats.countries} of ${UN_MEMBER_COUNT} countries · ${stats.percent}%` });
		for (const [region, count] of stats.regions) bar.createSpan({ cls: "world-map-region", text: `${region} ${count}` });
		if (plugin.data.settings.shadeByRecency) {
			const ramp = bar.createDiv({ cls: "world-map-ramp" });
			ramp.createSpan({ cls: "world-map-ramp-label", text: "Visited" });
			for (const step of RECENCY_LEGEND) {
				const chip = ramp.createSpan({ cls: "world-map-ramp-chip" });
				chip.style.background = step.colour;
				chip.title = step.label;
			}
			ramp.createSpan({ cls: "world-map-ramp-label", text: "more recently" });
		}
	}

	if (!plugin.countries.length) {
		const warn = root.createDiv({ cls: "world-map-empty" });
		setIcon(warn.createSpan(), "alert-triangle");
		warn.createSpan({ text: " Map data not loaded — reload the plugin." });
		void Notice;
	}

	const observer = new ResizeObserver(() => paint());
	observer.observe(stage);
	window.requestAnimationFrame(paint);
}

function paletteOf(el: HTMLElement) {
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
