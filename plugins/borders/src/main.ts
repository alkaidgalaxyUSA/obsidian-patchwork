import { Plugin } from "obsidian";
import { getServiceRegistry } from "../../utils/service-registry";
import { installIcons } from "./utils/icons";
import { BordersRuntime } from "./runtime";
import { createBordersApi } from "./api";
import { BordersSettings } from "./settings";

export default class BordersPlugin extends Plugin {
    async onload(): Promise<void> {
        installIcons(this);
        const settings = new BordersSettings(this);
        await settings.load();
        const runtime = new BordersRuntime(this, settings);
        this.register(() => runtime.dispose());
        this.register(() => { void settings.flush().catch(error => console.error("Could not flush Borders geometry.", error)); });
        const registration = getServiceRegistry(this.app).register("borders", "borders", createBordersApi(runtime));
        this.register(() => registration.dispose());
    }
}
