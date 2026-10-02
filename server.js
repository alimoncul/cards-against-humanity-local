// Run: node server.js   (env: ADMIN_PIN=1234 PORT=3000)
const http = require('http'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const { black, white } = require('./cards.json');
const PORT = process.env.PORT || 3000, PIN = process.env.ADMIN_PIN || '1234';
const ROUNDS = 10, HAND = 7, MIN = 3;

const shuffle = a => { for (let i = a.length; i--;) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const draw = (d, src) => { if (!d.length) d.push(...shuffle([...src])); return d.pop(); };
const ip = () => Object.values(os.networkInterfaces()).flat().find(n => /4/.test(n.family) && !n.internal)?.address || 'localhost';

let S, bd, wd;
const clients = new Set(); // {res, id}
const players = () => Object.values(S.players);
const live = () => players().filter(p => p.on > 0);
const fill = p => { while (p.hand.length < HAND) p.hand.push(draw(wd, white)); };

function restart() {
  const old = S ? players() : [];
  S = { phase: 'lobby', round: 0, black: null, subs: [], players: {} };
  bd = shuffle([...black]); wd = shuffle([...white]);
  old.forEach(p => { S.players[p.id] = { ...p, score: 0, hand: [], picked: null, voted: false }; fill(S.players[p.id]); });
}
restart();

function startRound() {
  S.round++; S.phase = 'pick'; S.black = draw(bd, black); S.subs = [];
  players().forEach(p => { p.picked = null; p.voted = false; fill(p); });
}
function toVote() {
  if (S.subs.length < 2) return toResult();
  shuffle(S.subs); S.phase = 'vote';
}
function toResult() {
  // ponytail: ties broken by sort order, not shared points
  S.subs.sort((a, b) => b.votes - a.votes);
  S.subs.slice(0, 3).forEach((s, k) => { if (s.votes) { s.pts = 3 - k; S.players[s.pid].score += s.pts; } });
  S.phase = 'result';
}
function next() {
  const ph = S.phase;
  if (ph === 'lobby') return players().length >= MIN ? startRound() : 'En az ' + MIN + ' oyuncu lazım';
  if (ph === 'pick') toVote();
  else if (ph === 'vote') toResult();
  else if (ph === 'result') S.round >= ROUNDS ? S.phase = 'end' : startRound();
}
function check() {
  const l = live(); if (!l.length) return;
  if (S.phase === 'pick' && l.every(p => p.picked)) toVote();
  else if (S.phase === 'vote' && l.every(p => p.voted)) toResult();
}

function view(pid) {
  const me = S.players[pid], reveal = S.phase === 'result' || S.phase === 'end';
  return {
    phase: S.phase, round: S.round, rounds: ROUNDS, black: S.black, url: `http://${ip()}:${PORT}`,
    players: players().map(p => ({ name: p.name, score: p.score, on: p.on > 0,
      done: S.phase === 'pick' ? !!p.picked : S.phase === 'vote' ? p.voted : false })),
    subs: S.phase === 'pick' ? [] : S.subs.map((s, i) => ({ i, text: s.text,
      ...(reveal && { name: S.players[s.pid].name, votes: s.votes, pts: s.pts || 0 }) })),
    me: me && { hand: me.hand, picked: me.picked, voted: me.voted, own: S.subs.findIndex(s => s.pid === pid) },
  };
}
const push = () => clients.forEach(c => c.res.write(`data:${JSON.stringify(view(c.id))}\n\n`));
setInterval(() => clients.forEach(c => c.res.write(':\n\n')), 20000);

function act(b) {
  const p = S.players[b.id];
  switch (b.action) {
    case 'join': {
      const name = String(b.name || '').trim().slice(0, 16);
      if (!name) return 'İsim lazım';
      const id = crypto.randomUUID();
      S.players[id] = { id, name, score: 0, hand: [], picked: null, voted: false, on: 0 };
      fill(S.players[id]);
      return { id };
    }
    case 'pick':
      if (!p || S.phase !== 'pick' || p.picked || !p.hand[b.i]) return;
      p.picked = p.hand.splice(b.i, 1)[0]; fill(p);
      S.subs.push({ pid: p.id, text: p.picked, votes: 0 });
      return check();
    case 'vote': {
      const s = S.subs[b.i];
      if (!p || S.phase !== 'vote' || p.voted || !s || s.pid === p.id) return;
      p.voted = true; s.votes++;
      return check();
    }
    case 'next': case 'restart':
      if (b.pin !== PIN) return 'Yanlış PIN';
      return b.action === 'next' ? next() : restart();
  }
}

const page = fs.readFileSync(__dirname + '/index.html'), qr = fs.readFileSync(__dirname + '/qr.js');
http.createServer((req, res) => {
  if (req.url.startsWith('/events')) {
    const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const c = { res, id }; clients.add(c);
    const p = S.players[id]; if (p) p.on++;
    push();
    req.on('close', () => { clients.delete(c); if (p && p.on > 0) p.on--; check(); push(); });
  } else if (req.method === 'POST') {
    let body = ''; req.on('data', d => body += d).on('end', () => {
      let r; try { r = act(JSON.parse(body)); } catch { r = 'Hata'; }
      push();
      res.end(JSON.stringify(typeof r === 'string' ? { error: r } : r || {}));
    });
  } else if (req.url === '/qr.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(qr); }
  else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); }
}).listen(PORT, () => console.log(`TV:     http://localhost:${PORT}/tv\nAdmin:  http://localhost:${PORT}/admin  (PIN ${PIN})\nOyuncu: http://${ip()}:${PORT}`));
