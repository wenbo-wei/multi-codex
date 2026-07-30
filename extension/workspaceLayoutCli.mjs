import {workspaceFrames} from './workspaceLayout.mjs';
import System from 'system';


function fail(message) {
    printerr(`workspaceLayoutCli: ${message}`);
    System.exit(2);
}


if (ARGV.length !== 4)
    fail('expected: x y width height');

const values = ARGV.map(value => {
    if (!/^-?[0-9]+$/.test(value))
        fail(`not an integer: ${value}`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed))
        fail(`integer is outside the safe range: ${value}`);
    return parsed;
});

let frames;
try {
    const [x, y, width, height] = values;
    frames = workspaceFrames({x, y, width, height});
} catch (error) {
    fail(error.message);
}

for (const [index, frame] of frames.entries()) {
    print(
        `${index + 1} ${frame.x} ${frame.y} ` +
        `${frame.width} ${frame.height}`
    );
}
