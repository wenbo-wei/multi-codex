import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

import {runtimeCommandArgv} from '../extension/runtimeCommand.mjs';


test('runtime command argv follows an arbitrary extension directory', () => {
    const calls = [];
    const argv = runtimeCommandArgv(
        '/tmp/extension copy with spaces',
        parts => {
            calls.push(parts);
            return parts.join('/');
        }
    );

    assert.deepEqual(calls, [[
        '/tmp/extension copy with spaces',
        'scripts',
        'multi-codex',
    ]]);
    assert.deepEqual(argv, [
        '/tmp/extension copy with spaces/scripts/multi-codex',
        '--panel',
    ]);
});


test('the production subprocess receives the derived argv', () => {
    const source = readFileSync(
        new URL('../extension/extension.js', import.meta.url),
        'utf8'
    );

    assert.match(
        source,
        /this\._commandArgv = runtimeCommandArgv\(\s*this\.path,/
    );
    assert.match(
        source,
        /Gio\.Subprocess\.new\(\s*commandArgv,/
    );
});
