const fs = require('fs');
const path = require('path');
const { Version, MinecraftFolder } = require('@xmcl/core');
const { getJson, download, pool } = require('./http');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RUNTIME_ALL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const ASSET_HOST = 'https://resources.download.minecraft.net';
const CONCURRENCY = 16;

// Descarga el JSON y el .jar del cliente vanilla desde los servidores de Mojang.
async function ensureVanilla(root, id, log) {
  const jsonPath = path.join(root, 'versions', id, `${id}.json`);
  if (!fs.existsSync(jsonPath)) {
    const manifest = await getJson(MANIFEST);
    const entry = manifest.versions.find((v) => v.id === id);
    if (!entry) throw new Error(`Minecraft ${id} no existe en el manifiesto de Mojang`);
    log('info', `Descargando metadatos de ${id}…`);
    await download(entry.url, jsonPath, { sha1: entry.sha1 });
  }
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const client = json.downloads.client;
  await download(client.url, path.join(root, 'versions', id, `${id}.jar`), { sha1: client.sha1, size: client.size });
}

// Librerías, índice de assets, objetos de assets y configuración de logging.
async function ensureLibrariesAndAssets(root, resolved, log, progress) {
  const libs = resolved.libraries.map((l) => ({
    url: l.download.url,
    dest: path.join(root, 'libraries', l.download.path),
    sha1: l.download.sha1,
    size: l.download.size,
  }));
  log('info', `Verificando ${libs.length} librerías…`);
  let done = 0;
  await pool(libs, CONCURRENCY, async (f) => {
    await download(f.url, f.dest, { sha1: f.sha1, size: f.size });
    progress('Librerías', ++done, libs.length);
  });

  const idx = resolved.assetIndex;
  if (idx) {
    const indexPath = path.join(root, 'assets', 'indexes', `${idx.id}.json`);
    await download(idx.url, indexPath, { sha1: idx.sha1, size: idx.size });
    const objects = Object.values(JSON.parse(fs.readFileSync(indexPath, 'utf8')).objects);
    log('info', `Verificando ${objects.length} assets…`);
    done = 0;
    await pool(objects, CONCURRENCY, async (o) => {
      const pre = o.hash.slice(0, 2);
      await download(`${ASSET_HOST}/${pre}/${o.hash}`, path.join(root, 'assets', 'objects', pre, o.hash), {
        sha1: o.hash,
        size: o.size,
      });
      if (++done % 50 === 0 || done === objects.length) progress('Assets', done, objects.length);
    });
  }

  const logFile = resolved.logging && resolved.logging.client && resolved.logging.client.file;
  if (logFile) {
    await download(logFile.url, path.join(root, 'assets', 'log_configs', logFile.id), { sha1: logFile.sha1, size: logFile.size });
  }
}

function runtimePlatform() {
  const a = process.arch;
  if (process.platform === 'win32') return a === 'arm64' ? 'windows-arm64' : a === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (process.platform === 'darwin') return a === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return a === 'ia32' ? 'linux-i386' : 'linux';
}

// Java oficial de Mojang (el componente que cada versión pide), sin depender de un Java instalado.
async function ensureJava(root, component, log, progress) {
  const dir = path.join(root, 'runtime', component);
  const exe = path.join(dir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const marker = path.join(dir, '.complete');
  if (fs.existsSync(marker) && fs.existsSync(exe)) return exe;

  const all = await getJson(RUNTIME_ALL);
  const entry = all[runtimePlatform()] && all[runtimePlatform()][component] && all[runtimePlatform()][component][0];
  if (!entry) throw new Error(`Mojang no ofrece el runtime ${component} para ${runtimePlatform()}`);
  const manifest = await getJson(entry.manifest.url);
  const files = Object.entries(manifest.files);

  log('info', `Descargando Java (${component})…`);
  for (const [rel, f] of files) if (f.type === 'directory') fs.mkdirSync(path.join(dir, rel), { recursive: true });
  const toGet = files.filter(([, f]) => f.type === 'file');
  let done = 0;
  await pool(toGet, CONCURRENCY, async ([rel, f]) => {
    const raw = f.downloads.raw;
    const dest = path.join(dir, rel);
    await download(raw.url, dest, { sha1: raw.sha1, size: raw.size });
    if (f.executable && process.platform !== 'win32') fs.chmodSync(dest, 0o755);
    progress('Java', ++done, toGet.length);
  });
  fs.writeFileSync(marker, new Date().toISOString());
  return exe;
}

// Deja todo listo para lanzar `versionId` (vanilla o fabric-loader-*). Devuelve la ruta de Java.
async function installGame(root, versionId, log, progress) {
  const resolved = await Version.parse(new MinecraftFolder(root), versionId);
  await ensureLibrariesAndAssets(root, resolved, log, progress);
  const component = (resolved.javaVersion && resolved.javaVersion.component) || 'jre-legacy';
  return ensureJava(root, component, log, progress);
}

module.exports = { ensureVanilla, installGame };
