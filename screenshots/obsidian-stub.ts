// A stand-in for the `obsidian` module, just enough to run the plugin's real views in
// a browser for README screenshots. Not shipped; never touches a vault.
import ICONS from "lucide-icons"; // virtual module: icon name -> SVG markup

// --- Obsidian's DOM helpers ---------------------------------------------------
type O = { cls?: string | string[]; text?: string; type?: string; value?: string; placeholder?: string; attr?: Record<string, string> } | string;
function make(tag: string, o?: O): HTMLElement {
	const el = document.createElement(tag);
	if (typeof o === "string") { el.className = o; return el; }
	if (!o) return el;
	if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
	if (o.text !== undefined) el.textContent = o.text;
	if (o.type) el.setAttribute("type", o.type);
	if (o.placeholder) el.setAttribute("placeholder", o.placeholder);
	if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
	for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, String(v));
	return el;
}
const P = Element.prototype as unknown as Record<string, unknown>;
Object.assign(P, {
	createEl(this: Element, tag: string, o?: O, cb?: (el: HTMLElement) => void) { const el = make(tag, o); this.appendChild(el); cb?.(el); return el; },
	createDiv(this: Element, o?: O) { return (this as any).createEl("div", o); },
	createSpan(this: Element, o?: O) { return (this as any).createEl("span", o); },
	empty(this: Element) { this.replaceChildren(); },
	addClass(this: Element, ...c: string[]) { this.classList.add(...c); },
	removeClass(this: Element, ...c: string[]) { this.classList.remove(...c); },
	toggleClass(this: Element, c: string, on: boolean) { this.classList.toggle(c, on); },
	hasClass(this: Element, c: string) { return this.classList.contains(c); },
	setText(this: Element, t: string) { this.textContent = t; },
	setAttr(this: Element, k: string, v: string) { this.setAttribute(k, v); },
	hide(this: HTMLElement) { this.style.display = "none"; },
	show(this: HTMLElement) { this.style.display = ""; },
	find(this: Element, s: string) { return this.querySelector(s); },
	findAll(this: Element, s: string) { return Array.from(this.querySelectorAll(s)); },
	setCssStyles(this: HTMLElement, s: Record<string, string>) { Object.assign(this.style, s); },
});
(globalThis as any).createEl = make;
(globalThis as any).createDiv = (o?: O) => make("div", o);

// --- the API surface the plugin imports -----------------------------------------
export function setIcon(el: HTMLElement, name: string) {
	const svg = (ICONS as Record<string, string>)[name];
	el.innerHTML = svg ? svg.replace("<svg", '<svg class="svg-icon"') : "";
}
export const normalizePath = (p: string) => p;
export const debounce = <T extends (...a: any[]) => any>(f: T) => f;
export const Platform = { isMobile: false, isDesktop: true };
export const editorLivePreviewField = {};

class Events { on() { return {}; } off() {} trigger() {} }
export class Component { register() {} registerEvent() {} registerInterval(n: number) { return n; } load() {} unload() {} }
export class TFile { path = ""; name = ""; basename = ""; extension = "md"; stat = { mtime: 0, ctime: 0, size: 0 }; parent = null; }
export class TFolder { path = ""; name = ""; children = []; }
export class Notice { constructor(_m: string) {} }
export class Menu { addItem() { return this; } addSeparator() { return this; } showAtMouseEvent() {} }
export class SecretStorage extends Events {}
export class SecretComponent { constructor(_a: unknown, _el: HTMLElement) {} setValue() { return this; } onChange() { return this; } }
export class Modal { app: any; contentEl = make("div"); modalEl = this.contentEl; constructor(app: unknown) { this.app = app; } open() {} close() {} onOpen() {} onClose() {} }
export class FuzzySuggestModal<T> extends Modal { setPlaceholder() {} getItems(): T[] { return []; } }
export class PluginSettingTab { constructor(public app: unknown, public plugin: unknown) {} containerEl = make("div"); display() {} }
export class Setting { constructor(public containerEl: HTMLElement) {} setName() { return this; } setDesc() { return this; } setHeading() { return this; } addText() { return this; } addToggle() { return this; } addButton() { return this; } addExtraButton() { return this; } addDropdown() { return this; } addSlider() { return this; } addTextArea() { return this; } addComponent() { return this; } }
export class ItemView extends Component {
	app: any; contentEl: HTMLElement; containerEl: HTMLElement;
	constructor(public leaf: { app: unknown; host: HTMLElement }) {
		super();
		this.app = leaf.app;
		this.containerEl = leaf.host;
		this.contentEl = leaf.host.createDiv({ cls: "view-content" });
	}
}
export class Plugin extends Component {
	app: any; manifest: any; private stored: unknown = null;
	constructor(app: unknown, manifest: unknown) { super(); this.app = app; this.manifest = manifest; }
	async loadData() { return this.stored; }
	async saveData(d: unknown) { this.stored = d; }
	setStored(d: unknown) { this.stored = d; }
	addRibbonIcon() { return make("div"); } addCommand() {} addSettingTab() {} registerView() {}
	registerEditorExtension() {} registerMarkdownCodeBlockProcessor() {}
}

/** A fake app: an in-memory vault of the given files, nothing else. */
export function fakeApp(files: Record<string, string> = {}) {
	const tfile = (path: string) => Object.assign(new TFile(), { path, name: path.split("/").pop()!, basename: path.split("/").pop()!.replace(/\.md$/, ""), extension: path.split(".").pop()! });
	return {
		vault: {
			on: () => ({}),
			getAbstractFileByPath: (p: string) => (p in files ? tfile(p) : null),
			getFileByPath: (p: string) => (p in files ? tfile(p) : null),
			getMarkdownFiles: () => Object.keys(files).filter((p) => p.endsWith(".md")).map(tfile),
			getFiles: () => Object.keys(files).map(tfile),
			getRoot: () => Object.assign(new TFolder(), { path: "/", children: [] }),
			getResourcePath: (f: TFile) => files[f.path],
			cachedRead: async (f: TFile) => files[f.path] ?? "",
			read: async (f: TFile) => files[f.path] ?? "",
			process: async () => "",
			adapter: { stat: async () => null, exists: async () => false, read: async () => "{}", list: async () => ({ files: [], folders: [] }) },
		},
		workspace: { on: () => ({}), onLayoutReady: (cb: () => void) => cb(), getLeavesOfType: () => [], getActiveFile: () => null, getLeaf: () => ({ openFile: async () => {} }) },
		metadataCache: { on: () => ({}), getFirstLinkpathDest: () => null },
		fileManager: { getNewFileParent: () => ({ path: "/" }) },
		secretStorage: { getSecret: () => null },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
}
