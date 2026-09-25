#!/usr/bin/env node
// Opens the single-file build the way a person does — file://, no special browser flags — in
// headless Chrome, waits for it to finish starting, and checks its start-up log and console.
//   node tools/smoke-single.mjs dist/GlobalS.html [--require-data] [--chrome path/to/chrome]
// --require-data also demands live satellites from the GlobalS data feed (used before releasing).
// Talks to Chrome over the DevTools protocol with Node's built-in WebSocket: no dependencies.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function devtoolsPage(profile, deadline) {
  const portFile = join(profile, 'DevToolsActivePort');
  while (!existsSync(portFile)) {
    if (Date.now() > deadline) throw new Error('Chrome did not start');
    await sleep(100);
  }
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  for (;;) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
    const page = targets.find((t) => t.type === 'page' && t.url.startsWith('file:'));
    if (page) return page.webSocketDebuggerUrl;
    if (Date.now() > deadline) throw new Error('no page target');
    await sleep(100);
  }
}

export async function smoke(file, { chrome = 'google-chrome', requireData = false, timeoutMs = 120_000 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'globals-smoke-'));
  const url = `${pathToFileURL(resolve(file)).href}?test=1`;
  const args = [
    '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--no-first-run', '--no-default-browser-check', '--window-size=640,480',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', url,
  ];
  if (process.getuid?.() === 0 || process.env.CI) args.unshift('--no-sandbox'); // root containers; CI runners
  const proc = spawn(chrome, args, { stdio: 'ignore' });
  const deadline = Date.now() + timeoutMs;
  const consoleErrors = [];
  let log = [];
  let state = { ready: false, failed: '' };
  let ws;
  try {
    ws = new WebSocket(await devtoolsPage(profile, deadline));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools connection failed')); });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m.result);
        pending.delete(m.id);
      } else if (m.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
    };
    const send = (method, params = {}) => new Promise((res) => {
      pending.set(++id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
    await send('Runtime.enable');
    const probe = `JSON.stringify({
      log: document.getElementById('bootLog')?.innerText ?? null,
      ready: !!window.__globals?.ready,
      failed: document.getElementById('bootError')?.hidden === false ? document.getElementById('bootError').textContent : '',
    })`;
    while (Date.now() < deadline) {
      const r = await send('Runtime.evaluate', { expression: probe, returnByValue: true });
      const v = JSON.parse(r?.result?.value ?? '{}');
      if (v.log) log = v.log.split('\n').map((s) => s.trim()).filter(Boolean);
      state = v;
      if (v.ready || v.failed) break;
      await sleep(250);
    }
  } finally {
    ws?.close();
    proc.kill('SIGKILL');
    await sleep(200);
    rmSync(profile, { recursive: true, force: true });
  }
  const problems = [];
  if (state.failed) problems.push(`start-up failed: ${state.failed}`);
  else if (!state.ready) problems.push(`the app did not finish starting within ${timeoutMs / 1000} s`);
  if (!log.some((l) => /naked-eye stars/.test(l))) problems.push('the star catalogue was not loaded');
  if (requireData && !log.some((l) => /satellites · CelesTrak/.test(l))) problems.push('no satellites loaded from the data feed');
  if (requireData && !log.some((l) => /SGP4 propagator/.test(l))) problems.push('the SGP4 worker never produced positions');
  const unexpected = consoleErrors.filter((e) => !/Failed to load resource|ERR_/.test(e)); // a missing feed is handled
  for (const e of unexpected.slice(0, 5)) problems.push(`console: ${e}`);
  return { log, problems };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const file = process.argv[2] ?? 'dist/GlobalS.html';
  const i = process.argv.indexOf('--chrome');
  const { log, problems } = await smoke(file, { chrome: i > 0 ? process.argv[i + 1] : undefined, requireData: process.argv.includes('--require-data') });
  console.log(`Start-up log of ${file}:\n  ${log.join('\n  ') || '(empty)'}`);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log('✓ the single file starts from file://');
}
