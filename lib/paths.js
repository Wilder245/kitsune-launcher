const path = require('path');
const os = require('os');

// Carpeta propia del launcher: no toca ni depende de la .minecraft oficial.
function rootDir() {
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'KitsuneLauncher');
}

module.exports = { rootDir };
