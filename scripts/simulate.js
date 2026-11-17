// Simulace publika pro existující prezentaci – virtuální hlasující se připojí a hlasují,
// kdykoli administrátor přepne na otázku. Ideální pro živou zkoušku před eventem.
//
// Použití: node scripts/simulate.js <admin URL> [počet=500] [minut=10] [rozptyl hlasování v s=20]
//   např.  node scripts/simulate.js https://audience.wnc.cz/a/xxxx 500 10 20
// Ukončení: Ctrl+C (jinak skončí po zadaném počtu minut). Hlasy pak lze v administraci vynulovat.
const { io } = require('socket.io-client');

const [adminUrl, nArg, minArg, spreadArg] = process.argv.slice(2);
if (!adminUrl) {
  console.error('Použití: node scripts/simulate.js <admin URL> [počet] [minut] [rozptyl s]');
  process.exit(1);
}
const N = Number(nArg) || 500;
const MINUTES = Number(minArg) || 10;
const SPREAD = (Number(spreadArg) || 20) * 1000;
const u = new URL(adminUrl);
const BASE = u.origin;
const adminToken = u.pathname.split('/').filter(Boolean).pop();
const runId = Date.now().toString(36);

// každá otázka dostane náhodné „preference“ publika, aby výsledky nebyly rovnoměrné
const weights = new Map();
function pick(slide) {
  if (!weights.has(slide.id)) weights.set(slide.id, slide.options.map(() => Math.random() ** 2 + 0.05));
  const w = weights.get(slide.id);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) if ((r -= w[i]) <= 0) return i;
  return w.length - 1;
}

let connected = 0;
let votes = 0;
let errors = 0;

(async () => {
  const r = await fetch(`${BASE}/api/admin/${adminToken}`);
  if (!r.ok) throw new Error('Prezentace nenalezena – zkontrolujte admin URL');
  const P = await r.json();
  console.log(`Prezentace „${P.title}“, připojuji ${N} hlasujících…`);

  const sockets = [];
  for (let i = 0; i < N; i++) {
    if (i && i % 50 === 0) await new Promise((res) => setTimeout(res, 100));
    const s = io(BASE, { auth: { token: P.voteToken, voterId: `sim-${runId}-${i}` }, transports: ['websocket'], forceNew: true });
    let timer = null;
    s.on('connect', () => connected++);
    s.on('disconnect', () => connected--);
    s.on('state', (st) => {
      clearTimeout(timer);
      const slide = st.slide;
      if (!slide || slide.type !== 'choice' || st.myVote !== null) return;
      // ne každý hlasuje hned – rozložení připomíná skutečné publikum
      const delay = 1500 + Math.random() ** 1.6 * SPREAD;
      timer = setTimeout(async () => {
        try {
          const res = await s.timeout(10000).emitWithAck('vote', { slideId: slide.id, option: pick(slide) });
          res.ok ? votes++ : errors++;
        } catch {
          errors++;
        }
      }, delay);
    });
    sockets.push(s);
  }

  const status = setInterval(() => {
    process.stdout.write(`\rpřipojeno: ${connected}/${N}   odeslaných hlasů: ${votes}   chyb: ${errors}   `);
  }, 1000);

  const end = () => {
    clearInterval(status);
    console.log('\nKonec simulace, odpojuji.');
    sockets.forEach((s) => s.close());
    process.exit(0);
  };
  process.on('SIGINT', end);
  setTimeout(end, MINUTES * 60 * 1000);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
