import { addIcon, removeIcon, setIcon as setObsidianIcon, type Plugin } from "obsidian";
import assets from "patchwork:icons";

const registered = new Set<string>();
const failed = new Set<string>();

/** Namespaced per plugin: never replace Obsidian or another plugin's icons. */
export function iconName(name: string): string {
    const key = name.replace(/^lucide-/, "");
    const source = assets[key];
    if (!source || failed.has(key)) return name;
    const id = `patchwork-${__PATCHWORK_PLUGIN_ID__}-${key}`;
    if (registered.has(id)) return id;
    const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
    const svg = parsed.documentElement;
    const unsafe = [...svg.querySelectorAll("*"), svg].some(element =>
        /^(script|foreignObject|iframe|image|use|style)$/i.test(element.localName)
        || [...element.attributes].some(attr => !attr.name.startsWith("xmlns") && (/^on/i.test(attr.name)
            || /href$/i.test(attr.name) || /(?:javascript:|https?:|data:|@import|url\(\s*[^#])/i.test(attr.value))));
    const box = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
    if (parsed.querySelector("parsererror") || svg.localName !== "svg" || box.length !== 4
        || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0 || unsafe) {
        failed.add(key);
        console.warn(`Invalid Patchwork icon: ${key}`);
        return name;
    }
    // Normalize to Obsidian's 100 x 100 canvas without nested SVG elements:
    // existing button size rules must not shrink an inner SVG a second time.
    const group = parsed.createElementNS("http://www.w3.org/2000/svg", "g");
    const scale = Math.min(100 / box[2], 100 / box[3]);
    group.setAttribute("transform", `matrix(${scale} 0 0 ${scale} ${(100 - box[2] * scale) / 2 - box[0] * scale} ${(100 - box[3] * scale) / 2 - box[1] * scale})`);
    const content = parsed.createElementNS("http://www.w3.org/2000/svg", "g");
    for (const attr of [...svg.attributes]) {
        if (!["xmlns", "viewBox", "width", "height", "class"].includes(attr.name)) content.setAttribute(attr.name, attr.value);
    }
    while (svg.firstChild) content.append(svg.firstChild);
    group.append(content);
    addIcon(id, new XMLSerializer().serializeToString(group));
    registered.add(id);
    return id;
}

export function setIcon(element: HTMLElement, name: string): void {
    setObsidianIcon(element, iconName(name));
}

export function installIcons(plugin: Plugin): void {
    plugin.register(() => {
        for (const id of registered) removeIcon(id);
        registered.clear();
        failed.clear();
    });
}
