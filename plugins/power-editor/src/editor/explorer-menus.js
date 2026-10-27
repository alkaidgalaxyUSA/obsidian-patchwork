import { Menu, Modal, Notice, TFolder, normalizePath } from "obsidian";
import { setIcon, iconName } from "../../../utils/icons";

const FORMATS = [
    ["md", "Markdown", "file-text", "#6cb6ff"],
    ["canvas", "Canvas", "layout-dashboard", "#bf9aff"],
    ["sql", "SQL", "database", "#6cb6ff"],
    ["ps1", "PowerShell", "terminal", "#65baff"],
    ["txt", "Plain text", "file-text", "#abb4c0"],
    ["js", "JavaScript", "file-code", "#e7c85d"],
    ["ts", "TypeScript", "file-code", "#6caaf0"],
    ["jsx", "React JSX", "file-code", "#67d7ed"],
    ["tsx", "React TSX", "file-code", "#67d7ed"],
    ["py", "Python", "file-code", "#e7c85d"],
    ["java", "Java", "coffee", "#e6a16d"],
    ["json", "JSON", "braces", "#e7c85d"],
    ["yaml", "YAML", "list-tree", "#c29af0"],
    ["yml", "YAML", "list-tree", "#c29af0"],
    ["xml", "XML", "code", "#e6a16d"],
    ["html", "HTML", "code", "#ee956e"],
    ["htm", "HTML", "code", "#ee956e"],
    ["css", "CSS", "palette", "#6caaf0"],
    ["scss", "SCSS", "palette", "#cd96ba"],
    ["sass", "Sass", "palette", "#cd96ba"],
    ["less", "Less", "palette", "#6caaf0"],
    ["svg", "SVG", "image", "#e7b65d"],
];
const SCRIPT_EXTENSIONS = new Set(["sh", "bash", "zsh", "fish", "bat", "cmd"]);
const CONFIG_EXTENSIONS = new Set(["toml", "ini", "env", "conf", "gitignore", "dockerfile", "makefile"]);
const LANGUAGE_NAMES = { rb: "Ruby", go: "Go", rs: "Rust", c: "C", cpp: "C++", h: "C header", cs: "C#", php: "PHP", swift: "Swift", kt: "Kotlin", scala: "Scala", lua: "Lua", pl: "Perl", r: "R", m: "Objective-C", mm: "Objective-C++", sh: "Shell", bash: "Bash", zsh: "Zsh", fish: "Fish", bat: "Batch", cmd: "Command script", graphql: "GraphQL", log: "Log", dockerfile: "Dockerfile", makefile: "Makefile", gitignore: "Git ignore" };

export function creationFormats(app) {
    const registered = app.viewRegistry.typeByExtension;
    const extensions = new Set(["md", "canvas", "svg", ...Object.keys(registered).filter((ext) => registered[ext] === "code-editor")]);
    const known = new Map(FORMATS.map((format) => [format[0], format]));
    return [...FORMATS.filter(([ext]) => extensions.has(ext)), ...[...extensions].filter((ext) => !known.has(ext)).sort().map((ext) => {
        const icon = SCRIPT_EXTENSIONS.has(ext) ? "terminal" : CONFIG_EXTENSIONS.has(ext) ? "settings-2" : "file-code";
        const color = SCRIPT_EXTENSIONS.has(ext) ? "#65baff" : CONFIG_EXTENSIONS.has(ext) ? "#aeb8c7" : "#a8cfa0";
        return [ext, LANGUAGE_NAMES[ext] ?? ext.toUpperCase(), icon, color];
    })];
}

function initialContent(extension) {
    if (extension === "canvas") return '{"nodes":[],"edges":[]}\n';
    if (extension === "json") return "{}\n";
    if (extension === "svg") return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"></svg>\n';
    return "";
}

export function showCreateDialog(app, view, extension, label) {
    const modal = new Modal(app);
    const activeFile = app.workspace.getActiveFile() ?? app.workspace.getMostRecentLeaf()?.view.file;
    const folder = app.fileManager.getNewFileParent(activeFile?.path ?? "");
    modal.setTitle(`New ${label}`);
    const form = modal.contentEl.createEl("form", { cls: "pw-explorer-create-form" });
    form.createEl("label", { text: "Name" });
    const input = form.createEl("input", { type: "text", value: extension ? `Untitled.${extension}` : "Untitled folder", attr: { "aria-label": "Name", autocomplete: "off" } });
    form.createEl("small", { text: `Location: ${folder.path || "/"}` });
    const submit = form.createEl("button", { text: "Create", cls: "mod-cta", type: "submit" });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (submit.disabled) return;
        let name = input.value.trim();
        if (!name || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
            new Notice("Enter a valid file or folder name."); return;
        }
        if (extension && !name.toLowerCase().endsWith(`.${extension}`)) name += `.${extension}`;
        const path = normalizePath(`${folder.parent ? `${folder.path}/` : ""}${name}`);
        if (app.vault.getAbstractFileByPath(path)) { new Notice("A file or folder with this name already exists."); return; }
        submit.disabled = true;
        try {
            if (extension === "canvas" && !app.internalPlugins.plugins.canvas?.enabled) {
                await app.internalPlugins.plugins.canvas?.enable(true);
                if (!app.internalPlugins.plugins.canvas?.enabled) throw new Error("The Canvas core plugin is unavailable.");
            }
            const file = extension ? await app.vault.create(path, initialContent(extension)) : await app.vault.createFolder(path);
            modal.close();
            if (file instanceof TFolder) { view.sort(); view.revealInFolder(file); }
            else await app.workspace.getLeaf("tab").openFile(file);
        } catch (error) { new Notice(`Could not create ${label}: ${error.message}`); }
        finally { submit.disabled = false; }
    });
    modal.open();
    input.focus();
    input.setSelectionRange(0, extension ? input.value.length - extension.length - 1 : input.value.length);
    return modal;
}

export function createDocumentMenu(app, view, onCreate) {
    const menu = new Menu();
    menu.dom.classList.add("pw-explorer-create-menu");
    const search = menu.dom.createDiv({ cls: "pw-explorer-menu-search" });
    menu.dom.insertBefore(search, menu.dom.querySelector(".menu-scroll"));
    setIcon(search.createSpan(), "search");
    search.createEl("input", { type: "search", attr: { placeholder: "Search types (preview)", "aria-label": "Search types (preview only)", "aria-disabled": "true", readonly: "", tabindex: "-1" } });
    const add = (title, icon, color, action) => menu.addItem((item) => {
        item.setTitle(title).setIcon(iconName(icon)).onClick(action);
        item.dom.querySelector(".menu-item-icon")?.style.setProperty("color", color);
    });
    add("New folder", "folder-plus", "#e7c15d", () => onCreate("", "folder"));
    menu.addSeparator();
    for (const [ext, label, icon, color] of creationFormats(app)) add(`New ${label} (.${ext})`, icon, color, () => onCreate(ext, label));
    for (const [id, label, icon, color] of [
        ["obsidian-excalidraw-plugin:excalidraw-autocreate-newtab", "New Excalidraw drawing", "pencil", "#bf9aff"],
        ["meld-encrypt:create-new-note", "New encrypted note (.mdenc)", "lock", "#e7b65d"],
    ]) {
        if (app.commands.commands[id]) add(label, icon, color, () => app.commands.executeCommandById(id));
    }
    return menu;
}

export function createExplorerMenu(plugin, view, update) {
    const menu = new Menu();
    menu.addItem((item) => {
        item.setTitle("Sort order").setIcon("arrow-up-down");
        const submenu = item.setSubmenu();
        for (const [order, title] of [["alphabetical", "Name (A–Z)"], ["alphabeticalReverse", "Name (Z–A)"], ["byModifiedTime", "Modified (newest first)"], ["byModifiedTimeReverse", "Modified (oldest first)"], ["byCreatedTime", "Created (newest first)"], ["byCreatedTimeReverse", "Created (oldest first)"]]) {
            submenu.addItem((option) => option.setTitle(title).setChecked(view.sortOrder === order).onClick(() => view.setSortOrder(order)));
        }
    });
    menu.addItem((item) => {
        item.setTitle("Grouping").setIcon("folders");
        const submenu = item.setSubmenu();
        for (const [value, title] of [[false, "Folders first"], [true, "Files first"]]) submenu.addItem((option) => option.setTitle(title).setChecked(!!plugin.settings.explorerFilesFirst === value).onClick(() => update("explorerFilesFirst", value)));
    });
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Compact rows").setIcon("list").setChecked(!!plugin.settings.explorerCompact).onClick(() => update("explorerCompact", !plugin.settings.explorerCompact)));
    menu.addItem((item) => item.setTitle("Auto-select opened file").setIcon("locate-fixed").setChecked(view.autoRevealFile).onClick(() => { view.setAutoReveal(!view.autoRevealFile); plugin.app.workspace.requestSaveLayout(); }));
    menu.addItem((item) => item.setTitle("Show unsupported files").setIcon("files").setChecked(!!plugin.app.vault.getConfig("showUnsupportedFiles")).onClick(() => plugin.app.vault.setConfig("showUnsupportedFiles", !plugin.app.vault.getConfig("showUnsupportedFiles"))));
    return menu;
}
