import { DOCUMENT_ENCODINGS, decodeDocument, encodeDocument } from "./utils/document-encoding";
import { documentEncoding } from "./utils/document-file-info";
import { isEncryptedNote, isMarkdownView } from "../utils/markdown-views";

/** File-scoped adapter leases keep later saves in the explicitly selected encoding. */
export class DocumentEncoding {
    constructor(state) {
        this.state = state;
        this.adapter = state.app.vault.adapter;
        this.encodings = new Map();
        this.pending = new Set();
        this.writes = new Map();
        this.leases = [];
        this.storage = `${state.plugin.manifest.dir}/file-encodings.json`;
        this.originalRead = this.adapter.read.bind(this.adapter);
        this.originalWrite = this.adapter.write.bind(this.adapter);
        this.saving = Promise.resolve();
        this.ready = this.load();
        this.ready.then(() => state.schedule()).catch(error => console.error("Could not load file encodings.", error));
        this.wrap("read", original => async (path) => {
            await this.ready;
            const encoding = this.encodings.get(path);
            if (!encoding) return original.call(this.adapter, path);
            await this.writes.get(path);
            return decodeDocument(new Uint8Array(await this.adapter.readBinary(path)), encoding);
        });
        this.wrap("write", original => async (path, text, options) => {
            await this.ready;
            const encoding = this.encodings.get(path);
            if (!encoding) return original.call(this.adapter, path, text, options);
            return this.serialize(path, () => this.adapter.writeBinary(path, encodeDocument(text, encoding), options));
        });
        this.wrap("append", original => async (path, text, options) => {
            await this.ready;
            const encoding = this.encodings.get(path);
            if (!encoding) return original.call(this.adapter, path, text, options);
            return this.serialize(path, async () => {
                const current = decodeDocument(new Uint8Array(await this.adapter.readBinary(path)), encoding);
                return this.adapter.writeBinary(path, encodeDocument(current + text, encoding), options);
            });
        });
        state.plugin.registerEvent(state.app.vault.on("rename", (file, previous) => {
            for (const [path, encoding] of [...this.encodings]) {
                if (path !== previous && !path.startsWith(`${previous}/`)) continue;
                this.encodings.delete(path); this.encodings.set(file.path + path.slice(previous.length), encoding);
            }
            void this.persist().catch(error => console.error("Could not rename file encoding records.", error));
        }));
        state.plugin.registerEvent(state.app.vault.on("delete", file => {
            for (const path of this.encodings.keys()) if (path === file.path || path.startsWith(`${file.path}/`)) this.encodings.delete(path);
            void this.persist().catch(error => console.error("Could not remove file encoding records.", error));
        }));
    }

    async load() {
        if (!await this.adapter.exists(this.storage)) return;
        const data = JSON.parse(await this.originalRead(this.storage));
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid file encoding records.");
        for (const [path, encoding] of Object.entries(data)) if (DOCUMENT_ENCODINGS.includes(encoding) && encoding !== "UTF-8") this.encodings.set(path, encoding);
    }

    wrap(name, create) {
        const descriptor = Object.getOwnPropertyDescriptor(this.adapter, name);
        const wrapper = create(this.adapter[name]);
        this.adapter[name] = wrapper;
        this.leases.push({ name, descriptor, wrapper });
    }

    persist() {
        const data = JSON.stringify(Object.fromEntries(this.encodings), null, 2);
        this.saving = this.saving.catch(() => {}).then(() => this.originalWrite(this.storage, data));
        return this.saving;
    }

    serialize(path, operation) {
        const pending = (this.writes.get(path) ?? Promise.resolve()).catch(() => {}).then(operation);
        this.writes.set(path, pending);
        const release = () => { if (this.writes.get(path) === pending) this.writes.delete(path); };
        void pending.then(release, release);
        return pending;
    }

    available(leaf) {
        const info = this.state.locks.info.get(leaf.view.file.path);
        const encoding = this.encodings.get(leaf.view.file.path) ?? info?.encoding;
        return !this.disposed && !isEncryptedNote(leaf.view.file)
            && (isMarkdownView(leaf.view) || leaf.view.getViewType() === "code-editor")
            && !!info && DOCUMENT_ENCODINGS.includes(encoding)
            && (!encoding.startsWith("UTF-16") || this.encodings.has(leaf.view.file.path))
            && !this.state.locks.isLocked(leaf.view.file) && !this.pending.has(leaf.view.file.path);
    }

    async convert(location, context, encoding) {
        await this.ready;
        const leaf = this.state.leaf(location, context), file = leaf.view.file;
        if (!DOCUMENT_ENCODINGS.includes(encoding) || !this.available(leaf)) throw new Error("This document cannot change encoding right now.");
        const path = file.path;
        this.pending.add(path);
        this.state.locks.pending.add(path);
        this.state.locks.sync([...this.state.locks.views]); this.state.schedule();
        try {
            for (const view of this.state.locks.views) if (view.file === file) await this.state.locks.flush(view, file);
            this.state.leaf(location, context);
            const bytes = new Uint8Array(await this.state.app.vault.readBinary(file));
            const previous = this.encodings.get(path);
            const detected = previous ?? documentEncoding(bytes);
            if (!DOCUMENT_ENCODINGS.includes(detected)) throw new Error("The current file encoding cannot be decoded safely.");
            const text = decodeDocument(bytes, detected);
            encodeDocument(text, encoding);
            this.state.leaf(location, context);
            if (this.disposed || file.path !== path) throw new Error("The document changed during conversion.");
            const directory = `${this.state.plugin.manifest.dir}/encoding-backups`;
            if (!await this.adapter.exists(directory)) await this.adapter.mkdir(directory);
            const backup = `${directory}/${crypto.randomUUID()}`;
            await this.adapter.writeBinary(`${backup}.bin`, bytes.buffer);
            await this.originalWrite(`${backup}.json`, JSON.stringify({ path, encoding: detected, created: new Date().toISOString() }));
            if (encoding === "UTF-8") this.encodings.delete(path); else this.encodings.set(path, encoding);
            let writing = false;
            try {
                await this.persist();
                this.state.leaf(location, context);
                if (this.disposed || file.path !== path) throw new Error("The document changed during conversion.");
                const current = new Uint8Array(await this.state.app.vault.readBinary(file));
                if (current.length !== bytes.length || current.some((value, index) => value !== bytes[index])) throw new Error("The file changed on disk. Please try again.");
                writing = true;
                await this.state.app.vault.modify(file, text);
            } catch (error) {
                if (previous) this.encodings.set(path, previous); else this.encodings.delete(path);
                if (writing && file.path === path) await this.adapter.writeBinary(path, bytes.buffer);
                await this.persist(); throw error;
            }
            this.state.locks.info.delete(path);
        } finally {
            this.pending.delete(path); this.state.locks.pending.delete(path);
            if (!this.disposed) { this.state.locks.sync([...this.state.locks.views]); this.state.schedule(true); }
        }
    }

    dispose() {
        this.disposed = true;
        for (const { name, descriptor, wrapper } of this.leases.reverse()) {
            if (this.adapter[name] !== wrapper) continue;
            if (descriptor) Object.defineProperty(this.adapter, name, descriptor); else delete this.adapter[name];
        }
    }
}
