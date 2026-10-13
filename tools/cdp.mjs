// uso: node cdp.mjs eval <arquivo.js> | click <x> <y> (px CSS) | key <Escape|Enter> | shot <saida.png>
import { readFileSync, writeFileSync } from 'node:fs';
const [, , mode, arg] = process.argv;
const list = await (await fetch('http://127.0.0.1:8888/json/list')).json();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise(r => ws.onopen = r);
if (mode === 'eval') {
  const expr = readFileSync(arg, 'utf8');
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const v = r.result?.result?.value ?? r.result?.exceptionDetails ?? r;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
} else if (mode === 'click') {
  const [x, y] = [Number(arg), Number(process.argv[4])];
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  console.log('clicked', x, y);
} else if (mode === 'key') { // node cdp.mjs key Escape
  const key = arg, code = arg, vk = { Escape: 27, Enter: 13 }[arg] ?? 0;
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  console.log('key', key);
} else if (mode === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg, Buffer.from(r.result.data, 'base64')); console.log('ok', arg);
}
ws.close(); process.exit(0);
