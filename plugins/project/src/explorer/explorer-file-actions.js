import { findInFiles, openFileRecovery } from "../integrations/native-core";
import { getServiceRegistry } from "../../../utils/service-registry";
import { getWindowContext } from "../../../utils/windows";
import { Notice, Platform, TFile, TFolder } from "obsidian";
import { ModuleUnavailableError } from "../../../utils/module-errors";
import { createDocumentMenu, createMarkdown, showCreateDialog } from "./explorer-menus";
import { ExplorerFileClipboard } from "./explorer-file-clipboard";
import { chooseExplorerFile, showExplorerComparison, showExplorerReplace } from "./explorer-file-dialogs";
import { scopeModule } from "../../../utils/module-scope";
import { useAdaptiveMenuPosition } from "../utils/menu-position";

async function reloadExplorerFileFromDisk(app, file) {
    const views = [];
    app.workspace.iterateAllLeaves(leaf => { if (leaf.view.file === file) views.push(leaf.view); });
    if (views.some(view => view.saving || view.isSavingInProgress)) {
        throw new Error("The file is being saved. Try again when saving finishes.");
    }
    // Preserve unsaved plaintext before replacing it with the disk version.
    for (const view of views) {
        if (!view.dirty || !["markdown", "code-editor"].includes(view.getViewType())) continue;
        await app.fileManager.storeTextFileBackup(file.path, view.getViewData());
    }
    if (!views.length) {
        const type = app.viewRegistry.typeByExtension[file.extension];
        if (type === "markdown" || type === "code-editor") await app.vault.read(file);
        else await app.vault.readBinary(file);
        return;
    }
    for (const view of views) {
        if (view.file !== file) continue;
        if (view.saving || view.isSavingInProgress) throw new Error("The file is being saved. Try again when saving finishes.");
        if (["markdown", "code-editor"].includes(view.getViewType()) && typeof view.loadFileInternal === "function") {
            await view.loadFileInternal(file, true);
            view.dirty = false;
            view.saveAgain = false;
        } else await view.onLoadFile(file);
    }
}

/** Assemble the requested explorer menu groups from native and contributed actions. */
export function installExplorerFileMenus(plugin, contributions) {
    const { app } = plugin;
    let disposed = false;
    const menus = new Set();
    const clipboard = new ExplorerFileClipboard(app);
    const dialogs = new Set();
    const track = dialog => {
        dialogs.add(dialog);
        const close = dialog.onClose.bind(dialog);
        dialog.onClose = () => { dialogs.delete(dialog); close(); };
        return dialog;
    };
    plugin.register(() => {
        disposed = true;
        for (const menu of menus) menu.hide(); menus.clear();
        for (const dialog of dialogs) dialog.close(); dialogs.clear();
    });
    const running = new Set();
    const run = async (file, action) => {
        if (running.has(file)) return;
        running.add(file);
        try { await action(); }
        catch (error) { new Notice(error.message ?? "Could not complete the file action."); }
        finally { running.delete(file); }
    };
    const install = (menu, files, source) => {
        if (disposed || source !== "file-explorer-context-menu") return;
        const reposition = useAdaptiveMenuPosition(menu);
        menus.add(menu); menu.onHide(() => menus.delete(menu));
        const file = files[0];
        if (!file) return;
        const folder = file instanceof TFolder ? file : file.parent;
        const explorer = app.workspace.getLeavesOfType("file-explorer")[0]?.view;
        const copyText = text => app.workspace.containerEl.ownerDocument.defaultView.navigator.clipboard.writeText(text);
        const native = [...menu.items];
        const titleOf = item => item.titleEl?.textContent?.trim().toLowerCase() ?? "";
        const findNative = pattern => native.find(item => pattern.test(titleOf(item)));
        const rename = findNative(/^rename/);
        const remove = findNative(/^(delete|move to trash)/);
        const bookmark = native.filter(item => /bookmark/.test(titleOf(item)));
        const managed = /^(new |cut$|copy$|paste$|copy path|copy obsidian|copy link|make a copy|duplicate|rename|delete|move to trash|show in system|open in default|open in new|open to the right|bookmark)/;
        menu.items = native.filter(item => !managed.test(titleOf(item)) && !bookmark.includes(item));
        const extra = [...menu.items];
        menu.items = [];
        const action = (target, title, icon, callback, disabled = false) => target.addItem(item => item
            .setTitle(title).setIcon(icon).setDisabled(disabled).onClick(() => run(file, callback)));
        const submenu = (title, icon, build) => menu.addItem(item => {
            item.setTitle(title).setIcon(icon);
            build(item.setSubmenu());
        });
        submenu("New", "file-plus", target => createDocumentMenu(app, explorer, (extension, label) => {
            if (extension === "md") return createMarkdown(app, folder);
            track(showCreateDialog(app, explorer, extension, label, folder, extension === null));
        }, folder, target, true));
        menu.addSeparator();
        action(menu, "Cut", "scissors", () => clipboard.capture(files, true), !file.parent);
        action(menu, "Copy", "copy", () => clipboard.capture(files, false), !file.parent);
        submenu("Copy Path/Reference...", "link", target => {
            action(target, "Absolute Path", "copy", () => copyText(files.map(entry => app.vault.adapter.getFullPath(entry.path)).join("\n")), !Platform.isDesktopApp);
            action(target, "Path from Vault Root", "copy", () => copyText(files.map(entry => entry.path).join("\n")));
            action(target, "File Name", "copy", () => copyText(files.map(entry => entry.name).join("\n")));
            action(target, "Obsidian URL", "link", () => copyText(`obsidian://open?vault=${encodeURIComponent(app.vault.getName())}&file=${encodeURIComponent(file.path)}`));
            action(target, "Markdown Reference", "link", () => copyText(app.fileManager.generateMarkdownLink(file, "")), !(file instanceof TFile));
        });
        action(menu, "Paste", "clipboard-paste", () => clipboard.paste(folder), !clipboard.entries.length);
        menu.addSeparator();
        action(menu, "Find Usages", "search", () => {
            const resolved = app.metadataCache.resolvedLinks;
            const paths = new Set(files.flatMap(entry => entry instanceof TFolder
                ? app.vault.getFiles().filter(candidate => !entry.parent || candidate.path.startsWith(`${entry.path}/`)).map(candidate => candidate.path) : [entry.path]));
            const references = app.vault.getFiles().filter(candidate => Object.keys(resolved[candidate.path] ?? {}).some(path => paths.has(path)));
            track(chooseExplorerFile(app, `Usages of ${file.name} (${references.length} files)`, references,
                entry => app.workspace.getLeaf("tab").openFile(entry)));
        });
        action(menu, "Find in Files...", "search", () => findInFiles(app, file, menu.dom.ownerDocument));
        action(menu, "Replace in Files...", "replace", () => { track(showExplorerReplace(app, file)); });
        menu.addSeparator();
        if (rename) { rename.setTitle("Rename..."); menu.items.push(rename); }
        submenu("Refactor", "", target => {
            const scope = scopeModule(target.dom, "project", { surface: "refactor-menu" });
            target.onHide(() => scope.dispose());
        });
        submenu("Bookmarks", "bookmark", target => {
            if (bookmark.length) target.items.push(...bookmark);
            else action(target, "Bookmark", "bookmark", () => {}, true);
            action(target, "Show Bookmarks", "bookmark", () => app.commands.executeCommandById("bookmarks:open"), !app.internalPlugins.plugins.bookmarks?.enabled);
        });
        menu.addSeparator();
        if (remove) { remove.setTitle("Delete...").setWarning(false); menu.items.push(remove); }
        menu.addSeparator();
        submenu("Open In", "external-link", target => {
            action(target, "Explorer", "folder", () => app.showInFolder(file.path), !Platform.isDesktopApp);
            action(target, "Open in Associated Application", "external-link", () => app.openWithDefaultApp(file.path), !Platform.isDesktopApp);
            action(target, "Path Popup", "folder-tree", () => {
                const paths = []; let entry = folder;
                while (entry) { paths.push(entry); entry = entry.parent; }
                track(chooseExplorerFile(app, "Open directory", paths, async directory => {
                    await app.commands.executeCommandById("file-explorer:open");
                    explorer?.revealInFolder(directory);
                }));
            });
            action(target, "Terminal", "terminal", () => {
                const terminal = getServiceRegistry(app).get("terminal");
                if (!terminal) throw new ModuleUnavailableError("terminal", "Enable Terminal to open a directory.");
                return terminal.open({ ...getWindowContext(menu.dom.ownerDocument), cwd: app.vault.adapter.getFullPath(folder.path), focus: true });
            }, !getServiceRegistry(app).get("terminal"));
            action(target, "View in Browser", "globe", async () => {
                const { shell } = require("electron");
                const { pathToFileURL } = require("node:url");
                await shell.openExternal(pathToFileURL(app.vault.adapter.getFullPath(file.path)).href);
            }, !Platform.isDesktopApp || !(file instanceof TFile) || !["html", "htm", "svg", "pdf"].includes(file.extension));
        });
        submenu("Local History", "history", target => action(target, "Show History", "history", () => openFileRecovery(app, file.path), !(file instanceof TFile)));
        const git = extra.filter(item => titleOf(item) === "git");
        menu.items.push(...git);
        action(menu, "Reload from Disk", "refresh-cw", () => reloadExplorerFileFromDisk(app, file), !(file instanceof TFile));
        menu.addSeparator();
        action(menu, "Compare With...", "git-show-diff", () => { track(chooseExplorerFile(app, "Compare with file", app.vault.getFiles().filter(entry => entry !== file
            && ["markdown", "code-editor"].includes(app.viewRegistry.typeByExtension[entry.extension])), async other => {
            const [left, right] = await Promise.all([app.vault.read(file), app.vault.read(other)]);
            track(showExplorerComparison(app, { name: file.path, text: left }, { name: other.path, text: right }));
        })); }, !(file instanceof TFile) || !["markdown", "code-editor"].includes(app.viewRegistry.typeByExtension[file.extension]));
        const additional = extra.filter(item => !git.includes(item) && item.titleEl);
        if (additional.length) { menu.addSeparator(); menu.items.push(...additional); }
        contributions.apply(menu, files.map(entry => ({ path: entry.path, kind: entry instanceof TFolder ? "directory" : "file" })));
        // Other plugins may append Git after our event handler has returned.
        queueMicrotask(() => {
            if (disposed || !menus.has(menu)) return;
            if (!menu.items.some(item => titleOf(item) === "git")) {
                action(menu, "Git", "git-branch", () => {}, true);
            }
            const groups = [
                ["new"],
                ["cut", "copy", "copy path/reference...", "paste"],
                ["find usages", "find in files...", "replace in files..."],
                ["rename...", "refactor", "appearance"],
                ["bookmarks"],
                ["delete..."],
                ["open in"],
                ["local history", "git", "reload from disk"],
                ["compare with..."],
            ];
            const items = menu.items.filter(item => item.titleEl);
            const ordered = groups.map(titles => titles.map(title => items.find(item => titleOf(item) === title)).filter(Boolean));
            menu.items = [];
            menu.sections = [];
            for (const [index, entries] of ordered.entries()) {
                if (!entries.length) continue;
                const section = `pw-explorer-${index}`;
                menu.sections.push(section);
                for (const item of entries) { item.setSection(section); menu.items.push(item); }
            }
            const icons = new Map([["cut", "scissors"], ["copy", "copy"], ["paste", "clipboard-paste"],
                ["reload from disk", "refresh-cw"], ["compare with...", "git-show-diff"]]);
            // Keep Project presentation scoped away from contributed feature menus.
            menu.dom.classList.add("pw-explorer-context-menu");
            for (const item of menu.items) {
                if (!item.titleEl) continue;
                const title = titleOf(item);
                if (title !== "git") item.setIcon(icons.get(title) ?? "");
                if (title === "open in" && item.submenu) {
                    item.submenu.dom.classList.add("pw-explorer-context-menu");
                    for (const child of item.submenu.items) if (child.titleEl) child.setIcon(titleOf(child) === "view in browser" ? "github" : "");
                }
            }
            menu.sort();
            const positionSubmenus = target => {
                for (const item of target.items) {
                    if (!item.submenu) continue;
                    const owner = item.submenu.dom.getAttribute("data-pw-module");
                    if (!owner || owner === "project") {
                        if (!owner) {
                            const scope = scopeModule(item.submenu.dom, "project", { surface: "context-submenu" });
                            menu.onHide(() => scope.dispose());
                        }
                        item.submenu.dom.classList.add("pw-explorer-context-menu", "pw-explorer-context-submenu");
                    }
                    useAdaptiveMenuPosition(item.submenu, menu);
                    positionSubmenus(item.submenu);
                }
            };
            positionSubmenus(menu);
            reposition();
        });
    };
    plugin.registerEvent(app.workspace.on("file-menu", (menu, file, source) => install(menu, [file], source)));
    plugin.registerEvent(app.workspace.on("files-menu", install));
}
