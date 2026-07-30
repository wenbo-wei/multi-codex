const COLUMN_COUNT = 3;
const ROW_COUNT = 2;
export const SLOT_COUNT = COLUMN_COUNT * ROW_COUNT;


function integerProperty(value, name) {
    if (!Number.isSafeInteger(value))
        throw new TypeError(`${name} must be a safe integer`);
    return value;
}


function validatedWorkArea(workArea) {
    if (!workArea)
        throw new TypeError('workArea is required');

    const area = {
        x: integerProperty(workArea.x, 'workArea.x'),
        y: integerProperty(workArea.y, 'workArea.y'),
        width: integerProperty(workArea.width, 'workArea.width'),
        height: integerProperty(workArea.height, 'workArea.height'),
    };
    if (area.width < COLUMN_COUNT || area.height < ROW_COUNT)
        throw new RangeError('workArea is too small for the Workspace grid');
    return area;
}


export function workspaceFrames(workArea) {
    const area = validatedWorkArea(workArea);
    const columnWidth = Math.ceil(area.width / COLUMN_COUNT);
    const firstRowHeight = Math.floor(area.height / ROW_COUNT);

    const frames = Array.from({length: SLOT_COUNT}, (_unused, index) => {
        const column = index % COLUMN_COUNT;
        const row = Math.floor(index / COLUMN_COUNT);
        return {
            x: area.x + column * columnWidth,
            y: area.y + row * firstRowHeight,
            width: column === COLUMN_COUNT - 1
                ? area.width - (COLUMN_COUNT - 1) * columnWidth
                : columnWidth,
            height: row === ROW_COUNT - 1
                ? area.height - firstRowHeight
                : firstRowHeight,
        };
    });
    if (frames.some(frame => frame.width < 1 || frame.height < 1))
        throw new RangeError('workArea cannot produce six non-empty frames');
    return frames;
}


export function workspaceFrameForSlot(workArea, slot) {
    if (!Number.isSafeInteger(slot) || slot < 1 || slot > SLOT_COUNT)
        throw new RangeError(`slot must be between 1 and ${SLOT_COUNT}`);
    return workspaceFrames(workArea)[slot - 1];
}
