const fs = require('fs');
const path = require('path');
const { getJson, download } = require('./http');

const API = 'https://api.modrinth.com/v2';
const MANAGED_FILE = '.foxlauncher-mods.json';

function removeManagedMods(gameDir) {
  const modsDir = path.join(gameDir, 'mods');
  const listFile = path.join(gameDir, MANAGED_FILE);
  if (!fs.existsSync(listFile)) return;
  try {
    for (const name of JSON.parse(fs.readFileSync(listFile, 'utf8'))) {
      fs.rmSync(path.join(modsDir, name), { force: true });
    }
  } catch {
    /* lista corrupta: se ignora */
  }
}

// Instala los mods pedidos (slugs de Modrinth) más sus dependencias obligatorias.
// Los que no existan para esa versión se omiten y se devuelven en `missing`.
async function installMods(gameDir, gameVersion, slugs, log) {
  removeManagedMods(gameDir);
  const modsDir = path.join(gameDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });

  const queue = [...slugs];
  const seen = new Set();
  const installed = [];
  const missing = [];
  const query = `game_versions=${encodeURIComponent(JSON.stringify([gameVersion]))}&loaders=${encodeURIComponent('["fabric"]')}`;

  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);

    const versions = await getJson(`${API}/project/${encodeURIComponent(id)}/version?${query}`);
    if (!versions.length) {
      missing.push(id);
      log('warn', `${id}: aún no disponible para ${gameVersion}, se omite`);
      continue;
    }
    // Más reciente primero; se prefiere una release estable sobre beta/alpha.
    const v = versions.find((x) => x.version_type === 'release') || versions[0];
    seen.add(v.project_id);

    const file = v.files.find((f) => f.primary) || v.files[0];
    log('info', `Descargando ${file.filename}…`);
    await download(file.url, path.join(modsDir, file.filename), { sha512: file.hashes && file.hashes.sha512 });
    installed.push(file.filename);

    for (const dep of v.dependencies || []) {
      if (dep.dependency_type === 'required' && dep.project_id) queue.push(dep.project_id);
    }
  }

  fs.writeFileSync(path.join(gameDir, MANAGED_FILE), JSON.stringify(installed));
  return { installed, missing };
}

module.exports = { installMods };
