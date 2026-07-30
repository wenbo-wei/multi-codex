import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    prepareTerminalWindow as prepareProductionTerminalWindow,
    reassertTerminalWindow as reassertProductionTerminalWindow,
} from './workspaceWindowPlacement.mjs';
import {workspaceFrameForSlot} from './workspaceLayout.mjs';


const PREFIX = '[MULTI-CODEX-HARNESS]';
const SLOT_COUNT = 6;
const HELPER_DELAY_MS = 600;
const RESULT_TIMEOUT_MS = 7000;


export default class MultiCodexPlacementHarness extends Extension {
    enable() {
        this._mode = GLib.getenv('MULTI_CODEX_HARNESS_MODE') ?? 'v7';
        this._placements = new Map();
        this._processes = [];
        this._firstFrameSamples = 0;
        this._visibleBeforeTarget = new Set();
        this._identityMisses = 0;
        this._actorMisses = 0;
        this._finished = false;
        this._helperSource = 0;
        this._resultSource = 0;

        this._windowCreatedSignal = global.display.connect(
            'window-created',
            (_display, window) => this._onWindowCreated(window)
        );
        this._launchSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            500,
            () => {
                this._launchSource = 0;
                this._launchWindows();
                return GLib.SOURCE_REMOVE;
            }
        );
        this._resultSource = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            RESULT_TIMEOUT_MS,
            () => {
                this._resultSource = 0;
                this._finish('timeout');
                return GLib.SOURCE_REMOVE;
            }
        );
        this._log(`START mode=${this._mode}`);
    }

    disable() {
        if (this._windowCreatedSignal) {
            global.display.disconnect(this._windowCreatedSignal);
            this._windowCreatedSignal = 0;
        }
        for (const property of [
            '_launchSource',
            '_helperSource',
            '_resultSource',
        ]) {
            if (this[property])
                GLib.Source.remove(this[property]);
            this[property] = 0;
        }
        for (const process of this._processes) {
            try {
                process.force_exit();
            } catch {
                // The isolated test client may already have exited.
            }
        }
        this._processes = [];
        for (const placement of this._placements.values())
            this._disconnectPlacement(placement);
        this._placements.clear();
    }

    _launchWindows() {
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.NONE,
        });
        launcher.setenv('GDK_BACKEND', 'x11', true);
        for (let slot = 1; slot <= SLOT_COUNT; slot++) {
            try {
                this._processes.push(launcher.spawnv([
                    '/usr/bin/ptyxis',
                    '--standalone',
                    `--title=Harness Terminal ${slot}`,
                ]));
            } catch (error) {
                this._log(`LAUNCH_ERROR slot=${slot} error=${error}`);
            }
        }
    }

    _onWindowCreated(window) {
        if (!window || window.is_override_redirect())
            return;

        const slot = this._terminalSlot(window);
        if (!slot) {
            this._identityMisses += 1;
            this._log(
                `IDENTITY_MISS pid=${window.get_pid()} ` +
                `title=${JSON.stringify(window.get_title() ?? '')}`
            );
            return;
        }

        const target = this._targetFrame(window, slot);
        const actor = window.get_compositor_private();
        const initial = window.get_frame_rect();
        this._log(
            `CREATED slot=${slot} actor=${Boolean(actor)} ` +
            `mapped=${actor?.mapped ?? false} opacity=${actor?.opacity ?? -1} ` +
            `frame=${this._frameText(initial)} target=${this._frameText(target)}`
        );

        if (!actor)
            this._actorMisses += 1;

        let placement = {
            actor,
            firstFrameSignal: 0,
            slot,
            target,
            window,
        };
        if (this._mode === 'fix') {
            placement = {
                ...prepareProductionTerminalWindow({
                    actor,
                    skipNextEffect: actorToSkip => {
                        Main.wm.skipNextEffect(actorToSkip);
                    },
                    slot,
                    window,
                }),
                firstFrameSignal: 0,
                slot,
            };
        }
        this._placements.set(window, placement);

        if (actor && this._mode !== 'fix') {
            actor.remove_all_transitions();
            actor.set_opacity(0);
        }
        if (actor) {
            placement.firstFrameSignal = actor.connect('first-frame', () => {
                this._sampleFirstFrame(placement);
            });
        }

        if (this._mode === 'v6')
            this._applyTarget(placement, false);

        if (this._placements.size === SLOT_COUNT && !this._helperSource) {
            this._helperSource = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                HELPER_DELAY_MS,
                () => {
                    this._helperSource = 0;
                    this._completeLayout();
                    return GLib.SOURCE_REMOVE;
                }
            );
        }
    }

    _sampleFirstFrame(placement) {
        if (!this._placements.has(placement.window))
            return;
        if (this._mode === 'v6') {
            placement.actor?.remove_all_transitions();
            placement.actor?.set_opacity(0);
            this._applyTarget(placement, false);
        } else if (this._mode === 'fix') {
            reassertProductionTerminalWindow(placement);
        }
        this._firstFrameSamples += 1;
        const frame = placement.window.get_frame_rect();
        const opacity = placement.actor?.opacity ?? -1;
        const matches = this._frameMatches(frame, placement.target);
        if (opacity > 0 && !matches)
            this._visibleBeforeTarget.add(placement.slot);
        this._log(
            `FIRST_FRAME slot=${placement.slot} opacity=${opacity} ` +
            `mapped=${placement.actor?.mapped ?? false} matches=${matches} ` +
            `frame=${this._frameText(frame)}`
        );
    }

    _completeLayout() {
        for (const placement of this._placements.values())
            this._applyTarget(placement, false);

        global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW,
            () => {
                for (const placement of this._placements.values()) {
                    const frame = placement.window.get_frame_rect();
                    const matches = this._frameMatches(
                        frame,
                        placement.target
                    );
                    const opacity = placement.actor?.opacity ?? -1;
                    if (opacity > 0 && !matches)
                        this._visibleBeforeTarget.add(placement.slot);
                    this._log(
                        `BEFORE_REVEAL slot=${placement.slot} ` +
                        `opacity=${opacity} matches=${matches} ` +
                        `frame=${this._frameText(frame)}`
                    );
                    if (placement.actor) {
                        placement.actor.remove_all_transitions();
                        placement.actor.set_opacity(255);
                    }
                }
                GLib.timeout_add(
                    GLib.PRIORITY_DEFAULT,
                    250,
                    () => {
                        this._finish('complete');
                        return GLib.SOURCE_REMOVE;
                    }
                );
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _applyTarget(placement, skipEffect) {
        const {window, target} = placement;
        if (skipEffect && placement.actor)
            Main.wm.skipNextEffect(placement.actor);
        window.move_frame(true, target.x, target.y);
        window.move_resize_frame(
            true,
            target.x,
            target.y,
            target.width,
            target.height
        );
    }

    _targetFrame(window, slot) {
        return workspaceFrameForSlot(
            window.get_work_area_current_monitor(),
            slot
        );
    }

    _terminalSlot(window) {
        try {
            const pid = window.get_pid();
            if (!Number.isInteger(pid) || pid <= 0)
                return 0;
            const file = Gio.File.new_for_path(`/proc/${pid}/cmdline`);
            const [ok, contents] = file.load_contents(null);
            if (!ok)
                return 0;
            const args = new TextDecoder()
                .decode(contents)
                .split('\0')
                .filter(Boolean);
            const match = args.length === 3 &&
                args[0] === '/usr/bin/ptyxis' &&
                args[1] === '--standalone'
                ? /^--title=Harness Terminal ([1-6])$/.exec(args[2])
                : null;
            return match ? Number(match[1]) : 0;
        } catch {
            return 0;
        }
    }

    _frameMatches(frame, target) {
        return Math.abs(frame.x - target.x) <= 1 &&
            Math.abs(frame.y - target.y) <= 1 &&
            Math.abs(frame.width - target.width) <= 1 &&
            Math.abs(frame.height - target.height) <= 1;
    }

    _frameText(frame) {
        if (!frame)
            return 'none';
        return `${frame.x},${frame.y},${frame.width},${frame.height}`;
    }

    _disconnectPlacement(placement) {
        if (!placement.firstFrameSignal)
            return;
        try {
            placement.actor.disconnect(placement.firstFrameSignal);
        } catch {
            // The isolated actor may already have been destroyed.
        }
        placement.firstFrameSignal = 0;
    }

    _finish(reason) {
        if (this._finished)
            return;
        this._finished = true;
        this._log(
            `RESULT mode=${this._mode} reason=${reason} ` +
            `windows=${this._placements.size} ` +
            `first_frames=${this._firstFrameSamples} ` +
            `identity_misses=${this._identityMisses} ` +
            `actor_misses=${this._actorMisses} ` +
            `visible_before_target=${[...this._visibleBeforeTarget].join(',') || 'none'}`
        );
    }

    _log(message) {
        console.log(`${PREFIX} ${message}`);
    }
}
