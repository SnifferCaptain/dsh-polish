// Drives a headless Chrome pointed at the live DSH GUI over CDP and reports
// which dsh-polish depth CSS is actually injected, plus the computed geometry
// of the slider (if the effort row is openable) so we can tell a CSS override
// from a stale bundle. No external deps (Node 24 has global WebSocket/fetch).
import http from 'node:http';
const PORT = 9344;

function httpJson(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request('http://127.0.0.1:' + PORT + path, { method }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('non-json ' + d.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) find the page target
  let target = null;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await httpJson('/json/list');
      target = list.find((t) => t.type === 'page' && /19387/.test(t.url || '')) || list.find((t) => t.type === 'page');
      if (target && target.webSocketDebuggerUrl) break;
    } catch (e) {}
    await sleep(400);
  }
  if (!target) { console.log('NO_TARGET'); process.exit(2); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      p.resolve(msg);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('ws error')));
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, { resolve });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => pending.delete(mid), 15000);
    });

  await send('Runtime.enable');
  const evalJs = (expression) =>
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((m) => {
      if (m.result && m.result.result && m.result.result.value !== undefined) return m.result.result.value;
      return m.result && m.result.result ? m.result.result.description : JSON.stringify(m);
    });

  // Give the SPA a moment to boot and inject plugin styles.
  await sleep(2500);

  const probe = await evalJs(`
    (function(){
      var st = document.getElementById('dsh-polish-depth-style');
      var sample = st ? st.textContent : '';
      var hasPill = sample.indexOf('height: 28px') >= 0 && sample.indexOf('border-radius: 14px') >= 0;
      var hasOldGroove = sample.indexOf('height: 12px') >= 0;
      var slider = document.querySelector('.dshp-eff-slider');
      var report = {
        styleIdPresent: !!st,
        cssLength: sample.length,
        hasPill28_14: hasPill,
        hasOld12pxGroove: hasOldGroove,
        sliderInDom: !!slider,
        allStyleIds: Array.prototype.map.call(document.querySelectorAll('style[id]'), function(s){ return s.id; }),
      };
      if (slider) {
        function geo(sel){ var el = document.querySelector(sel); if(!el) return null; var c = getComputedStyle(el); return { borderRadius: c.borderRadius, width: c.width, height: c.height }; }
        report.ghost = geo('.dshp-eff-ghost');
        report.knob = geo('.dshp-eff-knob');
      }
      return report;
    })()
  `);
  console.log('PROBE=' + JSON.stringify(probe, null, 2));

  // Best-effort: try to open the model panel so the effort row exists, then re-probe computed geometry.
  try {
    const opened = await evalJs(`
      (function(){
        var btns = Array.prototype.slice.call(document.querySelectorAll('button[aria-haspopup="menu"], [aria-controls$="-menu"]'));
        if (btns.length) { btns[0].click(); return btns.length; }
        return 0;
      })()
    `);
    await sleep(1200);
    var report2 = await evalJs(`
      (function(){
        var slider = document.querySelector('.dshp-eff-slider');
        if (!slider) return { sliderInDom: false };
        function geo(sel){ var el = document.querySelector(sel); if(!el) return null; var c = getComputedStyle(el); return { borderRadius: c.borderRadius, width: c.width, height: c.height, display: c.display }; }
        return { sliderInDom: true, ghost: geo('.dshp-eff-ghost'), fill: geo('.dshp-eff-fill'), knob: geo('.dshp-eff-knob') };
      })()
    `);
    console.log('AFTER_OPEN(clicked=' + opened + ')=' + JSON.stringify(report2, null, 2));
  } catch (e) {
    console.log('OPEN_PROBE_FAILED=' + e.message);
  }

  ws.close();
  process.exit(0);
}

main().catch((e) => { console.log('ERR=' + e.message); process.exit(1); });
