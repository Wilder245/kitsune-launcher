const fs = require('fs');
const path = require('path');
const { getJson } = require('./http');

const META = 'https://meta.fabricmc.net/v2';

// Instala el perfil de versión de Fabric en .minecraft/versions para que el
// launcher oficial lo reconozca. Devuelve el id de versión (lastVersionId).
async function installFabric(mcDir, gameVersion, log) {
  let loaders;
  try {
    loaders = await getJson(`${META}/versions/loader/${encodeURIComponent(gameVersion)}`);
  } catch {
    loaders = [];
  }
  if (!Array.isArray(loaders) || loaders.length === 0) {
    throw new Error(`Fabric todavía no soporta Minecraft ${gameVersion}`);
  }
  const chosen = loaders.find((l) => l.loader.stable) || loaders[0];
  const loader = chosen.loader.version;
  const id = `fabric-loader-${loader}-${gameVersion}`;
  const file = path.join(mcDir, 'versions', id, `${id}.json`);

  if (fs.existsSync(file)) {
    log('info', `Fabric Loader ${loader} ya estaba instalado`);
    return id;
  }
  log('info', `Descargando Fabric Loader ${loader}…`);
  const profile = await getJson(
    `${META}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loader)}/profile/json`
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(profile, null, 2));
  return id;
}

module.exports = { installFabric };
