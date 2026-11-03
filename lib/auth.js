// Login de Microsoft por "device code": no necesita redirecciones ni contraseñas dentro
// del launcher. El usuario introduce un código en microsoft.com/link.
// Requiere un Client ID de una app registrada en Azure (cliente público).

const SCOPE = 'XboxLive.signin offline_access';
const OAUTH = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';

const XSTS_ERRORS = {
  2148916233: 'Esta cuenta Microsoft no tiene perfil de Xbox. Entra una vez en minecraft.net para crearlo.',
  2148916235: 'Xbox Live no está disponible en tu país.',
  2148916238: 'Es una cuenta de menor de edad: debe añadirse a una Familia de Microsoft.',
};

async function post(url, body, asJson) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': asJson ? 'application/json' : 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: asJson ? JSON.stringify(body) : new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function requestDeviceCode(clientId) {
  const r = await post(`${OAUTH}/devicecode`, { client_id: clientId, scope: SCOPE }, false);
  if (!r.ok) throw new Error(r.data.error_description || `No se pudo iniciar el login (HTTP ${r.status})`);
  return r.data; // { device_code, user_code, verification_uri, expires_in, interval }
}

async function pollDeviceCode(clientId, dc, signal) {
  let interval = (dc.interval || 5) * 1000;
  const deadline = Date.now() + dc.expires_in * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    if (signal && signal.aborted) throw new Error('Login cancelado');
    const r = await post(
      `${OAUTH}/token`,
      { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: dc.device_code },
      false
    );
    if (r.ok) return r.data; // { access_token, refresh_token, expires_in }
    const err = r.data.error;
    if (err === 'authorization_pending') continue;
    if (err === 'slow_down') { interval += 5000; continue; }
    throw new Error(r.data.error_description || `Login rechazado (${err})`);
  }
  throw new Error('El código expiró, vuelve a intentarlo');
}

async function refreshMicrosoftToken(clientId, refreshToken) {
  const r = await post(
    `${OAUTH}/token`,
    { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken, scope: SCOPE },
    false
  );
  if (!r.ok) throw new Error('La sesión caducó, inicia sesión de nuevo');
  return r.data;
}

// Microsoft → Xbox Live → XSTS → Minecraft Services → perfil.
async function minecraftSession(msAccessToken) {
  const xbl = await post(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    },
    true
  );
  if (!xbl.ok) throw new Error('Falló el login de Xbox Live');

  const xsts = await post(
    'https://xsts.auth.xboxlive.com/xsts/authorize',
    {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.data.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    },
    true
  );
  if (!xsts.ok) throw new Error(XSTS_ERRORS[xsts.data.XErr] || 'Falló la autorización XSTS');

  const uhs = xsts.data.DisplayClaims.xui[0].uhs;
  const mc = await post(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    { identityToken: `XBL3.0 x=${uhs};${xsts.data.Token}` },
    true
  );
  if (!mc.ok) {
    throw new Error(
      mc.status === 403
        ? 'Minecraft rechazó la app (403). Tu Client ID de Azure debe estar aprobado por Mojang.'
        : `Falló el login de Minecraft (HTTP ${mc.status})`
    );
  }

  const prof = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mc.data.access_token}` },
  });
  if (prof.status === 404) throw new Error('Esta cuenta no posee Minecraft Java Edition.');
  if (!prof.ok) throw new Error(`No se pudo leer el perfil (HTTP ${prof.status})`);
  const p = await prof.json();

  return {
    accessToken: mc.data.access_token,
    expiresAt: Date.now() + (mc.data.expires_in - 60) * 1000,
    profile: { id: p.id, name: p.name },
  };
}

module.exports = { requestDeviceCode, pollDeviceCode, refreshMicrosoftToken, minecraftSession };
