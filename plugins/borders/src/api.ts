import type { BordersApi } from "../../contracts/borders";
import { BordersRuntime } from "./runtime";

export function createBordersApi(runtime: BordersRuntime): BordersApi {
    return {
        version: 1,
        progress: {
            version: 1,
            start: options => runtime.startProgress(options),
            getTasks: context => runtime.progress.getTasks(context),
            subscribe: (context, listener) => runtime.progress.subscribe(context, listener),
        },
        registerPanel: definition => runtime.registerPanel(definition),
        registerHeader: contribution => runtime.registerHeader(contribution),
        registerSettings: contribution => runtime.registerSettings(contribution),
        registerTabActions: contribution => runtime.registerTabActions(contribution),
        openPanel: (id, options) => runtime.openPanel(id, options),
        togglePanel: (id, options) => runtime.togglePanel(id, options),
        hidePanel: (id, context) => runtime.hidePanel(id, context),
        getPanelState: (id, context) => runtime.getPanelState(id, context),
        onPanelState: listener => runtime.onPanelState(listener),
    };
}
