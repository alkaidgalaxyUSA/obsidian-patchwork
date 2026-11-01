import type { TerminalApi } from "../../contracts/terminal";
import type { TerminalRuntime } from "./runtime";

export function createTerminalApi(runtime: TerminalRuntime): TerminalApi {
    return { version: 1, open: request => runtime.open(request) };
}
