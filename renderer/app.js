const $ = (s) => document.querySelector(s);

const MODS = [
  { slug: 'sodium', name: 'Sodium', desc: 'Motor de renderizado: más FPS', on: true },
  { slug: 'lithium', name: 'Lithium', desc: 'Optimiza lógica del juego y servidor', on: true },
  { slug: 'ferrite-core', name: 'FerriteCore', desc: 'Reduce el uso de memoria', on: true },
  { slug: 'immediatelyfast', name: 'ImmediatelyFast', desc: 'Acelera el renderizado de interfaz', on: true },
  { slug: 'entityculling', name: 'Entity Culling', desc: 'No dibuja entidades ocultas', on: true },
  { slug: 'modernfix', name: 'ModernFix', desc: 'Arranque más rápido y menos RAM', on: false },
];

const PRESETS = [
  [854, 480], [1280, 720], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160],
];

let versions = [];
let selected = null;
let sys = null;
let loggedIn = false;
let busy = false;

function refreshPlay() {
  $('#play').disabled = !(selected && loggedIn && !busy);
}

function setProgress(done, total, label) {
  const bar = $('#bar');
  bar.hidden = !total;
  if (total) {
    bar.max = total;
    bar.value = done;
    bar.title = `${label}: ${done}/${total}`;
  }
}

async function loadAccount() {
  const st = await window.fox.authStatus();
  loggedIn = st.loggedIn;
  $('#accountState').textContent = st.loggedIn ? `Sesión iniciada: ${st.name}` : 'Sin sesión';
  $('#loginBtn').hidden = st.loggedIn;
  $('#logoutBtn').hidden = !st.loggedIn;
  refreshPlay();
}

function save() {
  try {
    localStorage.setItem('fox', JSON.stringify({
      mods: MODS.filter((m) => $(`#mod-${m.slug}`).checked).map((m) => m.slug),
      mode: document.querySelector('input[name=mode]:checked').value,
      preset: $('#preset').value, w: $('#w').value, h: $('#h').value,
      ram: $('#ram').value, version: selected,
    }));
  } catch { /* sin almacenamiento: no pasa nada */ }
}

function load() {
  try { return JSON.parse(localStorage.getItem('fox')) || {}; } catch { return {}; }
}

function log(level, msg) {
  const line = document.createElement('div');
  line.className = level;
  line.textContent = msg;
  $('#log').append(line);
  while ($('#log').childElementCount > 400) $('#log').firstElementChild.remove();
  $('#log').scrollTop = $('#log').scrollHeight;
}

function setMenu(open) {
  $('#versionMenu').hidden = !open;
  $('#versionBtn').setAttribute('aria-expanded', String(open));
  if (open) $('#filter').focus();
}

function renderVersions() {
  const q = $('#filter').value.trim();
  const list = $('#versionList');
  list.replaceChildren();
  versions.filter((v) => v.id.includes(q)).forEach((v) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(v.id === selected));
    const name = document.createElement('span');
    name.textContent = v.id;
    b.append(name);
    if (v.id === versions[0].id) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = 'Última';
      b.append(t);
    }
    b.addEventListener('click', () => {
      selected = v.id;
      refreshPlay();
      $('#versionLabel').textContent = `Minecraft ${selected}`;
      setMenu(false);
      renderVersions();
      save();
    });
    li.append(b);
    list.append(li);
  });
}

function updateDisplayUi() {
  const mode = document.querySelector('input[name=mode]:checked').value;
  $('#winOpts').hidden = mode !== 'windowed';
  $('#custom').hidden = $('#preset').value !== 'custom';
}

function currentDisplay() {
  const mode = document.querySelector('input[name=mode]:checked').value;
  if (mode !== 'windowed') return { mode };
  const p = $('#preset').value;
  if (p === 'custom') return { mode, width: +$('#w').value, height: +$('#h').value };
  const [width, height] = p.split('x').map(Number);
  return { mode, width, height };
}

async function loadVersions() {
  $('#versionLabel').textContent = 'Cargando versiones…';
  const res = await window.fox.listVersions();
  if (!res.ok) {
    $('#versionState').textContent = `No se pudo cargar la lista (${res.error}). Reintentando en 5 s…`;
    setTimeout(loadVersions, 5000);
    return;
  }
  versions = res.versions;
  $('#versionState').textContent = `${versions.length} versiones disponibles (1.20 → ${versions[0].id})`;
  const saved = load();
  if (saved.version && versions.some((v) => v.id === saved.version)) {
    selected = saved.version;
    refreshPlay();
  }
  $('#versionLabel').textContent = selected ? `Minecraft ${selected}` : 'Selecciona una versión';
  renderVersions();
}

async function init() {
  sys = await window.fox.systemInfo();
  const saved = load();

  // Mods
  const modsBox = $('#mods');
  MODS.forEach((m) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `mod-${m.slug}`;
    cb.checked = saved.mods ? saved.mods.includes(m.slug) : m.on;
    cb.addEventListener('change', save);
    const small = document.createElement('small');
    small.textContent = m.desc;
    label.append(cb, ` ${m.name}`, small);
    modsBox.append(label);
  });

  // Resoluciones: las predefinidas que caben en el monitor + la nativa + personalizada
  const preset = $('#preset');
  const add = (value, text) => preset.append(new Option(text, value));
  PRESETS.filter(([w, h]) => w <= sys.screen.width && h <= sys.screen.height)
    .forEach(([w, h]) => add(`${w}x${h}`, `${w} × ${h}`));
  const native = `${sys.screen.width}x${sys.screen.height}`;
  if (![...preset.options].some((o) => o.value === native)) add(native, `${sys.screen.width} × ${sys.screen.height} (nativa)`);
  add('custom', 'Personalizada…');

  if (saved.preset && [...preset.options].some((o) => o.value === saved.preset)) preset.value = saved.preset;
  else preset.value = native;
  if (saved.w) $('#w').value = saved.w;
  if (saved.h) $('#h').value = saved.h;
  if (saved.mode) document.querySelector(`input[name=mode][value=${saved.mode}]`).checked = true;

  // RAM
  const maxRam = Math.max(2, Math.min(16, sys.totalRamGb - 2));
  $('#ram').max = String(maxRam);
  $('#ram').value = String(Math.min(saved.ram || 4, maxRam));
  $('#ramVal').textContent = $('#ram').value;

  $('#ram').addEventListener('input', () => { $('#ramVal').textContent = $('#ram').value; save(); });
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', () => { updateDisplayUi(); save(); }));
  [preset, $('#w'), $('#h')].forEach((el) => el.addEventListener('change', () => { updateDisplayUi(); save(); }));
  $('#filter').addEventListener('input', renderVersions);
  $('#versionBtn').addEventListener('click', () => setMenu($('#versionMenu').hidden));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setMenu(false);
  });

  $('#play').addEventListener('click', async () => {
    busy = true;
    refreshPlay();
    $('#log').replaceChildren();
    const res = await window.fox.play({
      version: selected,
      mods: MODS.filter((m) => $(`#mod-${m.slug}`).checked).map((m) => m.slug),
      ramGb: +$('#ram').value,
      display: currentDisplay(),
    });
    // Si arrancó, el estado lo controla 'game:state'; si falló, se libera aquí.
    if (!res.ok) busy = false;
    setProgress(0, 0);
    refreshPlay();
  });

  $('#loginBtn').addEventListener('click', async () => {
    $('#loginBtn').disabled = true;
    const res = await window.fox.login();
    $('#codeBox').hidden = true;
    $('#loginBtn').disabled = false;
    if (!res.ok) log('error', res.error);
    await loadAccount();
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await window.fox.logout();
    await loadAccount();
  });

  window.fox.onLog((e) => log(e.level, e.msg));
  window.fox.onProgress((p) => setProgress(p.done, p.total, p.label));
  window.fox.onAuthCode((c) => {
    const box = $('#codeBox');
    box.hidden = false;
    box.replaceChildren('Escribe este código en ', c.uri, ': ');
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = c.userCode;
    box.append(code);
  });
  window.fox.onGameState((g) => {
    busy = g.running;
    $('#play').textContent = g.running ? 'Jugando…' : 'Jugar';
    refreshPlay();
  });

  await loadAccount();

  updateDisplayUi();
  loadVersions();
}

init();
