// Zátěžový test (připojování po dávkách 50 klientů / 100 ms): N hlasujících se připojí, admin přepne na otázku, všichni zahlasují.
// Použití: node scripts/loadtest.js http://localhost:3000 500
const { io } = require('socket.io-client');
const BASE = process.argv[2] || 'http://localhost:3000';
const N = Number(process.argv[3]) || 500;

(async () => {
  const r = await fetch(BASE + '/api/presentations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Loadtest' }),
  });
  const adminToken = (await r.json()).adminUrl.split('/').pop();
  const P = await (await fetch(`${BASE}/api/admin/${adminToken}`)).json();
  const q = P.slides.find((s) => s.type === 'choice');

  const t0 = Date.now();
  const voters = await Promise.all(
    Array.from({ length: N }, (_, i) => new Promise((r) => setTimeout(r, Math.floor(i / 50) * 100)).then(() => new Promise((res, rej) => {
      const s = io(BASE, { auth: { token: P.voteToken, voterId: 'loadtest-voter-' + i }, transports: ['websocket'], forceNew: true });
      s.once('state', () => res(s));
      s.once('connect_error', rej);
    })))
  );
  console.log(`${N} hlasujících připojeno za ${Date.now() - t0} ms`);

  const screen = io(BASE, { auth: { token: P.screenToken }, transports: ['websocket'] });
  let lastResults = null;
  screen.on('results', (x) => (lastResults = x));

  const admin = io(BASE, { auth: { token: adminToken }, transports: ['websocket'] });
  await new Promise((res) => admin.once('state', res));

  const t1 = Date.now();
  await Promise.all(voters.map((s) => new Promise((res) => {
    s.once('state', (st) => (st.slide && st.slide.id === q.id ? res() : null));
  }).then(() => null)).concat([new Promise((res) => { admin.emit('goto', { slideId: q.id }); res(); })]));
  console.log(`Přepnutí slajdu doručeno všem za ${Date.now() - t1} ms`);

  const t2 = Date.now();
  const acks = await Promise.all(voters.map((s, i) => s.emitWithAck('vote', { slideId: q.id, option: i % 2 })));
  console.log(`${N} hlasů potvrzeno za ${Date.now() - t2} ms, chyb: ${acks.filter((a) => !a.ok).length}`);

  // dvojí hlasování nesmí projít
  const dup = await voters[0].emitWithAck('vote', { slideId: q.id, option: 1 });
  console.log('Opakovaný hlas ignorován:', dup.myVote === 0);

  await new Promise((res) => setTimeout(res, 700));
  console.log('Plátno vidí:', lastResults);

  for (const s of [...voters, screen, admin]) s.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
