import type { CallContext } from "./common";

export interface ClaudianApi {
    readonly version: 1;
    open(context: CallContext): Promise<void>;
}
