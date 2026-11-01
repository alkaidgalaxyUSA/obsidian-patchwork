import type { App } from "obsidian";
import { getServiceRegistry } from "../../../utils/service-registry";

/** Availability-aware service lookup; no Code Editor implementation access. */
export function codeDocuments(app: App) { return getServiceRegistry(app).get("codeDocument"); }
