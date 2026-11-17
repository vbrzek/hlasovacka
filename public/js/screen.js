const stage = document.getElementById('stage');
let state = null;
let lastKey = '';

function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
addEventListener('resize', fit);
fit();

function build(st) {
  const s = st.slide;
  const logo = st.logo ? `<img class="logo" src="${esc(st.logo)}" alt="">` : '';
  const url = voteUrlOf(st);

  if (!s) {
    return `<div class="lobby">
      <div class="lobby-text">
        <h1>${esc(st.title)}</h1>
        <p>Naskenujte QR kód a hlasujte z mobilu</p>
        <div class="url">${esc(url.replace(/^https?:\/\//, ''))}</div>
      </div>
      <img class="qr-big" src="/qr/${esc(st.voteToken)}" alt="">
    </div>${logo}`;
  }

  if (s.type === 'static') {
    return `<div class="static ${s.image ? '' : 'no-img'}">
      ${s.image ? `<img class="content-img" src="${esc(s.image)}" alt="">` : ''}
      ${s.title ? `<h1>${esc(s.title)}</h1>` : ''}
    </div>${logo}`;
  }

  const cols = s.options
    .map(
      (o) => `<div class="col" style="--c:${esc(o.color)}">
        <div class="barwrap"><div class="val">0</div><div class="bar"></div></div>
        <div class="label">${esc(o.text)}</div>
      </div>`
    )
    .join('');
  return `<div class="choice ${st.logo ? 'has-logo' : ''}">
    <div class="qhead">
      ${st.showQr ? `<div class="qr-float"><img src="/qr/${esc(st.voteToken)}" alt="">Hlasujte</div>` : ''}
      <h1>${esc(s.title)}</h1>
    </div>
    <div class="chart">${cols}</div>
    <div class="votes"></div>
  </div>${logo}`;
}

function updateBars(r) {
  const s = state && state.slide;
  if (!s || s.type !== 'choice' || !r || r.slideId !== s.id) return;
  const max = Math.max(1, ...r.counts);
  stage.querySelectorAll('.col').forEach((col, i) => {
    const c = r.counts[i] || 0;
    // výška sloupce relativně k nejsilnější odpovědi (jako Menti), mínus místo pro popisek
    const h = (c / max) * 350;
    const bar = col.querySelector('.bar');
    bar.style.height = `${8 + h}px`; // 8 px = základní linka
    bar.style.borderRadius = `${Math.min(28, 4 + h)}px ${Math.min(28, 4 + h)}px 4px 4px`;
    col.querySelector('.val').textContent = s.showPercent ? `${pct(c, r.total)}%` : c;
  });
  const v = stage.querySelector('.votes');
  if (v) v.textContent = r.total ? `${r.total} ${r.total === 1 ? 'hlas' : r.total < 5 ? 'hlasy' : 'hlasů'}` : '';
}

function render(st) {
  state = st;
  const key = JSON.stringify([st.slide, st.logo, st.showQr, st.title, st.voteToken]);
  if (key !== lastKey) {
    lastKey = key;
    stage.innerHTML = build(st);
    // vynutit reflow, aby sloupce vyrostly z nuly s animací
    void stage.offsetHeight;
  }
  updateBars(st.results);
}

const socket = io({ auth: { token: pageToken } });
socket.on('state', render);
socket.on('results', (r) => {
  if (state) state.results = r;
  updateBars(r);
});
