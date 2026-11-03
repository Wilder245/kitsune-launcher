const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'KitsuneLauncher/0.2.0';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

function hashOf(buf, algo) {
  return crypto.createHash(algo).update(buf).digest('hex');
}

// Descarga con reintentos. Si el archivo ya existe con el tamaño esperado se omite.
// opts: { sha1, sha512, size }
async function download(url, dest, opts = {}) {
  if (opts.size && fs.existsSync(dest) && fs.statSync(dest).size === opts.size) return false;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (opts.sha1 && hashOf(buf, 'sha1') !== opts.sha1) throw new Error(`SHA-1 inválido: ${path.basename(dest)}`);
      if (opts.sha512 && hashOf(buf, 'sha512') !== opts.sha512) throw new Error(`SHA-512 inválido: ${path.basename(dest)}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return true;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// Ejecuta fn sobre cada elemento con un máximo de `limit` tareas simultáneas.
async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

module.exports = { getJson, download, pool };
