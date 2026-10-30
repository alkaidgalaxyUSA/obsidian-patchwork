import { randomUUID } from "node:crypto";

/** Local file-level changelists; Git staging remains independent. */
export class Changelists {
    constructor(data) {
        this.lists = [{ id: "default", name: "Changes" }];
        for (const list of data?.lists ?? []) {
            if (typeof list.id !== "string" || typeof list.name !== "string" || !list.name.trim()) continue;
            if (list.name === "Unversioned Files") continue;
            if (list.id === "default") { this.lists[0].name = list.name; continue; }
            if (this.lists.some(existing => existing.id === list.id || existing.name === list.name)) continue;
            this.lists.push({ id: list.id, name: list.name });
        }
        this.assignments = new Map(Object.entries(data?.assignments ?? {}).filter(([, id]) => this.lists.some(list => list.id === id)));
    }

    forPath(path) { return this.assignments.get(path) ?? "default"; }

    validateName(name, id) {
        if (!name.trim() || name === "Unversioned Files" || this.lists.some(list => list.id !== id && list.name === name)) {
            throw new Error("Enter a unique changelist name.");
        }
    }

    create(name) {
        this.validateName(name);
        const list = { id: randomUUID(), name };
        this.lists.push(list);
        return list;
    }

    rename(id, name) {
        const list = this.lists.find(list => list.id === id);
        if (!list) throw new Error("The changelist no longer exists.");
        this.validateName(name, id);
        list.name = name;
    }

    move(paths, id) {
        if (!this.lists.some(list => list.id === id)) throw new Error("The changelist no longer exists.");
        for (const path of paths) {
            if (id === "default") this.assignments.delete(path);
            else this.assignments.set(path, id);
        }
    }

    serialize() { return { lists: this.lists, assignments: Object.fromEntries(this.assignments) }; }
}
