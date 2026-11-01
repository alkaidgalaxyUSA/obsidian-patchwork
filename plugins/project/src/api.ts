import type { ProjectApi } from "../../contracts/project";
import type { ProjectRuntime } from "./runtime";

export function createProjectApi(runtime: ProjectRuntime): ProjectApi {
    return {
        version: 1,
        reveal: (path, context) => runtime.reveal(path, context),
        getSelection: context => runtime.getSelection(context),
        onSelection: listener => runtime.onSelection(listener),
        registerFileMenu: contribution => runtime.menus.register(contribution),
    };
}
