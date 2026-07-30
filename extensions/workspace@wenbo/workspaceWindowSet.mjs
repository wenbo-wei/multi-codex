export const WORKSPACE_SLOT_COUNT = 6;


export function collectCompleteWorkspaceWindows(
    windows,
    terminalSlot,
    slotCount = WORKSPACE_SLOT_COUNT
) {
    if (!windows || typeof terminalSlot !== 'function')
        throw new TypeError('windows and terminalSlot are required');
    if (!Number.isInteger(slotCount) || slotCount < 1)
        throw new RangeError('slotCount must be a positive integer');

    const windowsBySlot = new Map();
    for (const window of windows) {
        const slot = terminalSlot(window);
        if (!Number.isInteger(slot) || slot < 1 || slot > slotCount)
            continue;
        if (windowsBySlot.has(slot))
            return null;
        windowsBySlot.set(slot, window);
    }
    if (windowsBySlot.size !== slotCount)
        return null;

    return [...windowsBySlot.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, window]) => window);
}
