const { launch } = require('@xmcl/core');

const GC_FLAGS = [
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+UseG1GC',
  '-XX:G1NewSizePercent=20',
  '-XX:G1ReservePercent=20',
  '-XX:MaxGCPauseMillis=50',
  '-XX:G1HeapRegionSize=32M',
];

// Lanza Java directamente con los argumentos generados desde el JSON de la versión.
async function startGame({ root, gameDir, versionId, javaPath, session, ramGb, display, onOutput, onExit }) {
  const resolution =
    display.mode === 'fullscreen'
      ? { fullscreen: true }
      : display.mode === 'windowed' && display.width > 0 && display.height > 0
        ? { width: display.width, height: display.height }
        : undefined;

  const proc = await launch({
    gamePath: gameDir,
    resourcePath: root,
    javaPath,
    version: versionId,
    gameProfile: session.profile,
    accessToken: session.accessToken,
    userType: 'msa',
    launcherName: 'KitsuneLauncher',
    launcherBrand: 'KitsuneLauncher',
    minMemory: Math.max(1, Math.floor(ramGb / 2)) * 1024,
    maxMemory: ramGb * 1024,
    resolution,
    extraJVMArgs: GC_FLAGS,
    extraExecOption: { windowsHide: true },
  });

  // El cliente escribe su log en XML (log4j): se deja solo el texto de cada mensaje.
  const forward = (level) => (d) =>
    String(d)
      .split(/\r?\n/)
      .filter((l) => l.trim() && !/^\s*<\/?log4j:Event/.test(l))
      .map((l) => l.replace(/^\s*<log4j:Message><!\[CDATA\[/, '').replace(/\]\]><\/log4j:Message>\s*$/, ''))
      .forEach((l) => onOutput(level, l));
  proc.stdout.on('data', forward('game'));
  proc.stderr.on('data', forward('game'));
  proc.on('exit', (code) => onExit(code));
  return proc;
}

module.exports = { startGame };
