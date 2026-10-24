import { App, PluginSettingTab, Setting } from "obsidian";
import type WorldMapPlugin from "./main";
import { formatYears } from "./types";

export class WorldMapSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: WorldMapPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const { settings } = this.plugin.data;

		new Setting(containerEl)
			.setName("Default view")
			.setDesc("Which way the map opens.")
			.addDropdown((d) =>
				d.addOption("globe", "Globe").addOption("flat", "Flat map").setValue(settings.projection).onChange((v) =>
					void this.plugin.setSettings({ projection: v as "globe" | "flat" }),
				),
			);
		new Setting(containerEl)
			.setName("Shade by recency")
			.setDesc("Recent visits are drawn darker than older ones.")
			.addToggle((t) => t.setValue(settings.shadeByRecency).onChange((v) => void this.plugin.setSettings({ shadeByRecency: v })));
		new Setting(containerEl)
			.setName("Country labels")
			.setDesc("Write the name across each country you have visited.")
			.addToggle((t) => t.setValue(settings.labels).onChange((v) => void this.plugin.setSettings({ labels: v })));

		new Setting(containerEl).setName("Your countries").setHeading();
		const stats = this.plugin.stats();
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: stats.countries
				? `${stats.countries} countries · ${stats.trips} trips · ${stats.firstYear}–${stats.lastYear}`
				: "Nothing recorded yet.",
		});
		for (const visit of this.plugin.visitsList()) {
			new Setting(containerEl)
				.setName(visit.name)
				.setDesc(formatYears(visit.years) + (visit.note ? ` · ${visit.note}` : ""))
				.addExtraButton((b) =>
					b.setIcon("trash").setTooltip("Remove").onClick(async () => { await this.plugin.removeVisit(visit.id); this.display(); }),
				);
		}
	}
}
