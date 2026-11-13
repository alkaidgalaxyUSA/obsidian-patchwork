/** One finite animation owns both document positions and their decorations. */
export function smoothDiffScroll(host, readPosition, applyPosition, registerCleanup) {
    const doc = host.ownerDocument, win = doc.defaultView;
    const reducedMotion = win.matchMedia("(prefers-reduced-motion: reduce)");
    const duration = 240, settlingTime = 800;
    let frame, motion;
    const cancel = () => {
        if (frame !== undefined) win.cancelAnimationFrame(frame);
        frame = undefined;
        motion = undefined;
    };
    const tick = time => {
        frame = undefined;
        if (!motion || !host.isConnected || doc.hidden) { cancel(); return; }
        const elapsed = time - motion.started;
        const settled = reducedMotion.matches || elapsed >= duration + settlingTime;
        const progress = settled ? 1 : Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const blend = settled ? 1 : 1 - Math.exp(-Math.max(0, time - motion.previousTime) / 55);
        motion.previousTime = time;
        const pending = applyPosition(motion.current, {
            x: motion.from.x + (motion.to.x - motion.from.x) * eased,
            y: motion.from.y + (motion.to.y - motion.from.y) * eased,
        }, { vertical: motion.vertical, horizontal: motion.horizontal, blend, settled });
        if (settled || progress === 1 && !pending) motion = undefined;
        else frame = win.requestAnimationFrame(tick);
    };
    const move = (current, dx, dy) => {
        const position = readPosition(current);
        const pending = motion?.current === current ? motion : undefined;
        const target = (axis, delta, limit) => {
            // Keep accumulated wheel distance, but discard it on direction reversal.
            const base = pending && (delta === 0 || delta * (pending.to[axis] - position[axis]) >= 0)
                ? pending.to[axis] : position[axis];
            return Math.max(0, Math.min(limit, base + delta));
        };
        const to = { x: target("x", dx, position.maxX), y: target("y", dy, position.maxY) };
        const vertical = dy !== 0 || !!pending?.vertical;
        const horizontal = dx !== 0 || !!pending?.horizontal;
        cancel();
        if (reducedMotion.matches || doc.hidden) {
            applyPosition(current, to, { vertical, horizontal, blend: 1, settled: true });
            return;
        }
        const time = win.performance.now();
        motion = { current, from: position, to, vertical, horizontal, started: time, previousTime: time };
        frame = win.requestAnimationFrame(tick);
    };
    const visibility = () => { if (doc.hidden) cancel(); };
    host.addEventListener("pointerdown", cancel, true);
    host.addEventListener("keydown", cancel, true);
    doc.addEventListener("visibilitychange", visibility);
    registerCleanup(() => {
        cancel();
        host.removeEventListener("pointerdown", cancel, true);
        host.removeEventListener("keydown", cancel, true);
        doc.removeEventListener("visibilitychange", visibility);
    });
    return { move, cancel, isActive: () => !!motion };
}
