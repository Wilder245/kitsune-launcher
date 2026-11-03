const { app, BrowserWindow, ipcMain, screen, safeStorage, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { rootDir } = require('./lib/paths');
const { listVersions } = require('./lib/minecraft');
const { installFabric } = require('./lib/fabric');
const { installMods } = require('./lib/modrinth');
const { ensureVanilla, installGame } = require('./lib/installer');
const { startGame } = require('./lib/launch');
const auth = require('./lib/auth');

const ROOT = rootDir();
const ACCOUNT_FILE = path.join(ROOT, 'account.json');

let win;
let gameProc = null;
let session = null; // { accessToken, expiresAt, profile } en memoria
let loginAbort = null;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(720, height),
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#c9033f',
    title: 'Kitsune Launcher',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};
const log = (level, msg) => send('log', { level, msg });
const progress = (label, done, total) => send('progress', { label, done, total });

// ---- Config y cuenta ----------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Identifica al launcher (no al jugador). Es público; puede sustituirse con KITSUNE_CLIENT_ID.
const DEFAULT_CLIENT_ID = '6025a88c-682a-45f8-af41-dc999d503c48';

function clientId() {
  return process.env.KITSUNE_CLIENT_ID || DEFAULT_CLIENT_ID;
}

// El refresh token se guarda cifrado con el almacén seguro del sistema (DPAPI en Windows).
function saveAccount(refreshToken, profile) {
  if (!safeStorage.isEncryptionAvailable()) return;
  writeJson(ACCOUNT_FILE, { refresh: safeStorage.encryptString(refreshToken).toString('base64'), profile });
}

function loadAccount() {
  const data = readJson(ACCOUNT_FILE);
  if (!data || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return { refreshToken: safeStorage.decryptString(Buffer.from(data.refresh, 'base64')), profile: data.profile };
  } catch {
    return null;
  }
}

async function getSession() {
  if (session && session.expiresAt > Date.now()) return session;
  const id = clientId();
  const acc = loadAccount();
  if (!id || !acc) throw new Error('Inicia sesión con Microsoft para jugar.');
  const ms = await auth.refreshMicrosoftToken(id, acc.refreshToken);
  session = await auth.minecraftSession(ms.access_token);
  if (ms.refresh_token) saveAccount(ms.refresh_token, session.profile);
  return session;
}

ipcMain.handle('system:info', () => {
  const d = screen.getPrimaryDisplay();
  return {
    screen: { width: d.size.width, height: d.size.height },
    totalRamGb: Math.floor(os.totalmem() / 1024 ** 3),
    root: ROOT,
  };
});

ipcMain.handle('auth:status', () => {
  const acc = loadAccount();
  return { loggedIn: !!acc, name: acc && acc.profile.name };
});

ipcMain.handle('auth:login', async () => {
  const id = clientId();
  try {
    loginAbort = new AbortController();
    const dc = await auth.requestDeviceCode(id);
    send('auth:code', { userCode: dc.user_code, uri: dc.verification_uri });
    shell.openExternal(dc.verification_uri);
    const ms = await auth.pollDeviceCode(id, dc, loginAbort.signal);
    session = await auth.minecraftSession(ms.access_token);
    saveAccount(ms.refresh_token, session.profile);
    return { ok: true, name: session.profile.name };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    loginAbort = null;
  }
});

ipcMain.handle('auth:logout', () => {
  if (loginAbort) loginAbort.abort();
  session = null;
  fs.rmSync(ACCOUNT_FILE, { force: true });
  return { ok: true };
});

// ---- Versiones y juego ---------------------------------------------------

ipcMain.handle('versions:list', async () => {
  try {
    return { ok: true, versions: await listVersions() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('play', async (_e, req) => {
  if (gameProc) return { ok: false, error: 'El juego ya está en ejecución.' };
  try {
    const version = String(req.version);
    const ramGb = Math.min(Math.max(parseInt(req.ramGb, 10) || 4, 1), 64);
    const display = {
      mode: req.display && req.display.mode,
      width: parseInt(req.display && req.display.width, 10),
      height: parseInt(req.display && req.display.height, 10),
    };

    const acct = await getSession();
    log('info', `Sesión: ${acct.profile.name}`);

    await ensureVanilla(ROOT, version, log);
    const versionId = await installFabric(ROOT, version, log);
    const javaPath = await installGame(ROOT, versionId, log, progress);

    const gameDir = path.join(ROOT, 'instances', version);
    const slugs = (req.mods || []).filter((s) => /^[\w-]+$/.test(s));
    const { missing } = await installMods(gameDir, version, slugs, log);
    if (missing.length) log('warn', `Sin soporte aún para ${version}: ${missing.join(', ')}`);

    progress('', 0, 0);
    log('ok', `Iniciando Minecraft ${version}…`);
    gameProc = await startGame({
      root: ROOT,
      gameDir,
      versionId,
      javaPath,
      session: acct,
      ramGb,
      display,
      onOutput: log,
      onExit: (code) => {
        gameProc = null;
        send('game:state', { running: false });
        log(code === 0 ? 'ok' : 'error', `El juego se cerró (código ${code}).`);
      },
    });
    send('game:state', { running: true });
    return { ok: true };
  } catch (e) {
    gameProc = null;
    log('error', e.message);
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
