import { Plugin } from "obsidian";
import { getServiceRegistry } from "../../utils/service-registry";
import { installIcons } from "./utils/icons";
import { ProjectSettings, type ProjectPreferences } from "./settings";
import { ProjectRuntime } from "./runtime";
import { createProjectApi } from "./api";

export default class ProjectPlugin extends Plugin {
    settings!: ProjectPreferences;
    private store!: ProjectSettings;

    async onload(): Promise<void> {
        installIcons(this);
        this.store = new ProjectSettings(this);
        this.settings = await this.store.load();
        const runtime = new ProjectRuntime(this);
        this.register(() => runtime.dispose());
        this.register(() => { void this.store.flush().catch(error => console.error("Could not flush Project settings.", error)); });
        const registration = getServiceRegistry(this.app).register("project", "project", createProjectApi(runtime));
        this.register(() => registration.dispose());
        runtime.install();
    }

    persistSettings(): Promise<void> { return this.store.save(this.settings); }

    async onExternalSettingsChange(): Promise<void> {
        Object.assign(this.settings, await this.store.load());
        this.app.workspace.trigger("layout-change");
    }
}
