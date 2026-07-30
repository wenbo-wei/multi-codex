import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';


const SHELL_SCHEMA = 'org.gnome.shell';
const ENABLED_KEY = 'enabled-extensions';
const DISABLED_KEY = 'disabled-extensions';
const EXTENSION_UUID = 'multi-codex@wenbo';
const LEGACY_UUID = 'workspace@wenbo';


function shellSettings() {
    const source = Gio.SettingsSchemaSource.get_default();
    const schema = source?.lookup(SHELL_SCHEMA, true);
    if (!schema ||
        !schema.has_key(ENABLED_KEY) ||
        !schema.has_key(DISABLED_KEY))
        throw new Error(`required settings schema is unavailable: ${SHELL_SCHEMA}`);
    return new Gio.Settings({settings_schema: schema});
}


function unique(values) {
    return [...new Set(values)];
}


function without(values, ...removed) {
    const removedSet = new Set(removed);
    return values.filter(value => !removedSet.has(value));
}


function state(settings) {
    return {
        enabled: unique(settings.get_strv(ENABLED_KEY)),
        disabled: unique(settings.get_strv(DISABLED_KEY)),
    };
}


function writeState(settings, next) {
    writeExactState(settings, {
        enabled: unique(next.enabled),
        disabled: unique(next.disabled),
    });
}


function writeExactState(settings, next) {
    settings.delay();
    if (!settings.set_strv(ENABLED_KEY, next.enabled) ||
        !settings.set_strv(DISABLED_KEY, next.disabled)) {
        settings.revert();
        throw new Error('could not update GNOME Shell extension settings');
    }
    settings.apply();
    Gio.Settings.sync();
}


function snapshot(settings, path) {
    const contents = JSON.stringify({
        enabled: settings.get_strv(ENABLED_KEY),
        disabled: settings.get_strv(DISABLED_KEY),
    });
    const written = GLib.file_set_contents(path, contents);
    if (!written)
        throw new Error(`could not write settings snapshot: ${path}`);
}


function restore(settings, path) {
    const [read, bytes] = GLib.file_get_contents(path);
    if (!read)
        throw new Error(`could not read settings snapshot: ${path}`);

    let saved;
    try {
        saved = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
        throw new Error(`invalid settings snapshot: ${error.message}`);
    }
    if (!Array.isArray(saved?.enabled) ||
        !saved.enabled.every(value => typeof value === 'string') ||
        !Array.isArray(saved?.disabled) ||
        !saved.disabled.every(value => typeof value === 'string'))
        throw new Error('invalid settings snapshot: expected string arrays');
    writeExactState(settings, saved);
}


function includes(values, uuid) {
    return values.includes(uuid);
}


function queueCleanInstall(settings) {
    const current = state(settings);
    if (includes(current.enabled, LEGACY_UUID))
        throw new Error('legacy Workspace is enabled; safe migration is required');
    writeState(settings, {
        enabled: [
            ...without(current.enabled, EXTENSION_UUID),
            EXTENSION_UUID,
        ],
        disabled: [
            ...without(current.disabled, EXTENSION_UUID, LEGACY_UUID),
            LEGACY_UUID,
        ],
    });
}


function prepareMigration(settings) {
    const current = state(settings);
    if (!includes(current.enabled, LEGACY_UUID))
        throw new Error('legacy Workspace is no longer enabled');
    writeState(settings, {
        enabled: [
            ...without(current.enabled, EXTENSION_UUID),
            EXTENSION_UUID,
        ],
        disabled: without(current.disabled, EXTENSION_UUID),
    });
}


function retireLegacy(settings) {
    const current = state(settings);
    if (!includes(current.enabled, EXTENSION_UUID))
        throw new Error('Multi Codex is not enabled');
    writeState(settings, {
        enabled: without(current.enabled, LEGACY_UUID),
        disabled: [
            ...without(current.disabled, LEGACY_UUID),
            LEGACY_UUID,
        ],
    });
}


function uninstall(settings) {
    const current = state(settings);
    writeState(settings, {
        enabled: without(current.enabled, EXTENSION_UUID),
        disabled: [
            ...without(current.disabled, EXTENSION_UUID),
            EXTENSION_UUID,
        ],
    });
}


function main() {
    if (ARGV.length < 1)
        throw new Error('expected a settings operation');
    const settings = shellSettings();
    switch (ARGV[0]) {
    case 'snapshot':
        if (ARGV.length !== 2)
            throw new Error('expected snapshot PATH');
        snapshot(settings, ARGV[1]);
        break;
    case 'restore':
        if (ARGV.length !== 2)
            throw new Error('expected restore PATH');
        restore(settings, ARGV[1]);
        break;
    case 'legacy-enabled':
        if (ARGV.length !== 1)
            throw new Error('legacy-enabled takes no arguments');
        System.exit(
            includes(state(settings).enabled, LEGACY_UUID) ? 0 : 3
        );
        break;
    case 'queue-clean':
        if (ARGV.length !== 1)
            throw new Error('queue-clean takes no arguments');
        queueCleanInstall(settings);
        break;
    case 'prepare-migration':
        if (ARGV.length !== 1)
            throw new Error('prepare-migration takes no arguments');
        prepareMigration(settings);
        break;
    case 'retire-legacy':
        if (ARGV.length !== 1)
            throw new Error('retire-legacy takes no arguments');
        retireLegacy(settings);
        break;
    case 'uninstall':
        if (ARGV.length !== 1)
            throw new Error('uninstall takes no arguments');
        uninstall(settings);
        break;
    default:
        throw new Error(`unknown settings operation: ${ARGV[0]}`);
    }
}


try {
    main();
} catch (error) {
    printerr(`multi-codex settings: ${error.message}`);
    System.exit(1);
}
