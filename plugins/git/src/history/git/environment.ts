/** Minimal command environment used by the imported Git capability layer. */
export interface GitCommandEnvironment {
    git(): Promise<{ binary?: { path: string; source: string }; tried: string[] }>;
    env(extra?: Record<string, string | undefined>): Promise<Record<string, string | undefined>>;
}
