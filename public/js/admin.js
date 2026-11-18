const COLORS = ['#5769e7', '#f17e73', '#2e3a6b', '#8f97e8', '#f3b06b', '#3fa98c', '#b45bb5', '#7c8597'];
const $ = (s) => document.querySelector(s);
const API = '/api/admin/' + pageToken;

let P = null; // data prezentace
let selected = 'settings';
let live = { currentId: null, results: null, paused: false };

/* --------------------------------------------------------------- ukládání */

let saveTimer = null;
let saving = Promise.resolve();
function setStatus(t, err) {
  const el = $('#status');
  el.textContent = t;
  el.classList.toggle('err', !!err);
}
function scheduleSave() {
  setStatus('Ukládám…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const body = JSON.stringify({ title: P.title, logo: P.logo, intro: P.intro, showQr: P.showQr, slides: P.slides });
  saving = saving.then(async () => {
    try {
      const r = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error();
      if (!saveTimer) setStatus('Uloženo');
    } catch {
      setStatus('Chyba ukládání – zkontrolujte připojení!', true);
    }
  });
  return saving;
}
async function flushSave() {
  if (saveTimer) await save();
  else await saving;
}
addEventListener('beforeunload', (e) => {
  if (saveTimer) {
    save();
    e.preventDefault();
  }
});

async function upload(file) {
  const fd = new FormData();
  fd.append('file', file);
  setStatus('Nahrávám obrázek…');
  const r = await fetch(API + '/upload', { method: 'POST', body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    setStatus(j.error || 'Nahrání selhalo', true);
    throw new Error(j.error);
  }
  setStatus('');
  return j.url;
}
function pickImage(cb) {
  const input = $('#file');
  input.value = '';
  input.onchange = async () => {
    if (!input.files[0]) return;
    try {
      cb(await upload(input.files[0]));
    } catch {}
  };
  input.click();
}

/* --------------------------------------------------------------- seznam */

const slideById = (id) => P.slides.find((s) => s.id === id);
const newId = () => 's' + Math.random().toString(36).slice(2, 10);

function renderList() {
  $('#htitle').textContent = P.title || 'Bez názvu';
  const items = [
    `<div class="item ${selected === 'settings' ? 'sel' : ''}" data-id="settings"><span class="n">⚙</span><span class="t">Nastavení a odkazy</span></div>`,
    ...P.slides.map(
      (s, i) => `<div class="item ${selected === s.id ? 'sel' : ''} ${live.currentId === s.id ? 'live' : ''}" data-id="${esc(s.id)}">
        <span class="n">${i + 1}</span>
        <span class="t">${esc(s.title || '(bez textu)')}</span>
        <span class="ty">${s.type === 'choice' ? 'otázka' : 'statický'}</span>
        <span class="mv"><button data-mv="-1" title="Nahoru">▲</button><button data-mv="1" title="Dolů">▼</button></span>
      </div>`
    ),
  ];
  $('#list').innerHTML = items.join('');
}

$('#list').addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (!item) return;
  const id = item.dataset.id;
  const mv = e.target.closest('[data-mv]');
  if (mv) {
    const i = P.slides.findIndex((s) => s.id === id);
    const j = i + Number(mv.dataset.mv);
    if (j < 0 || j >= P.slides.length) return;
    [P.slides[i], P.slides[j]] = [P.slides[j], P.slides[i]];
    scheduleSave();
    renderList();
    renderControls();
    return;
  }
  selected = id;
  renderList();
  renderEditor();
});

function addSlide(type) {
  const s =
    type === 'choice'
      ? { id: newId(), type, title: '', image: '', showPercent: true, options: [{ text: 'ANO', color: COLORS[0] }, { text: 'NE', color: COLORS[1] }] }
      : { id: newId(), type, title: '', image: '', showPercent: true, options: [] };
  const idx = P.slides.findIndex((x) => x.id === selected);
  P.slides.splice(idx >= 0 ? idx + 1 : P.slides.length, 0, s);
  selected = s.id;
  scheduleSave();
  renderList();
  renderEditor();
  renderControls();
  $('#editor textarea')?.focus();
}
$('#addChoice').onclick = () => addSlide('choice');
$('#addStatic').onclick = () => addSlide('static');

/* --------------------------------------------------------------- editor */

function imageField(label, hint, value, key) {
  return `<label class="f">${label} <span class="hint">${hint}</span></label>
    <div class="imgbox">
      ${value ? `<img src="${esc(value)}" alt="">` : ''}
      <button class="btn" data-upload="${key}">${value ? 'Změnit obrázek' : 'Nahrát obrázek'}</button>
      ${value ? `<button class="btn danger" data-clear="${key}">Odebrat</button>` : ''}
    </div>`;
}

function renderSettings() {
  const origin = P.publicUrl || location.origin;
  const link = (title, hint, url) => `<div class="l"><b>${title} <span class="hint">${hint}</span></b>
    <div><input type="text" readonly value="${esc(url)}"><button class="btn" data-copy="${esc(url)}">Kopírovat</button><a class="btn" href="${esc(url)}" target="_blank">↗</a></div></div>`;
  $('#editor').innerHTML = `
    <label class="f">Název prezentace <span class="hint">– zobrazí se na úvodní obrazovce s QR kódem</span></label>
    <input type="text" data-k="title" value="${esc(P.title)}">
    ${imageField('Logo', '– vpravo nahoře na plátně a nahoře v mobilu', P.logo, 'logo')}
    ${imageField('Úvodní grafika pro mobil', '– zobrazí se hlasujícím, dokud neběží otázka', P.intro, 'intro')}
    <label class="check"><input type="checkbox" data-k="showQr" ${P.showQr ? 'checked' : ''}> Zobrazovat malý QR kód v rohu u otázek</label>
    <h2 style="margin-top:28px">Odkazy</h2>
    <div class="links">
      ${link('Administrace', '– neveřejné, kdo má odkaz, může prezentaci upravovat', origin + '/a/' + P.adminToken)}
      ${link('Plátno', '– pro projektor / OBS (Browser Source 1920×1080)', origin + '/s/' + P.screenToken)}
      ${link('Hlasování', '– pro publikum, je v QR kódu', origin + '/v/' + P.voteToken)}
    </div>`;
}

function renderSlideEditor(s) {
  const opts =
    s.type === 'choice'
      ? `<label class="f">Možnosti <span class="hint">(max 8)</span></label>
      <div class="opts">${s.options
        .map(
          (o, i) => `<div class="o"><input type="color" data-oc="${i}" value="${esc(o.color)}">
            <input type="text" data-ot="${i}" value="${esc(o.text)}" placeholder="Možnost ${i + 1}">
            <button class="btn danger" data-odel="${i}" title="Odebrat">✕</button></div>`
        )
        .join('')}</div>
      ${s.options.length < 8 ? '<button class="btn" id="addOpt">+ Přidat možnost</button>' : ''}
      <label class="check"><input type="checkbox" data-k="showPercent" ${s.showPercent ? 'checked' : ''}> Zobrazovat výsledky v procentech (jinak počet hlasů)</label>`
      : '';
  const isLive = live.currentId === s.id;
  $('#editor').innerHTML = `
    <label class="f">Typ slajdu</label>
    <select data-k="type">
      <option value="static" ${s.type === 'static' ? 'selected' : ''}>Statický (obrázek + text)</option>
      <option value="choice" ${s.type === 'choice' ? 'selected' : ''}>Otázka – multiple choice</option>
    </select>
    <label class="f">${s.type === 'choice' ? 'Otázka' : 'Text'} <span class="hint">– Enter = nový řádek</span></label>
    <textarea data-k="title" rows="3">${esc(s.title)}</textarea>
    ${s.type === 'static' ? imageField('Obrázek', '– nad textem, přizpůsobí se velikosti', s.image, 'image') : ''}
    ${opts}
    <div class="row">
      <button class="btn primary" id="goHere" ${isLive ? 'disabled' : ''}>${isLive ? '● Právě se promítá' : 'Promítnout tento slajd'}</button>
      ${s.type === 'choice' ? '<button class="btn" id="resetVotes">Vynulovat hlasy</button>' : ''}
      <button class="btn danger" id="delSlide" style="margin-left:auto">Smazat slajd</button>
    </div>`;
}

function renderEditor() {
  const s = slideById(selected);
  if (!s) selected = 'settings';
  s ? renderSlideEditor(s) : renderSettings();
}

const target = () => slideById(selected) || P;

$('#editor').addEventListener('input', (e) => {
  const el = e.target;
  const t = target();
  if (el.dataset.k) {
    const k = el.dataset.k;
    t[k] = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'type') {
      if (t.type === 'choice' && !t.options.length) t.options = [{ text: 'ANO', color: COLORS[0] }, { text: 'NE', color: COLORS[1] }];
      renderEditor();
    }
  } else if (el.dataset.ot !== undefined) t.options[el.dataset.ot].text = el.value;
  else if (el.dataset.oc !== undefined) t.options[el.dataset.oc].color = el.value;
  else return;
  scheduleSave();
  renderList();
});

$('#editor').addEventListener('click', async (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  const t = target();
  const s = slideById(selected);
  if (el.dataset.copy) {
    navigator.clipboard?.writeText(el.dataset.copy);
    el.textContent = 'Zkopírováno';
    setTimeout(() => (el.textContent = 'Kopírovat'), 1200);
  } else if (el.dataset.upload) {
    pickImage((url) => {
      t[el.dataset.upload] = url;
      scheduleSave();
      renderEditor();
    });
  } else if (el.dataset.clear) {
    t[el.dataset.clear] = '';
    scheduleSave();
    renderEditor();
  } else if (el.dataset.odel !== undefined) {
    if (s.options.length <= 1) return;
    s.options.splice(Number(el.dataset.odel), 1);
    scheduleSave();
    renderEditor();
  } else if (el.id === 'addOpt') {
    s.options.push({ text: '', color: COLORS[s.options.length % COLORS.length] });
    scheduleSave();
    renderEditor();
    $(`[data-ot="${s.options.length - 1}"]`)?.focus();
  } else if (el.id === 'goHere') {
    goto(s.id);
  } else if (el.id === 'resetVotes') {
    if (confirm('Opravdu smazat všechny hlasy u této otázky?')) socket.emit('reset', { slideId: s.id });
  } else if (el.id === 'delSlide') {
    if (!confirm('Smazat tento slajd?')) return;
    const i = P.slides.indexOf(s);
    P.slides.splice(i, 1);
    selected = P.slides[Math.min(i, P.slides.length - 1)]?.id || 'settings';
    scheduleSave();
    renderList();
    renderEditor();
    renderControls();
  }
});

/* --------------------------------------------------------------- odkazy */

function renderUrls() {
  const origin = P.publicUrl || location.origin;
  const items = [
    ['Administrace', 'jen pro vás – neposílat dál', origin + '/a/' + P.adminToken],
    ['Plátno', 'projektor / OBS', origin + '/s/' + P.screenToken],
    ['Hlasování', 'pro publikum (v QR kódu)', origin + '/v/' + P.voteToken],
  ];
  $('#urls').innerHTML = items
    .map(
      ([title, hint, url]) => `<div class="url"><b>${title}</b><span class="hint">${hint}</span>
        <code>${esc(url)}</code>
        <div><button class="btn" data-copy="${esc(url)}">Kopírovat</button><a class="btn" href="${esc(url)}" target="_blank">Otevřít ↗</a></div></div>`
    )
    .join('');
}
$('#urls').addEventListener('click', (e) => {
  const el = e.target.closest('[data-copy]');
  if (!el) return;
  navigator.clipboard?.writeText(el.dataset.copy);
  el.textContent = 'Zkopírováno';
  setTimeout(() => (el.textContent = 'Kopírovat'), 1200);
});

/* --------------------------------------------------------------- ovládání */

async function goto(id) {
  await flushSave(); // nový / upravený slajd musí být na serveru dřív, než ho promítneme
  socket.emit('goto', { slideId: id });
}
function step(d) {
  const order = [null, ...P.slides.map((s) => s.id)];
  const i = order.indexOf(live.currentId);
  const j = Math.max(0, Math.min(order.length - 1, (i < 0 ? 0 : i) + d));
  if (j !== i) goto(order[j]);
}
$('#prev').onclick = () => step(-1);
$('#next').onclick = () => step(1);
$('#lobby').onclick = () => goto(null);
$('#pause').onclick = () => {
  if (live.currentId) socket.emit('pause', { slideId: live.currentId, paused: !live.paused });
};
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (['ArrowRight', 'PageDown'].includes(e.key)) { e.preventDefault(); step(1); }
  if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); step(-1); }
});

function renderControls() {
  const i = P.slides.findIndex((s) => s.id === live.currentId);
  const s = P.slides[i];
  $('#now').innerHTML = s
    ? `Promítá se: <b>${i + 1}. ${esc(s.title || '(bez textu)')}</b>`
    : 'Promítá se: <b>Úvod s QR kódem</b>';
  $('#prev').disabled = !s;
  $('#next').disabled = i === P.slides.length - 1;
  const pause = $('#pause');
  pause.hidden = !(s && s.type === 'choice');
  pause.textContent = live.paused ? '▶ Obnovit sběr hlasů' : '⏸ Pozastavit sběr hlasů';
  pause.classList.toggle('dark', live.paused);
  const r = live.results;
  $('#sVotes').textContent = s && s.type === 'choice' && r ? r.total : '–';
}

/* --------------------------------------------------------------- start */

const socket = io({ auth: { token: pageToken } });
socket.on('state', (st) => {
  const changed = live.currentId !== st.currentId;
  live = { currentId: st.currentId, results: st.results, paused: st.paused };
  if (!P) return;
  renderControls();
  if (changed) {
    renderList();
    if (selected !== 'settings' && document.activeElement?.closest('#editor') == null) renderEditor();
  }
});
socket.on('results', (r) => {
  live.results = r;
  if (P) renderControls();
});
socket.on('stats', (s) => ($('#sVoters').textContent = s.voters));
socket.on('connect', () => setStatus(''));
socket.on('disconnect', () => setStatus('Odpojeno od serveru – připojuji znovu…', true));

(async () => {
  P = await (await fetch(API)).json();
  live.currentId = live.currentId ?? P.currentId;
  $('#preview').src = '/s/' + P.screenToken;
  $('#openScreen').href = '/s/' + P.screenToken;
  selected = P.slides[0]?.id || 'settings';
  renderList();
  renderEditor();
  renderControls();
  renderUrls();
})();
