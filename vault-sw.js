'use strict';
const BUILD = '65ba790be934dcaf53cdcd13fdaded08';
const MAX_SESSION = 8 * 60 * 60 * 1000;
const sessions = new Map();
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let handoff = null;
const privateHeaders = type => ({'Content-Type':type, 'Cache-Control':'no-store', 'X-Robots-Tag':'noindex, nofollow, noarchive', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff'});

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function decrypt(key, blob, aad) {
  const data = new Uint8Array(blob);
  return crypto.subtle.decrypt({name:'AES-GCM', iv:data.slice(0,12), additionalData:encoder.encode(aad)}, key, data.slice(12));
}

function sessionFor(id) {
  if (!id) return null;
  const session = sessions.get(id);
  if (session && session.expires > Date.now()) return session;
  sessions.delete(id);
  return null;
}

function attach(id, session) {
  if (id && session) sessions.set(id, session);
}

function sessionForRequest(event) {
  const found = sessionFor(event.clientId) || sessionFor(event.resultingClientId);
  if (found) {
    attach(event.resultingClientId, found);
    handoff = {session: found, until: Date.now() + 15000};
    return found;
  }
  const navigating = event.request.mode === 'navigate' || event.request.destination === 'document';
  if (navigating && handoff && handoff.until > Date.now()) {
    const session = handoff.session;
    attach(event.clientId, session);
    attach(event.resultingClientId, session);
    handoff = {session, until: Date.now() + 15000};
    return session;
  }
  return null;
}

self.addEventListener('message', event => {
  event.waitUntil((async () => {
    const respond = data => event.ports[0]?.postMessage(data);
    if (!event.source || new URL(event.source.url).origin !== self.location.origin) return respond({ok:false});
    const message = event.data || {};
    if (message.type === 'LOCK') {
      sessions.clear();
      handoff = null;
      const clients = await self.clients.matchAll({type:'window'});
      clients.forEach(client => client.postMessage({type:'LOCKED'}));
      return respond({ok:true});
    }
    if (message.type === 'STATUS') return respond({ok:!!sessionFor(event.source.id)});
    if (message.type !== 'UNLOCK') return respond({ok:false});
    try {
      if (message.build !== BUILD) throw new Error('build');
      const response = await fetch('/_vault/manifest.bin', {cache:'no-store'});
      if (!response.ok) throw new Error('manifest');
      const manifest = JSON.parse(decoder.decode(await decrypt(message.key, await response.arrayBuffer(), 'local-outreach-vault-v1:' + BUILD)));
      if (manifest.build !== BUILD || !manifest.files['/index.html']) throw new Error('manifest');
      const expires = Math.min(Number(message.expires) || 0, Date.now() + MAX_SESSION);
      if (expires <= Date.now()) throw new Error('expired');
      const session = {key:message.key, manifest, expires};
      sessions.set(event.source.id, session);
      // The next same-tab navigation often arrives with an empty clientId
      // (Firefox, Safari, and some Chrome reloads). One shot, then gone.
      handoff = {session, until: Date.now() + 8000};
      respond({ok:true});
    } catch {
      respond({ok:false, error:message.build !== BUILD ? 'El sitio se ha actualizado. Recarga la página.' : 'Contraseña incorrecta o archivo no disponible.'});
    }
  })());
});

async function handle(event) {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return fetch(event.request);
  if (url.pathname.startsWith('/_vault/') || ['/vault-sw.js','/robots.txt','/.nojekyll'].includes(url.pathname)) return fetch(event.request, {cache:'no-store'});
  const session = sessionForRequest(event);
  if (!session) {
    const navigating = event.request.mode === 'navigate' || event.request.destination === 'document';
    if (navigating) return fetch('/_vault/restore.html', {cache:'no-store'});
    return fetch(event.request, {cache:'no-store'});
  }
  let path;
  try {path = decodeURIComponent(url.pathname);} catch {return new Response('Ruta no válida', {status:400});}
  if (path.endsWith('/')) path += 'index.html';
  let entry = session.manifest.files[path];
  if (!entry && session.manifest.files[path + '/index.html']) {
    return Response.redirect(url.origin + url.pathname + '/' + url.search, 302);
  }
  if (!entry) {
    if (path.startsWith('/api/')) return new Response('Disponible solo en el servidor local', {status:404, headers:privateHeaders('text/plain; charset=utf-8')});
    return fetch(event.request, {cache:'no-store'});
  }
  if (!['GET','HEAD'].includes(event.request.method)) return new Response('Método no disponible', {status:405});
  try {
    const response = await fetch('/_vault/data/' + entry.blob + '.bin', {cache:'no-store'});
    if (!response.ok) throw new Error('fetch');
    const content = await decrypt(session.key, await response.arrayBuffer(), BUILD + ':' + path);
    if (session.expires <= Date.now()) throw new Error('locked');
    attach(event.resultingClientId, session);
    const headers = privateHeaders(entry.type);
    const range = event.request.headers.get('Range');
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (match) {
        const start = Number(match[1]);
        const end = Math.min(match[2] ? Number(match[2]) : content.byteLength - 1, content.byteLength - 1);
        if (start > end) return new Response(null, {status:416, headers:{...headers,'Content-Range':'bytes */' + content.byteLength}});
        return new Response(event.request.method === 'HEAD' ? null : content.slice(start,end + 1), {status:206, headers:{...headers,'Content-Range':`bytes ${start}-${end}/${content.byteLength}`,'Accept-Ranges':'bytes'}});
      }
    }
    return new Response(event.request.method === 'HEAD' ? null : content, {headers});
  } catch {
    return new Response('No se pudo abrir el archivo. Vuelve al índice e introduce la contraseña.', {status:503,headers:privateHeaders('text/plain; charset=utf-8')});
  }
}
self.addEventListener('fetch', event => {if (new URL(event.request.url).origin === self.location.origin) event.respondWith(handle(event));});
