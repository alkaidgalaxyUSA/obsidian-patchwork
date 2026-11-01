import { addIcon, removeIcon, setIcon as setObsidianIcon, type Plugin } from "obsidian";
import assets from "patchwork:icons";
import type { ModuleId } from "../contracts/common";

const registered = new Set<string>();
const failed = new Set<string>();

/** Namespaced per plugin: never replace Obsidian or another plugin's icons. */
export function iconName(name: string, owner?: ModuleId): string {
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
    // Adapt the source viewBox to Obsidian's registry canvas, preserving its
    // padding, geometry and strokes. Components own only the rendered CSS size.
    const group = parsed.createElementNS("http://www.w3.org/2000/svg", "g");
    if (owner) group.setAttribute("data-pw-icon-owner", owner);
    const scale = Math.min(100 / box[2], 100 / box[3]);
    group.setAttribute("transform", `matrix(${scale} 0 0 ${scale} ${(100 - box[2] * scale) / 2 - box[0] * scale} ${(100 - box[3] * scale) / 2 - box[1] * scale})`);
    const content = parsed.createElementNS("http://www.w3.org/2000/svg", "g");
    // Restore SVG defaults inside the host icon, whose theme may supply a stroke.
    // In particular, filled assets must not inherit an unintended outline.
    content.setAttribute("fill", "black");
    content.setAttribute("stroke", "none");
    content.setAttribute("stroke-width", "1");
    content.setAttribute("stroke-linecap", "butt");
    content.setAttribute("stroke-linejoin", "miter");
    for (const attr of [...svg.attributes]) {
        if (!["xmlns", "viewBox", "width", "height", "class"].includes(attr.name)) content.setAttribute(attr.name, attr.value);
    }
    while (svg.firstChild) content.append(svg.firstChild);
    group.append(content);
    addIcon(id, new XMLSerializer().serializeToString(group));
    registered.add(id);
    return id;
}

export function setIcon(element: HTMLElement, name: string, owner?: ModuleId): void {
    setObsidianIcon(element, iconName(name, owner));
    if (owner) element.querySelector("svg")?.setAttribute("data-pw-icon-owner", owner);
}

export function installIcons(plugin: Plugin): void {
    plugin.register(() => {
        for (const id of registered) removeIcon(id);
        registered.clear();
        failed.clear();
    });
}

/** Ownership metadata only; source geometry, paint and installed namespace stay intact. */
export function createModuleIcons(owner: ModuleId) {
    return {
        iconName: (name: string) => iconName(name, owner),
        setIcon: (element: HTMLElement, name: string) => setIcon(element, name, owner),
        installIcons,
    };
}
