import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

import {
    SLOT_COUNT,
    workspaceFrameForSlot,
    workspaceFrames,
} from '../extension/workspaceLayout.mjs';


test('current work area reproduces the six canonical visible frames', () => {
    assert.deepEqual(
        workspaceFrames({x: 0, y: 44, width: 3440, height: 1325}),
        [
            {x: 0, y: 44, width: 1147, height: 662},
            {x: 1147, y: 44, width: 1147, height: 662},
            {x: 2294, y: 44, width: 1146, height: 662},
            {x: 0, y: 706, width: 1147, height: 663},
            {x: 1147, y: 706, width: 1147, height: 663},
            {x: 2294, y: 706, width: 1146, height: 663},
        ]
    );
});


test('offset odd-sized work areas are covered without gaps', () => {
    const frames = workspaceFrames({x: -20, y: 31, width: 10, height: 5});
    assert.equal(frames.length, SLOT_COUNT);
    assert.deepEqual(frames[0], {x: -20, y: 31, width: 4, height: 2});
    assert.deepEqual(frames[2], {x: -12, y: 31, width: 2, height: 2});
    assert.deepEqual(frames[5], {x: -12, y: 33, width: 2, height: 3});
});


test('slot lookup validates the domain slot', () => {
    const area = {x: 0, y: 0, width: 6, height: 4};
    assert.deepEqual(
        workspaceFrameForSlot(area, 6),
        {x: 4, y: 2, width: 2, height: 2}
    );
    assert.throws(() => workspaceFrameForSlot(area, 0), RangeError);
    assert.throws(() => workspaceFrameForSlot(area, 7), RangeError);
    assert.throws(() => workspaceFrameForSlot(area, 1.5), RangeError);
});


test('invalid work areas fail before a frame can be used', () => {
    assert.throws(
        () => workspaceFrames({x: 0, y: 0, width: 2, height: 2}),
        RangeError
    );
    assert.throws(
        () => workspaceFrames({x: 0, y: 0, width: 4, height: 2}),
        RangeError
    );
    assert.throws(
        () => workspaceFrames({x: 0, y: 0, width: 6.5, height: 4}),
        TypeError
    );
});


test('the GJS adapter emits the same canonical frames', () => {
    const cli = fileURLToPath(new URL(
        '../extension/workspaceLayoutCli.mjs',
        import.meta.url
    ));
    const result = spawnSync(
        '/usr/bin/gjs',
        ['-m', cli, '0', '44', '3440', '1325'],
        {encoding: 'utf8'}
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
        result.stdout,
        '1 0 44 1147 662\n' +
        '2 1147 44 1147 662\n' +
        '3 2294 44 1146 662\n' +
        '4 0 706 1147 663\n' +
        '5 1147 706 1147 663\n' +
        '6 2294 706 1146 663\n'
    );
});
