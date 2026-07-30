import assert from 'node:assert/strict';
import test from 'node:test';

import {
    prepareTerminalWindow,
    reassertTerminalWindow,
} from '../extensions/workspace@wenbo/workspaceWindowPlacement.mjs';


function fakeWindow(events) {
    return {
        get_work_area_current_monitor() {
            events.push('work-area');
            return {x: 0, y: 40, width: 1200, height: 680};
        },
        move_frame(userOperation, x, y) {
            events.push(`move:${userOperation}:${x},${y}`);
        },
        move_resize_frame(userOperation, x, y, width, height) {
            events.push(
                `resize:${userOperation}:${x},${y},${width},${height}`
            );
        },
    };
}


function fakeActor(events) {
    return {
        remove_all_transitions() {
            events.push('remove-transitions');
        },
        set_opacity(opacity) {
            events.push(`opacity:${opacity}`);
        },
    };
}


test('pre-paint preparation places, skips the map effect, then holds', () => {
    const events = [];
    const actor = fakeActor(events);
    const window = fakeWindow(events);
    const placement = prepareTerminalWindow({
        actor,
        skipNextEffect(value) {
            assert.equal(value, actor);
            events.push('skip-next-effect');
        },
        slot: 2,
        window,
    });

    assert.deepEqual(placement.target, {
        x: 400,
        y: 40,
        width: 400,
        height: 340,
    });
    assert.deepEqual(events, [
        'work-area',
        'move:true:400,40',
        'resize:true:400,40,400,340',
        'skip-next-effect',
        'remove-transitions',
        'opacity:0',
    ]);
});


test('missing actor still receives synchronous canonical placement', () => {
    const events = [];
    const window = fakeWindow(events);
    const placement = prepareTerminalWindow({
        actor: null,
        skipNextEffect: null,
        slot: 4,
        window,
    });

    assert.equal(placement.actor, null);
    assert.deepEqual(events, [
        'work-area',
        'move:true:0,380',
        'resize:true:0,380,400,340',
    ]);
});


test('preparation failure restores an actor that may already be held', () => {
    const events = [];
    const actor = {
        remove_all_transitions() {
            events.push('remove-transitions');
        },
        set_opacity(opacity) {
            events.push(`opacity:${opacity}`);
            if (opacity === 0)
                throw new Error('simulated hold failure');
        },
    };

    assert.throws(
        () => prepareTerminalWindow({
            actor,
            skipNextEffect() {
                events.push('skip-next-effect');
            },
            slot: 1,
            window: fakeWindow(events),
        }),
        /simulated hold failure/
    );
    assert.deepEqual(events.slice(-5), [
        'skip-next-effect',
        'remove-transitions',
        'opacity:0',
        'remove-transitions',
        'opacity:255',
    ]);
});


test('first-frame defence restores opacity zero and target frame', () => {
    const events = [];
    const actor = fakeActor(events);
    const window = fakeWindow(events);
    reassertTerminalWindow({
        actor,
        target: {x: 800, y: 380, width: 400, height: 340},
        window,
    });

    assert.deepEqual(events, [
        'remove-transitions',
        'opacity:0',
        'move:true:800,380',
        'resize:true:800,380,400,340',
    ]);
});
