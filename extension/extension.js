// Multi Codex panel extension.
import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    prepareTerminalWindow,
    reassertTerminalWindow,
} from './workspaceWindowPlacement.mjs';
import {
    collectCompleteWorkspaceWindows,
} from './workspaceWindowSet.mjs';


const CODEX_DASHBOARD_ROLE = 'codex-quota-centre@local';
const CODEX_SOURCE_INDICATOR_ID = 'codex-quota';
const COMMAND_TIMEOUT_MS = 30000;
const COMMAND_TERMINATE_GRACE_MS = 8000;


const MultiCodexPanelButton = GObject.registerClass(
class MultiCodexPanelButton extends PanelMenu.Button {
    _init(activate) {
        super._init(0.5, 'Show Workspace', true);
        this.accessible_role = Atk.Role.PUSH_BUTTON;
        this._activate = activate;
        this.add_style_class_name('multi-codex-button');
        this.add_child(new St.Label({
            text: 'Workspace',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        // GNOME Shell 50 uses a click gesture for panel buttons. Replace the
        // disabled dummy-menu gesture with the Multi Codex action.
        this.remove_action(this._clickGesture);
        this._clickGesture = new Clutter.ClickGesture();
        this._clickGesture.set_recognize_on_press(true);
        this._clickGesture.set_enabled(true);
        this._clickGesture.connect('recognize', () => this._activate());
        this.add_action(this._clickGesture);
    }

    vfunc_key_release_event(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return ||
            symbol === Clutter.KEY_KP_Enter ||
            symbol === Clutter.KEY_space) {
            this._activate();
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_key_release_event(event);
    }
});


export default class MultiCodexExtension extends Extension {
    enable() {
        this._enabled = true;
        this._commandArgv = [
            GLib.build_filenamev([this.path, 'scripts', 'multi-codex']),
            '--panel',
        ];
        this._placing = false;
        this._placeSource = 0;
        this._button = null;
        this._terminalProcess = null;
        this._terminalTimeoutSource = 0;
        this._terminalKillSource = 0;
        this._terminalTimedOut = false;
        this._holdNewTerminalWindows = false;
        this._windowCreatedSignal = 0;
        this._windowPlacements = new Map();
        this._revealLater = 0;
        this._legacyAppearanceSignals = [];
        this._legacyIndicator = null;
        this._legacyIndicatorSignals = [];
        this._runGeneration = (this._runGeneration ?? 0) + 1;

        this._destroyLegacyInjectedButton();
        this._createButton();

        try {
            this._windowCreatedSignal = global.display.connect(
                'window-created',
                (_display, window) => this._prepareTerminalWindow(window)
            );
        } catch (error) {
            this._warn('Could not watch for new Terminal windows', error);
        }

        this._connectLegacyIndicatorSignals();
        this._watchLegacyIndicator(this._findLegacyCodexIndicator());
        this._schedulePlacement();
    }

    disable() {
        this._enabled = false;
        this._runGeneration = (this._runGeneration ?? 0) + 1;
        const terminalProcess = this._terminalProcess;
        this._terminalProcess = null;
        this._clearTerminalCommandSources();
        this._terminalTimedOut = false;
        this._holdNewTerminalWindows = false;
        if (terminalProcess) {
            try {
                terminalProcess.send_signal(15);
            } catch (error) {
                this._warn(
                    'Could not stop the pending Multi Codex command',
                    error
                );
            }
        }
        this._disconnectLegacyIndicatorSignals();
        if (this._windowCreatedSignal) {
            try {
                global.display.disconnect(this._windowCreatedSignal);
            } catch (error) {
                this._warn('Could not stop watching Terminal windows', error);
            }
            this._windowCreatedSignal = 0;
        }
        this._releasePreparedTerminalWindows();
        if (this._placeSource) {
            try {
                GLib.Source.remove(this._placeSource);
            } catch (error) {
                this._warn('Could not remove pending placement', error);
            }
            this._placeSource = 0;
        }
        this._destroyButton();
        this._placing = false;
        this._commandArgv = null;
    }

    _panelBox(property) {
        try {
            const box = Main.panel?.[property];
            return this._isContainer(box) ? box : null;
        } catch (error) {
            this._warn(`Could not access panel ${property}`, error);
            return null;
        }
    }

    _dateMenuContainer() {
        try {
            const container = Main.panel?.statusArea?.dateMenu?.container;
            return this._isActor(container) ? container : null;
        } catch (error) {
            this._warn('Could not access the date menu', error);
            return null;
        }
    }

    _findCodexContainer() {
        let statusArea;
        try {
            statusArea = Main.panel?.statusArea ?? {};
        } catch (error) {
            this._warn('Could not inspect the panel status area', error);
            return null;
        }

        // Prefer the dashboard registered by its GNOME status-area role.
        // Falling back to the date menu while it exists would make Multi Codex
        // and the dashboard continually compete for the same panel position.
        const dashboardContainer =
            statusArea[CODEX_DASHBOARD_ROLE]?.container;
        if (this._isActor(dashboardContainer))
            return dashboardContainer;

        // Keep compatibility with the original Ubuntu AppIndicator, but do
        // not anchor to its invisible placeholder.
        const legacyIndicator = this._findLegacyCodexIndicator(statusArea);
        if (legacyIndicator?.visible !== false &&
            this._isActor(legacyIndicator?.container))
            return legacyIndicator.container;
        return null;
    }

    _findLegacyCodexIndicator(statusArea = null) {
        try {
            const items = statusArea ?? Main.panel?.statusArea ?? {};
            return Object.values(items).find(
                item => item?._indicator?.id === CODEX_SOURCE_INDICATOR_ID &&
                    this._isActor(item?.container)
            ) ?? null;
        } catch (error) {
            this._warn('Could not inspect legacy Codex indicators', error);
            return null;
        }
    }

    _connectLegacyIndicatorSignals() {
        for (const property of ['_leftBox', '_centerBox', '_rightBox']) {
            const box = this._panelBox(property);
            if (!box)
                continue;
            try {
                const signalId = box.connect(
                    'child-added',
                    (_container, actor) => {
                        const indicator = this._findLegacyCodexIndicator();
                        if (indicator?.container !== actor)
                            return;
                        this._watchLegacyIndicator(indicator);
                        this._schedulePlacement();
                    }
                );
                this._legacyAppearanceSignals.push({box, signalId});
            } catch (error) {
                this._warn(
                    'Could not watch for the legacy Codex indicator',
                    error
                );
            }
        }
    }

    _watchLegacyIndicator(indicator) {
        if (!indicator ||
            indicator?._indicator?.id !== CODEX_SOURCE_INDICATOR_ID)
            return;
        if (this._legacyIndicator === indicator)
            return;
        this._disconnectLegacyIndicatorWatch();
        this._legacyIndicator = indicator;
        this._legacyIndicatorSignals = [];
        try {
            const visibleSignal = indicator.connect(
                'notify::visible',
                () => {
                    if (this._legacyIndicator === indicator)
                        this._schedulePlacement();
                }
            );
            this._legacyIndicatorSignals.push({
                actor: indicator,
                signalId: visibleSignal,
            });
            const destroySignal = indicator.connect('destroy', () => {
                if (this._legacyIndicator !== indicator)
                    return;
                this._legacyIndicator = null;
                this._legacyIndicatorSignals = [];
                this._schedulePlacement();
            });
            this._legacyIndicatorSignals.push({
                actor: indicator,
                signalId: destroySignal,
            });
        } catch (error) {
            this._warn(
                'Could not watch legacy Codex indicator visibility',
                error
            );
            this._disconnectLegacyIndicatorWatch();
        }
    }

    _disconnectLegacyIndicatorWatch() {
        for (const {actor, signalId} of this._legacyIndicatorSignals) {
            try {
                actor.disconnect(signalId);
            } catch {
                // The legacy indicator may already have been destroyed.
            }
        }
        this._legacyIndicatorSignals = [];
        this._legacyIndicator = null;
    }

    _disconnectLegacyIndicatorSignals() {
        this._disconnectLegacyIndicatorWatch();
        for (const {box, signalId} of this._legacyAppearanceSignals) {
            try {
                box.disconnect(signalId);
            } catch {
                // The panel box may already have been disposed.
            }
        }
        this._legacyAppearanceSignals = [];
    }

    _schedulePlacement() {
        if (!this._enabled || this._placing || this._placeSource)
            return;
        try {
            this._placeSource = GLib.idle_add(
                GLib.PRIORITY_DEFAULT_IDLE,
                () => {
                    this._placeSource = 0;
                    if (!this._enabled)
                        return GLib.SOURCE_REMOVE;
                    this._placing = true;
                    try {
                        this._placeButton();
                    } catch (error) {
                        this._warn(
                            'Could not place the Multi Codex button',
                            error
                        );
                    } finally {
                        this._placing = false;
                    }
                    return GLib.SOURCE_REMOVE;
                }
            );
        } catch (error) {
            this._placeSource = 0;
            this._warn('Could not schedule Multi Codex placement', error);
        }
    }

    _placeButton() {
        const buttonContainer = this._button?.container;
        const centreBox = this._panelBox('_centerBox');
        const dateContainer = this._dateMenuContainer();
        if (!this._isActor(buttonContainer) || !centreBox || !dateContainer ||
            this._indexOf(centreBox, dateContainer) < 0)
            return false;

        const codexContainer = this._findCodexContainer();
        const anchor = codexContainer &&
            this._parentOf(codexContainer) === centreBox
            ? codexContainer
            : dateContainer;
        return this._moveAfter(buttonContainer, centreBox, anchor);
    }

    _createButton() {
        if (this._button)
            return;

        const button = new MultiCodexPanelButton(
            () => this._openTerminalLayout()
        );
        this._button = button;

        const centreBox = this._panelBox('_centerBox');
        const dateContainer = this._dateMenuContainer();
        const codexContainer = this._findCodexContainer();
        const anchor = codexContainer &&
            this._parentOf(codexContainer) === centreBox
            ? codexContainer
            : dateContainer;
        const anchorIndex = this._indexOf(centreBox, anchor);
        const position = anchorIndex >= 0 ? anchorIndex + 1 : 0;

        try {
            Main.panel.addToStatusArea(
                this.uuid,
                button,
                position,
                'center'
            );
        } catch (error) {
            this._button = null;
            button.destroy();
            throw error;
        }
    }

    _destroyLegacyInjectedButton() {
        const legacy = globalThis.__codexSixTerminalButton;
        if (!legacy)
            return;
        try {
            legacy.button?.destroy();
        } catch (error) {
            this._warn('Could not remove the temporary Terminal button', error);
        }
        try {
            delete globalThis.__codexSixTerminalButton;
        } catch {
            globalThis.__codexSixTerminalButton = null;
        }
    }

    _destroyButton() {
        const button = this._button;
        this._button = null;
        if (!button)
            return;

        try {
            button.destroy();
        } catch (error) {
            this._warn('Could not destroy the Multi Codex button', error);
        }
    }

    _prepareTerminalWindow(window) {
        if (!this._holdNewTerminalWindows || !window ||
            window.is_override_redirect())
            return;

        const number = this._terminalNumber(window);
        if (!number || this._windowPlacements.has(window))
            return;

        let actor = null;
        try {
            actor = window.get_compositor_private();
        } catch (error) {
            this._warn(`Could not inspect Terminal ${number}`, error);
        }

        let placement;
        try {
            placement = prepareTerminalWindow({
                actor,
                skipNextEffect: actorToSkip => {
                    Main.wm.skipNextEffect(actorToSkip);
                },
                slot: number,
                window,
            });
        } catch (error) {
            this._warn(`Could not place Terminal ${number}`, error);
            return;
        }

        // Geometry placement does not require an actor. If Mutter ever breaks
        // its window-created actor guarantee, fail open at the target frame.
        if (!actor)
            return;

        placement.firstFrameSignal = 0;
        placement.unmanagingSignal = 0;
        this._windowPlacements.set(window, placement);

        try {
            placement.firstFrameSignal = actor.connect(
                'first-frame',
                () => this._onTerminalFirstFrame(placement)
            );
            placement.unmanagingSignal = window.connect(
                'unmanaging',
                () => this._discardTerminalPlacement(placement)
            );
        } catch (error) {
            this._warn(`Could not prepare Terminal ${number}`, error);
            this._revealTerminalWindow(placement);
        }
    }

    _onTerminalFirstFrame(placement) {
        if (this._windowPlacements.get(placement.window) !== placement)
            return;

        if (placement.firstFrameSignal) {
            const signalId = placement.firstFrameSignal;
            placement.firstFrameSignal = 0;
            try {
                placement.actor.disconnect(signalId);
            } catch {
                // The actor can disappear while its first frame is emitted.
            }
        }

        try {
            reassertTerminalWindow(placement);
        } catch (error) {
            this._warn('Could not retain a new Terminal placement', error);
            this._revealTerminalWindow(placement);
        }
    }

    _schedulePreparedTerminalReveal() {
        if (!this._windowPlacements.size || this._revealLater)
            return;
        const placements = [...this._windowPlacements.values()];
        try {
            this._revealLater = global.compositor.get_laters().add(
                Meta.LaterType.BEFORE_REDRAW,
                () => {
                    this._revealLater = 0;
                    this._revealPreparedTerminalWindowsNow(placements);
                    return GLib.SOURCE_REMOVE;
                }
            );
        } catch (error) {
            this._warn(
                'Could not schedule the Terminal window reveal',
                error
            );
            this._revealPreparedTerminalWindowsNow(placements);
        }
    }

    _releasePreparedTerminalWindows() {
        if (this._revealLater) {
            try {
                global.compositor.get_laters().remove(this._revealLater);
            } catch {
                // The compositor callback may already be running.
            }
            this._revealLater = 0;
        }
        this._revealPreparedTerminalWindowsNow();
    }

    _revealPreparedTerminalWindowsNow(
        placements = [...this._windowPlacements.values()]
    ) {
        for (const placement of placements)
            this._revealTerminalWindow(placement);
    }

    _revealTerminalWindow(placement) {
        if (this._windowPlacements.get(placement.window) !== placement)
            return;

        this._windowPlacements.delete(placement.window);
        this._disconnectTerminalPlacement(placement);
        try {
            placement.actor.remove_all_transitions();
            placement.actor.set_opacity(255);
        } catch {
            // The window may have closed during creation rollback.
        }
    }

    _discardTerminalPlacement(placement) {
        if (this._windowPlacements.get(placement.window) !== placement)
            return;
        this._windowPlacements.delete(placement.window);
        this._disconnectTerminalPlacement(placement);
    }

    _disconnectTerminalPlacement(placement) {
        if (placement.firstFrameSignal) {
            try {
                placement.actor.disconnect(placement.firstFrameSignal);
            } catch {
                // The actor may already have been disposed.
            }
            placement.firstFrameSignal = 0;
        }
        if (placement.unmanagingSignal) {
            try {
                placement.window.disconnect(placement.unmanagingSignal);
            } catch {
                // The window may already be unmanaging.
            }
            placement.unmanagingSignal = 0;
        }
    }

    _clearTerminalCommandSources() {
        for (const property of [
            '_terminalTimeoutSource',
            '_terminalKillSource',
        ]) {
            if (!this[property])
                continue;
            try {
                GLib.Source.remove(this[property]);
            } catch {
                // A timeout source can finish while the process exits.
            }
            this[property] = 0;
        }
    }

    _armTerminalCommandTimeout(process, generation) {
        try {
            this._terminalTimeoutSource = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                COMMAND_TIMEOUT_MS,
                () => {
                    this._terminalTimeoutSource = 0;
                    if (this._terminalProcess !== process ||
                        this._runGeneration !== generation)
                        return GLib.SOURCE_REMOVE;

                    this._terminalTimedOut = true;
                    this._holdNewTerminalWindows = false;
                    this._releasePreparedTerminalWindows();
                    Main.notify(
                        'Multi Codex',
                        'Opening the six-terminal workspace timed out.'
                    );
                    try {
                        process.send_signal(15);
                    } catch (error) {
                        this._warn(
                            'Could not stop the timed-out Multi Codex command',
                            error
                        );
                    }

                    this._terminalKillSource = GLib.timeout_add(
                        GLib.PRIORITY_DEFAULT,
                        COMMAND_TERMINATE_GRACE_MS,
                        () => {
                            this._terminalKillSource = 0;
                            if (this._terminalProcess !== process ||
                                this._runGeneration !== generation)
                                return GLib.SOURCE_REMOVE;
                            try {
                                process.force_exit();
                            } catch (error) {
                                this._warn(
                                    'Could not force-stop the Multi Codex command',
                                    error
                                );
                            }
                            if (this._terminalProcess === process) {
                                this._terminalProcess = null;
                                this._runGeneration += 1;
                                this._terminalTimedOut = false;
                            }
                            return GLib.SOURCE_REMOVE;
                        }
                    );
                    return GLib.SOURCE_REMOVE;
                }
            );
            return true;
        } catch (error) {
            this._warn('Could not arm the Multi Codex command timeout', error);
            return false;
        }
    }

    _openTerminalLayout() {
        if (!this._enabled || this._terminalProcess)
            return;

        const commandArgv = this._commandArgv;
        if (!commandArgv)
            return;

        const generation = this._runGeneration;
        this._holdNewTerminalWindows = true;
        let process;
        try {
            process = Gio.Subprocess.new(
                commandArgv,
                Gio.SubprocessFlags.STDOUT_SILENCE |
                    Gio.SubprocessFlags.STDERR_SILENCE
            );
        } catch (error) {
            this._holdNewTerminalWindows = false;
            this._releasePreparedTerminalWindows();
            this._warn('Could not start the Multi Codex command', error);
            Main.notify(
                'Multi Codex',
                'Could not open the six-terminal workspace.'
            );
            return;
        }

        this._terminalProcess = process;
        this._terminalTimedOut = false;
        if (!this._armTerminalCommandTimeout(process, generation)) {
            this._terminalTimedOut = true;
            this._holdNewTerminalWindows = false;
            this._releasePreparedTerminalWindows();
            try {
                process.send_signal(15);
            } catch (error) {
                this._warn('Could not stop the Multi Codex command', error);
            }
        }
        process.wait_async(null, (subprocess, result) => {
            let successful = false;
            try {
                successful = subprocess.wait_finish(result) &&
                    subprocess.get_successful();
            } catch (error) {
                this._warn('Multi Codex command failed', error);
            }
            const isCurrent =
                this._terminalProcess === subprocess &&
                this._runGeneration === generation;
            const timedOut = isCurrent && this._terminalTimedOut;
            if (this._terminalProcess === subprocess) {
                this._terminalProcess = null;
                this._clearTerminalCommandSources();
                this._terminalTimedOut = false;
            }
            if (!this._enabled || !isCurrent)
                return;
            this._holdNewTerminalWindows = false;
            if (timedOut) {
                this._releasePreparedTerminalWindows();
                return;
            }
            if (successful) {
                if (!this._showTerminalWindows()) {
                    Main.notify(
                        'Multi Codex',
                        'The six-terminal workspace did not become available.'
                    );
                    this._releasePreparedTerminalWindows();
                } else {
                    this._schedulePreparedTerminalReveal();
                }
            } else {
                Main.notify(
                    'Multi Codex',
                    'The workspace is incomplete or could not be opened.'
                );
                this._releasePreparedTerminalWindows();
            }
        });
    }

    _showTerminalWindows() {
        let activeWorkspace;
        let focusBefore;
        let windows;
        try {
            activeWorkspace =
                global.workspace_manager.get_active_workspace();
            focusBefore = global.display.get_focus_window();
            windows = collectCompleteWorkspaceWindows(
                global.display.list_all_windows(),
                window => this._terminalNumber(window)
            );
        } catch (error) {
            this._warn('Could not inspect Terminal windows', error);
            return false;
        }
        if (!windows)
            return false;

        let allShown = true;
        for (const window of windows) {
            try {
                if (!window.located_on_workspace(activeWorkspace))
                    window.change_workspace(activeWorkspace);
                window.unminimize();
                window.raise();
            } catch (error) {
                allShown = false;
                this._warn('Could not show a Terminal window', error);
            }
        }

        if (windows.length) {
            try {
                const focus = windows.find(
                    window => window === focusBefore
                ) ?? windows[0];
                Main.activateWindow(focus, global.get_current_time());
            } catch (error) {
                allShown = false;
                this._warn('Could not focus a Terminal window', error);
            }
        }
        return allShown;
    }

    _terminalNumber(window) {
        if (!window)
            return 0;

        try {
            if (window.is_override_redirect())
                return 0;
            const pid = window.get_pid();
            if (pid > 0) {
                const [ok, contents] = GLib.file_get_contents(
                    `/proc/${pid}/cmdline`
                );
                if (ok) {
                    const args = new TextDecoder()
                        .decode(contents)
                        .split('\0')
                        .filter(Boolean);
                    const match = args.length === 3 &&
                        args[0] === '/usr/bin/ptyxis' &&
                        args[1] === '--standalone'
                        ? /^--title=Terminal ([1-6])$/.exec(args[2])
                        : null;
                    if (match)
                        return Number(match[1]);
                }
            }
        } catch {
            // Fail open for visibility: unproven windows are never hidden.
        }
        return 0;
    }

    _moveAfter(actor, target, anchor) {
        const source = this._parentOf(actor);
        const sourceIndex = this._indexOf(source, actor);
        const anchorIndex = this._indexOf(target, anchor);
        const actorIndex = this._indexOf(target, actor);
        if (anchorIndex < 0)
            return false;
        if (source === target && actorIndex === anchorIndex + 1)
            return true;

        if (source && !this._removeChild(source, actor))
            return false;

        const liveAnchorIndex = this._indexOf(target, anchor);
        if (liveAnchorIndex < 0 ||
            !this._insertChild(target, actor, liveAnchorIndex + 1)) {
            if (source)
                this._restoreDetached(actor, source, sourceIndex);
            return false;
        }
        return this._parentOf(actor) === target;
    }

    _restoreDetached(actor, target, requestedIndex) {
        if (this._parentOf(actor) || !this._isContainer(target))
            return;
        const insertionIndex = requestedIndex >= 0
            ? Math.min(requestedIndex, this._childrenOf(target).length)
            : this._childrenOf(target).length;
        this._insertChild(target, actor, insertionIndex);
    }

    _isActor(actor) {
        return Boolean(actor) &&
            typeof actor.get_parent === 'function' &&
            typeof actor.add_style_class_name === 'function' &&
            typeof actor.remove_style_class_name === 'function';
    }

    _isContainer(actor) {
        return Boolean(actor) &&
            typeof actor.get_children === 'function' &&
            typeof actor.remove_child === 'function' &&
            typeof actor.insert_child_at_index === 'function';
    }

    _parentOf(actor) {
        if (!this._isActor(actor))
            return null;
        try {
            return actor.get_parent();
        } catch (error) {
            this._warn('Could not read an actor parent', error);
            return null;
        }
    }

    _childrenOf(container) {
        if (!this._isContainer(container))
            return [];
        try {
            return container.get_children();
        } catch (error) {
            this._warn('Could not read panel children', error);
            return [];
        }
    }

    _indexOf(container, actor) {
        if (!container || !actor)
            return -1;
        return this._childrenOf(container).indexOf(actor);
    }

    _removeChild(container, actor) {
        if (!this._isContainer(container))
            return false;
        try {
            container.remove_child(actor);
            return true;
        } catch (error) {
            this._warn('Could not remove the Multi Codex button', error);
            return false;
        }
    }

    _insertChild(container, actor, index) {
        if (!this._isContainer(container))
            return false;
        try {
            container.insert_child_at_index(actor, index);
            return true;
        } catch (error) {
            this._warn('Could not insert the Multi Codex button', error);
            return false;
        }
    }

    _warn(message, error) {
        try {
            console.warn(`[${this.uuid}] ${message}: ${error}`);
        } catch {
            // Never let diagnostics break panel cleanup.
        }
    }
}
