import type { PanelId } from "../contracts/common";
import type { ServiceMap } from "../contracts/services";

export class ModuleUnavailableError extends Error {
    readonly code = "MODULE_UNAVAILABLE";

    constructor(readonly requested: keyof ServiceMap | PanelId, readonly reason: string) {
        super(reason);
        this.name = "ModuleUnavailableError";
    }
}
