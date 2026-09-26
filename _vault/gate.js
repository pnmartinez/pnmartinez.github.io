'use strict';
const STORAGE = 'local-outreach.vault.session';
const form = document.querySelector('#unlock-form');
const button = document.querySelector('#unlock');
const status = document.querySelector('#status');
let config;
let worker;
const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const base64 = value => btoa(String.fromCharCode(...new Uint8Array(value)));

function rpc(message) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('El acceso no responde. Recarga la página.')), 30000);
    channel.port1.onmessage = ({data}) => {
      clearTimeout(timer);
      channel.port1.close();
      data.ok ? resolve(data) : reject(new Error(data.error || 'Contraseña incorrecta.'));
    };
    worker.postMessage(message, [channel.port2]);
  });
}

function destination() {
  let target = location.pathname + location.search + location.hash;
  if (location.pathname.startsWith('/_vault/')) target = new URLSearchParams(location.search).get('next') || '/';
  const url = new URL(target, location.origin);
  if (url.origin !== location.origin || url.pathname.startsWith('/_vault/') || url.pathname === '/vault-sw.js') return '/';
  return url.pathname + url.search + url.hash;
}

async function enter(raw, expires) {
  const key = await crypto.subtle.importKey('raw', bytes(raw), 'AES-GCM', false, ['decrypt']);
  await rpc({type: 'UNLOCK', key, build: config.id, expires});
  sessionStorage.setItem(STORAGE, JSON.stringify({key: raw, build: config.id, expires}));
  const target = destination();
  // Replacing an identical URL with a fragment is only a same-document navigation.
  // Force a request so the worker can return the decrypted page in that case.
  if (new URL(target, location.origin).href === location.href) location.reload();
  else location.replace(target);
}

async function prepare() {
  if (!isSecureContext || !crypto.subtle || !('serviceWorker' in navigator)) throw new Error('Abre este enlace por HTTPS en un navegador actualizado.');
  const response = await fetch('/_vault/config.json', {cache: 'no-store'});
  if (!response.ok) throw new Error('No se pudo preparar el acceso. Recarga la página.');
  config = await response.json();
  const registration = await navigator.serviceWorker.register('/vault-sw.js', {scope: '/', updateViaCache: 'none'});
  await registration.update();
  await navigator.serviceWorker.ready;
  // A new deployment may replace an older active worker. Wait for its activation.
  const pending = registration.installing || registration.waiting;
  if (pending && pending.state !== 'activated') await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Recarga la página para actualizar el acceso.')), 20000);
    pending.addEventListener('statechange', () => {
      if (pending.state === 'activated') {clearTimeout(timer); resolve();}
      if (pending.state === 'redundant') {clearTimeout(timer); reject(new Error('No se pudo actualizar el acceso.'));}
    });
  });
  if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
  worker = navigator.serviceWorker.controller;
  const saved = JSON.parse(sessionStorage.getItem(STORAGE) || 'null');
  if (saved && saved.build === config.id && saved.expires > Date.now()) {
    try {await enter(saved.key, saved.expires); return;} catch {sessionStorage.removeItem(STORAGE);}
  }
  button.disabled = false;
  button.textContent = 'Entrar al archivo';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!config || !worker) return;
  button.disabled = true;
  status.textContent = 'Abriendo…';
  try {
    const input = document.querySelector('#password');
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(input.value), 'PBKDF2', false, ['deriveBits']);
    const raw = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:bytes(config.salt), iterations:config.iterations}, material, 256);
    input.value = '';
    await enter(base64(raw), Date.now() + config.sessionMs);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
    document.querySelector('#password').focus();
  }
});
prepare().catch(error => {status.textContent = error.message; button.textContent = 'Recarga para reintentar';});
