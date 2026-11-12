/** IDEA-style two complete Shift taps; any intervening gesture cancels them. */
export function installDoubleShift(document, open, now = () => performance.now()) {
    let phase = 0, last = 0;
    const reset = () => { phase = 0; };
    const key = event => {
        if (event.isComposing || event.key !== "Shift" || event.ctrlKey || event.altKey || event.metaKey || event.repeat) { reset(); return; }
        const time = now();
        if (phase && time - last > 300) reset();
        if (event.type === "keydown") {
            phase = phase === 2 ? 3 : phase === 0 ? 1 : 0;
        } else if (phase === 1) phase = 2;
        else if (phase === 3) {
            reset();
            if (!event.defaultPrevented) open();
        } else reset();
        last = time;
    };
    document.addEventListener("keydown", key, true);
    document.addEventListener("keyup", key, true);
    document.addEventListener("pointerdown", reset, true);
    document.addEventListener("compositionstart", reset, true);
    document.defaultView.addEventListener("blur", reset);
    return () => {
        document.removeEventListener("keydown", key, true);
        document.removeEventListener("keyup", key, true);
        document.removeEventListener("pointerdown", reset, true);
        document.removeEventListener("compositionstart", reset, true);
        document.defaultView.removeEventListener("blur", reset);
    };
}
