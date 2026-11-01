import type { App } from "obsidian";
import type { ModuleId, Unsubscribe } from "../contracts/common";
import type { ServiceMap, ServiceRegistry } from "../contracts/services";

type ServiceKey = keyof ServiceMap;
type Service = ServiceMap[ServiceKey];

interface Registration {
    owner: ModuleId;
    token: symbol;
    api: Service;
}

interface Subscriber {
    owner: ModuleId;
    initialized: boolean;
    lastToken?: symbol;
    listener: (api: Service | undefined) => void;
}

interface ServiceHost {
    version: 1;
    providers: Map<ServiceKey, Registration>;
    subscribers: Map<ServiceKey, Set<Subscriber>>;
    pending: Set<ServiceKey>;
    dispatching: boolean;
}

const hostKey = Symbol.for("patchwork.services.v1");

function deliver(host: ServiceHost, key: ServiceKey, subscriber: Subscriber): void {
    const registration = host.providers.get(key);
    if (subscriber.initialized && subscriber.lastToken === registration?.token) return;
    subscriber.initialized = true;
    subscriber.lastToken = registration?.token;
    const report = (error: unknown) => {
        console.error(`Patchwork service subscriber failed (${subscriber.owner}/${key}).`, error);
    };
    try {
        const result: unknown = subscriber.listener(registration?.api);
        if (result && typeof result === "object" && typeof Reflect.get(result, "then") === "function") {
            void Promise.resolve(result).catch(report);
        }
    } catch (error) {
        report(error);
    }
}

function publish(host: ServiceHost, key: ServiceKey): void {
    host.pending.add(key);
    if (host.dispatching) return;
    host.dispatching = true;
    try {
        while (host.pending.size) {
            const current = host.pending.values().next().value!;
            host.pending.delete(current);
            const subscribers = host.subscribers.get(current);
            for (const subscriber of [...(subscribers ?? [])]) {
                if (subscribers?.has(subscriber)) deliver(host, current, subscriber);
            }
        }
    } finally {
        host.dispatching = false;
    }
}

/** Resolve lazily: importing shared infrastructure never initializes a runtime. */
export function getServiceRegistry(app: App): ServiceRegistry {
    const existing: unknown = Reflect.get(app, hostKey);
    if (existing !== undefined && (!existing || typeof existing !== "object"
        || Reflect.get(existing, "version") !== 1)) {
        throw new Error("Incompatible Patchwork service registry host.");
    }
    const host: ServiceHost = (existing as ServiceHost | undefined) ?? {
        version: 1,
        providers: new Map(),
        subscribers: new Map(),
        pending: new Set(),
        dispatching: false,
    };
    if (existing === undefined) Object.defineProperty(app, hostKey, { value: host });

    return {
        register(owner, key, api) {
            if (api.version !== 1) throw new Error(`Unsupported Patchwork service version: ${key}`);
            if (host.providers.has(key)) throw new Error(`Patchwork service already registered: ${key}`);
            const token = Symbol(key);
            host.providers.set(key, { owner, token, api });
            publish(host, key);
            return {
                dispose() {
                    if (host.providers.get(key)?.token !== token) return;
                    host.providers.delete(key);
                    publish(host, key);
                },
            };
        },
        get<K extends ServiceKey>(key: K): ServiceMap[K] | undefined {
            return host.providers.get(key)?.api as ServiceMap[K] | undefined;
        },
        watch<K extends ServiceKey>(owner: ModuleId, key: K,
            listener: (api: ServiceMap[K] | undefined) => void): Unsubscribe {
            const subscriber: Subscriber = {
                owner,
                initialized: false,
                listener: api => listener(api as ServiceMap[K] | undefined),
            };
            const subscribers = host.subscribers.get(key) ?? new Set<Subscriber>();
            host.subscribers.set(key, subscribers);
            subscribers.add(subscriber);
            deliver(host, key, subscriber);
            return () => {
                subscribers.delete(subscriber);
                if (!subscribers.size) host.subscribers.delete(key);
            };
        },
    };
}
