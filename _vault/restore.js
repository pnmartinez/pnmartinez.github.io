'use strict';
const STORAGE = 'local-outreach.vault.session';
const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

function rpc(worker, message) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('timeout')), 30000);
    channel.port1.onmessage = ({data}) => {
      clearTimeout(timer);
      channel.port1.close();
      data.ok ? resolve(data) : reject(new Error(data.error || 'fail'));
    };
    worker.postMessage(message, [channel.port2]);
  });
}

function toGate() {
  try {sessionStorage.removeItem(STORAGE);} catch {}
  const next = location.pathname + location.search + location.hash;
  location.replace('/_vault/gate.html?next=' + encodeURIComponent(next));
}

(async () => {
  const saved = JSON.parse(sessionStorage.getItem(STORAGE) || 'null');
  if (!saved || saved.expires <= Date.now()) return toGate();
  if (!isSecureContext || !crypto.subtle || !('serviceWorker' in navigator)) return toGate();
  const config = await (await fetch('/_vault/config.json', {cache: 'no-store'})).json();
  if (saved.build !== config.id) return toGate();
  const registration = await navigator.serviceWorker.register('/vault-sw.js?v=3', {scope: '/', updateViaCache: 'none'});
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
  }
  const worker = navigator.serviceWorker.controller;
  if (!worker) return toGate();
  const key = await crypto.subtle.importKey('raw', bytes(saved.key), 'AES-GCM', false, ['decrypt']);
  await rpc(worker, {type: 'UNLOCK', key, build: config.id, expires: saved.expires});
  const url = new URL(location.href);
  url.searchParams.set('ok', '1');
  location.replace(url.pathname + url.search + url.hash);
})().catch(toGate);
