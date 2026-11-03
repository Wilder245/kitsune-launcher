const { getJson } = require('./http');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const FIRST_VERSION = '1.20';


// Todas las releases desde 1.20 en adelante. Se filtra por fecha de publicación
// y no por número, así sigue funcionando con el nuevo esquema de versiones (26.x...).
async function listVersions() {
  const manifest = await getJson(MANIFEST);
  const first = manifest.versions.find((v) => v.id === FIRST_VERSION);
  if (!first) throw new Error(`No se encontró ${FIRST_VERSION} en el manifiesto de Mojang`);
  const cutoff = new Date(first.releaseTime).getTime();
  return manifest.versions
    .filter((v) => v.type === 'release' && new Date(v.releaseTime).getTime() >= cutoff)
    .map((v) => ({ id: v.id, releaseTime: v.releaseTime }));
}

module.exports = { listVersions };
