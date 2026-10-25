import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import type WorldMapPlugin from "./main";
import { CountryPickerModal, VisitModal } from "./modals";
import { formatYears } from "./types";

/**
 * Declared rather than drawn, so the settings show up in Obsidian's settings search.
 * Plain controls read and write `data.settings`; the country list re-reads the map
 * through update() after an add, edit or removal.
 */
export class WorldMapSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: WorldMapPlugin) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		return (this.plugin.data.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown) {
		await this.plugin.setSettings({ [key]: value });
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const refresh = () => this.update();
		const stats = this.plugin.stats();
		const visits = this.plugin.visitsList();
		const edit = (id: string) => {
			const country = this.plugin.countries.find((c) => c.id === id);
			if (country) new VisitModal(this.app, this.plugin, country, refresh).open();
		};

		return [
			{
				type: "group",
				items: [
					{
						name: "Default view",
						desc: "Which way the map opens.",
						control: { type: "dropdown", key: "projection", options: { globe: "Globe", flat: "Flat map" } },
					},
					{
						name: "Shade by recency",
						desc: "Recent visits are drawn darker than older ones.",
						control: { type: "toggle", key: "shadeByRecency" },
					},
					{
						name: "Country labels",
						desc: "Write the name across each country you have visited.",
						control: { type: "toggle", key: "labels" },
					},
				],
			},
			{
				type: "list",
				heading: "Your countries",
				emptyState: "Nothing recorded yet.",
				addItem: {
					name: "Add country",
					action: () => new CountryPickerModal(this.app, this.plugin.countries, (country) => new VisitModal(this.app, this.plugin, country, refresh).open()).open(),
				},
				onDelete: (i) => void this.plugin.removeVisit(visits[i].id).then(refresh),
				items: visits.map((visit) => ({
					name: visit.name,
					desc: formatYears(visit.years) + (visit.note ? ` · ${visit.note}` : ""),
					render: (setting) => {
						setting.addExtraButton((b) => b.setIcon("pencil").setTooltip("Edit years and note").onClick(() => edit(visit.id)));
					},
				})),
			},
			{
				type: "group",
				items: [
					{
						name: "Summary",
						desc: stats.countries
							? `${stats.countries} countries · ${stats.tripCount} trips · ${stats.firstYear}–${stats.lastYear}`
							: "Nothing recorded yet.",
					},
				],
			},
		];
	}
}
