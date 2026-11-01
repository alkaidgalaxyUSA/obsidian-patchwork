import type { App } from "obsidian";
import type { SidebarDock, UpstreamZenController, UpstreamZenLease } from "../types";
import { upstreamZenController } from "./upstream";

/** Defer expensive upstream presentation mounting until native collapse has finished. */
export class ZenTransitions {
    private leases = new Map<UpstreamZenController, UpstreamZenLease>();
    private disposed = false;

    constructor(private readonly app: App, private readonly presentationChanged: () => void) {}

    sync(): void {
        if (this.disposed) return;
        const controllers = new Set(this.app.workspace.getLeavesOfType("claudian-view")
            .map(upstreamZenController).filter((controller): controller is UpstreamZenController => !!controller));
        for (const [controller, lease] of this.leases) if (!controllers.has(controller)) this.release(lease);
        for (const controller of controllers) {
            if (this.leases.has(controller)) continue;
            const original = controller.deps.isEnabled;
            const originalReconcile = controller.reconcile;
            const lease: UpstreamZenLease = {
                controller, original, descriptor: Object.getOwnPropertyDescriptor(controller.deps, "isEnabled"),
                originalReconcile, reconcileDescriptor: Object.getOwnPropertyDescriptor(controller, "reconcile"),
                presentation: this.app.workspace.containerEl.ownerDocument.querySelector(".claudian-container.claudian-zen"),
                reconcileWrapper: () => {
                    originalReconcile.call(controller);
                    if (!lease.enabled || this.disposed) return;
                    const presentation = this.app.workspace.containerEl.ownerDocument.querySelector(".claudian-container.claudian-zen");
                    if (presentation === lease.presentation) return;
                    lease.presentation = presentation;
                    this.presentationChanged();
                },
                enabled: true, wrapper: () => {
                    if (!lease.enabled) return original.call(controller.deps);
                    const enabled = original.call(controller.deps);
                    if (!enabled || !this.collapsing(controller)) return enabled;
                    this.wait(lease);
                    return false;
                },
            };
            controller.deps.isEnabled = lease.wrapper;
            controller.reconcile = lease.reconcileWrapper;
            this.leases.set(controller, lease);
        }
    }

    private collapsing(controller: UpstreamZenController): boolean {
        return this.app.workspace.getLeavesOfType("claudian-view").some(leaf => {
            if (upstreamZenController(leaf) !== controller) return false;
            const dock = leaf.getRoot() as SidebarDock;
            return dock.collapsed === true && dock.containerEl.isConnected && dock.containerEl.getBoundingClientRect().width > 0.5;
        });
    }

    private wait(lease: UpstreamZenLease): void {
        if (lease.frame !== undefined || !lease.enabled || this.disposed) return;
        const win = this.app.workspace.containerEl.ownerDocument.defaultView;
        if (!win) return;
        lease.frame = win.requestAnimationFrame(() => {
            lease.frame = undefined;
            if (!lease.enabled || this.disposed) return;
            if (this.collapsing(lease.controller)) { this.wait(lease); return; }
            lease.controller.reconcile();
        });
    }

    private release(lease: UpstreamZenLease): void {
        lease.enabled = false;
        if (lease.frame !== undefined) this.app.workspace.containerEl.ownerDocument.defaultView?.cancelAnimationFrame(lease.frame);
        if (lease.controller.deps.isEnabled === lease.wrapper) {
            if (lease.descriptor) Object.defineProperty(lease.controller.deps, "isEnabled", lease.descriptor);
            else delete (lease.controller.deps as Partial<UpstreamZenController["deps"]>).isEnabled;
        }
        if (lease.controller.reconcile === lease.reconcileWrapper) {
            if (lease.reconcileDescriptor) Object.defineProperty(lease.controller, "reconcile", lease.reconcileDescriptor);
            else delete (lease.controller as Partial<UpstreamZenController>).reconcile;
        }
        this.leases.delete(lease.controller);
    }

    dispose(): void {
        this.disposed = true;
        for (const lease of this.leases.values()) this.release(lease);
    }
}
