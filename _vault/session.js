(() => {
  'use strict';
  const STORAGE = 'local-outreach.vault.session';
  let leaving = false;
  const bytes = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  function locked() {
    if (leaving) return;
    leaving = true;
    sessionStorage.removeItem(STORAGE);
    document.documentElement.style.visibility = 'hidden';
    location.replace('/_vault/gate.html?next=' + encodeURIComponent(location.pathname + location.search + location.hash));
  }
  function rpc(controller, message, ms) {
    return new Promise(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(null), ms);
      channel.port1.onmessage = ({data}) => {clearTimeout(timer); channel.port1.close(); resolve(data);};
      controller.postMessage(message, [channel.port2]);
    });
  }
  navigator.serviceWorker.addEventListener('message', ({data}) => {if (data?.type === 'LOCKED') locked();});
  async function controller() {
    if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
    try {await navigator.serviceWorker.ready;} catch {return null;}
    if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
    await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
    return navigator.serviceWorker.controller;
  }
  async function check() {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE) || 'null');
    if (!saved || saved.expires <= Date.now()) return locked();
    const worker = await controller();
    if (!worker) return locked();
    let state = await rpc(worker, {type:'STATUS'}, 15000);
    if (!state?.ok) {
      try {
        const key = await crypto.subtle.importKey('raw', bytes(saved.key), 'AES-GCM', false, ['decrypt']);
        state = await rpc(worker, {type:'UNLOCK', key, build:saved.build, expires:saved.expires}, 30000);
      } catch {
        state = null;
      }
      if (!state?.ok) return locked();
    }
    document.documentElement.style.visibility = '';
    if (new URLSearchParams(location.search).get('ok') === '1') {
      const clean = new URL(location.href);
      clean.searchParams.delete('ok');
      history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
    }
  }
  window.addEventListener('pageshow', event => {
    if (event.persisted) document.documentElement.style.visibility = 'hidden';
    check();
  });
  document.addEventListener('visibilitychange', () => {if (!document.hidden) check();});
  window.addEventListener('DOMContentLoaded', () => {
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label','Acceso privado');
    nav.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483647;display:flex;gap:1px;font:12px system-ui;box-shadow:0 1px 8px #0003;border:1px solid #fff5;border-radius:5px;overflow:hidden';
    const home = document.createElement('a');
    home.href = '/'; home.textContent = 'Índice';
    const lock = document.createElement('button');
    lock.type = 'button'; lock.textContent = 'Bloquear';
    [home,lock].forEach(el => {el.style.cssText = 'border:0;padding:10px 12px;background:#20352c;color:#fff;text-decoration:none;cursor:pointer;font:inherit'; nav.appendChild(el);});
    lock.addEventListener('click', () => {navigator.serviceWorker.controller?.postMessage({type:'LOCK'}); locked();});
    document.body.appendChild(nav);
    const saved = JSON.parse(sessionStorage.getItem(STORAGE) || 'null');
    if (saved) setTimeout(locked, Math.max(0,saved.expires - Date.now()));
  });
})();
