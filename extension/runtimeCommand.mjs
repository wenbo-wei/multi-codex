export function runtimeCommandArgv(extensionPath, buildPath) {
    return [
        buildPath([extensionPath, 'scripts', 'multi-codex']),
        '--panel',
    ];
}
