import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

import {
    collectCompleteWorkspaceWindows,
} from '../extensions/workspace@wenbo/workspaceWindowSet.mjs';


function windowForSlot(slot) {
    return {slot};
}


test('a complete unique set is returned in slot order', () => {
    const unrelated = {slot: 0};
    const windows = [
        windowForSlot(4),
        unrelated,
        windowForSlot(2),
        windowForSlot(6),
        windowForSlot(1),
        windowForSlot(5),
        windowForSlot(3),
    ];

    assert.deepEqual(
        collectCompleteWorkspaceWindows(windows, window => window.slot),
        [
            windows[4],
            windows[2],
            windows[6],
            windows[0],
            windows[5],
            windows[3],
        ]
    );
});


test('a missing or duplicate slot cannot use the complete-set recall path', () => {
    const missing = [1, 2, 3, 4, 5].map(windowForSlot);
    const duplicate = [1, 2, 3, 4, 5, 6, 6].map(windowForSlot);

    assert.equal(
        collectCompleteWorkspaceWindows(missing, window => window.slot),
        null
    );
    assert.equal(
        collectCompleteWorkspaceWindows(duplicate, window => window.slot),
        null
    );
});


test('panel activation recalls only after successful reconciliation', () => {
    const source = readFileSync(
        new URL(
            '../extensions/workspace@wenbo/extension.js',
            import.meta.url
        ),
        'utf8'
    );
    const start = source.indexOf('    _openTerminalLayout() {');
    const end = source.indexOf('    _showTerminalWindows() {', start);
    const activation = source.slice(start, end);
    const subprocess = activation.indexOf('Gio.Subprocess.new(');
    const successful = activation.indexOf('if (successful) {');
    const recall = activation.indexOf(
        'this._showTerminalWindows()',
        successful
    );

    assert.ok(start >= 0 && end > start);
    assert.ok(subprocess >= 0);
    assert.ok(successful > subprocess);
    assert.ok(recall > successful);
    assert.doesNotMatch(
        activation.slice(0, subprocess),
        /this\._showTerminalWindows\(\)/
    );
    assert.match(
        activation.slice(successful),
        /this\._schedulePreparedTerminalReveal\(\);/
    );
    assert.match(
        activation.slice(successful),
        /this\._releasePreparedTerminalWindows\(\);/
    );

    const showEnd = source.indexOf('    _terminalNumber(window) {', end);
    const show = source.slice(end, showEnd);
    assert.match(show, /Could not inspect Terminal windows/);
    assert.match(
        show,
        /catch \(error\) \{\s*this\._warn\([^;]+;\s*return false;/
    );
});
