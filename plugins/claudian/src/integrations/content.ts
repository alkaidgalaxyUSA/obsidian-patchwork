import type { App } from "obsidian";
import { getServiceRegistry } from "../../../utils/service-registry";

/** Optional Content service; native plain-Markdown fallback stays local. */
export function contentService(app: App) { return getServiceRegistry(app).get("content"); }
