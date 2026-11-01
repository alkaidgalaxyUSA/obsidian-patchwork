import type { CallContext } from "./common";

export interface TerminalOpenRequest extends CallContext {
    cwd?: string; newTab?: boolean; focus?: boolean;
}
export interface TerminalApi {
    readonly version: 1;
    open(request: TerminalOpenRequest): Promise<void>;
}
