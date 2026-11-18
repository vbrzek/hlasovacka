const app = document.getElementById('app');
let state = null;
let myVote = null;
let pending = null; // index volby, která se právě odesílá
let lastKey = '';

function voterId() {
  const k = 'voterId';
  try {
    let id = localStorage.getItem(k);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(k, id);
    }
    return id;
  } catch {
    // bez localStorage (anonymní režim apod.) – platí aspoň do zavření stránky
    return (window.__vid ||= Math.random().toString(36).slice(2) + Date.now().toString(36));
  }
}

function header(st) {
  return st.logo ? `<img class="logo" src="${esc(st.logo)}" alt="">` : '';
}

function waiting(st) {
  const started = !!st.slide;
  return `${header(st)}
    ${st.intro ? `<img class="intro" src="${esc(st.intro)}" alt="">` : ''}
    <div class="wait">
      <h2>${started ? 'Počkejte na další otázku' : 'Hlasování nebylo zahájeno'}<span class="dots"></span></h2>
      <p>Otázka se vám zobrazí automaticky, jakmile ji moderátor spustí. Stránku nechte otevřenou.</p>
    </div>`;
}

function question(st) {
  const s = st.slide;
  const opts = s.options
    .map(
      (o, i) => `<button class="opt ${pending === i ? 'sel' : ''}" style="--c:${esc(o.color)}" data-i="${i}" ${pending !== null ? 'disabled' : ''}>
        <span>${esc(o.text)}</span><span class="dot"></span></button>`
    )
    .join('');
  return `${header(st)}<h1 class="q">${esc(s.title)}</h1>${opts}<div class="err" id="err"></div>`;
}

function resultsView(st) {
  const note = st.paused
    ? 'Hlasování je pozastaveno.'
    : 'Děkujeme za hlas! Výsledky se aktualizují živě.';
  const s = st.slide;
  const rows = s.options
    .map(
      (o, i) => `<div class="res" style="--c:${esc(o.color)}">
        <div class="row ${i === myVote ? 'mine' : ''}"><span>${i === myVote ? '✓ ' : ''}${esc(o.text)}</span><b class="v"></b></div>
        <div class="track"><div class="fill"></div></div>
      </div>`
    )
    .join('');
  return `${header(st)}<h1 class="q">${esc(s.title)}</h1>${rows}
    <div class="thanks">${note}</div>`;
}

function updateResults() {
  const s = state && state.slide;
  const r = state && state.results;
  if (!s || !r || r.slideId !== s.id || (myVote === null && !state.paused)) return;
  app.querySelectorAll('.res').forEach((el, i) => {
    const c = r.counts[i] || 0;
    const p = pct(c, r.total);
    el.querySelector('.fill').style.width = p + '%';
    el.querySelector('.v').textContent = s.showPercent ? p + '%' : c;
  });
}

function render() {
  const st = state;
  const s = st.slide;
  let mode = 'wait';
  if (s && s.type === 'choice') mode = myVote === null && !st.paused ? 'q' : 'r';
  const key = JSON.stringify([mode, mode === 'wait' ? [!!s, st.intro] : s, st.logo, myVote, pending, !!st.paused]);
  if (key !== lastKey) {
    lastKey = key;
    app.innerHTML = mode === 'wait' ? waiting(st) : mode === 'q' ? question(st) : resultsView(st);
    void app.offsetHeight;
    if (mode !== 'r') scrollTo(0, 0);
  }
  updateResults();
}

app.addEventListener('click', (e) => {
  const btn = e.target.closest('.opt');
  if (!btn || pending !== null || myVote !== null) return;
  const option = Number(btn.dataset.i);
  const slideId = state.slide.id;
  pending = option;
  render();
  socket.timeout(10000).emit('vote', { slideId, option }, (err, res) => {
    pending = null;
    if (!err && res && res.ok) {
      if (state.slide && state.slide.id === slideId) {
        myVote = res.myVote;
        if (res.results) state.results = res.results;
      }
      render();
    } else {
      render();
      const el = document.getElementById('err');
      if (el) el.textContent = (res && res.error) || 'Hlas se nepodařilo odeslat, zkuste to znovu.';
    }
  });
});

const socket = io({ auth: { token: pageToken, voterId: voterId() } });
socket.on('state', (st) => {
  if (!state || !st.slide || !state.slide || st.slide.id !== state.slide.id) pending = null;
  state = st;
  myVote = st.myVote ?? null;
  render();
});
socket.on('results', (r) => {
  if (!state) return;
  state.results = r;
  updateResults();
});
const offline = document.getElementById('offline');
socket.on('connect', () => offline.classList.remove('on'));
socket.on('disconnect', () => offline.classList.add('on'));
