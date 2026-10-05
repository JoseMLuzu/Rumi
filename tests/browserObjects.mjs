import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { authenticate } from './authClient.mjs';
import { writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FURNITURE_CATALOG } from '../src/data/furniture.js';

// Opt-in production browser test using a separate PostgreSQL test server.
// Test photographs/audio are generated as files; uploads and Socket.IO actions are real.
const url = process.env.TEST_SERVER_URL || 'http://127.0.0.1:5003';
const PASSWORD = 'isolated object test password';
const metadata = await (await fetch('http://127.0.0.1:9229/json/version')).json();
const connection = new WebSocket(metadata.webSocketDebuggerUrl);
await new Promise((resolve) => connection.addEventListener('open', resolve, { once: true }));
// Keep Node alive while a slow browser command is waiting for its response.
const keepAlive = setInterval(() => {}, 1000);
let sequence = 0;
const pending = new Map(),
  errors = new Map(),
  contexts = [];
connection.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown')
    errors.get(message.sessionId)?.push(message.params.exceptionDetails.exception?.description);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
    errors
      .get(message.sessionId)
      ?.push(message.params.args.map((arg) => arg.description || arg.value));
  if (pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  }
});
function send(method, params = {}, sessionId) {
  const id = ++sequence;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Browser command timed out: ${method}`));
    }, 20000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
  connection.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return result;
}
async function evaluate(session, expression) {
  const result = await send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true, userGesture: true },
    session,
  );
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(session, expression) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate(session, expression)) return;
    await delay(100);
  }
  throw new Error(
    'Timeout: ' +
      expression +
      '\n' +
      JSON.stringify(
        await evaluate(
          session,
          `({
    status:document.querySelector('.screen-status')?.textContent,error:document.querySelector('.screen-error')?.textContent,
    position:window.__screenTest.position,pcs:window.__screenTest.peers.map(pc=>pc.connectionState)})`,
        ),
      ),
  );
}
async function click(session, text) {
  await evaluate(
    session,
    `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`,
  );
}
async function key(session, type, key) {
  await send(
    'Input.dispatchKeyEvent',
    {
      type,
      key,
      code: 'Key' + key.toUpperCase(),
      windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    },
    session,
  );
}
async function walkTo(session, x, z) {
  await send('Page.bringToFront', {}, session);
  for (let attempt = 0; attempt < 120; attempt++) {
    const position = await evaluate(session, 'window.__screenTest.position');
    const dx = x - position[0],
      dz = z - position[2];
    if (Math.hypot(dx, dz) < 0.3) return;
    const forward = await evaluate(session, 'window.__screenTest.forward');
    const length = Math.hypot(...forward);
    const desired = [dx, dz];
    const f = (desired[0] * forward[0] + desired[1] * forward[1]) / length;
    const r = (-desired[0] * forward[1] + desired[1] * forward[0]) / length;
    // Choose the closest of the eight WASD directions, including diagonals.
    const directions = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    const [moveForward, moveRight] = directions.reduce((best, direction) =>
      (direction[0] * f + direction[1] * r) / Math.hypot(...direction) >
      (best[0] * f + best[1] * r) / Math.hypot(...best)
        ? direction
        : best,
    );
    const keys = [];
    if (moveForward) keys.push(moveForward > 0 ? 'w' : 's');
    if (moveRight) keys.push(moveRight > 0 ? 'd' : 'a');
    // Wait for one rendered frame so slow headless rendering cannot miss a short key press.
    const frame = await evaluate(session, 'window.__screenTest.animationFrames || 0');
    for (const code of keys) await key(session, 'keyDown', code);
    for (let tick = 0; tick < 40; tick++) {
      await delay(25);
      if ((await evaluate(session, 'window.__screenTest.animationFrames')) > frame) break;
    }
    for (const code of keys) await key(session, 'keyUp', code);
    await delay(100);
  }
  throw new Error(
    `Could not walk to ${x},${z}; at ${await evaluate(session, 'window.__screenTest.position')}`,
  );
}
const instrumentation = `
  window.__screenTest={peers:[],streams:[],position:null,frames:0,previews:[],deny:false,defer:false,release:null,options:null};
  const state=window.__screenTest;
  state.buffers=new Set();
  const createBuffer=WebGL2RenderingContext.prototype.createBuffer;
  WebGL2RenderingContext.prototype.createBuffer=function(){const buffer=createBuffer.call(this);state.buffers.add(buffer);return buffer};
  const deleteBuffer=WebGL2RenderingContext.prototype.deleteBuffer;
  WebGL2RenderingContext.prototype.deleteBuffer=function(buffer){state.buffers.delete(buffer);return deleteBuffer.call(this,buffer)};
  state.audioContexts=new Set();
  const AudioContextBase=window.AudioContext;
  window.AudioContext=class extends AudioContextBase {constructor(...args){super(...args);state.audioContexts.add(this)}close(){state.audioContexts.delete(this);return super.close()}};
  state.audioElements=new Set();
  const playAudio=HTMLMediaElement.prototype.play,pauseAudio=HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.play=function(){state.audioElements.add(this);return playAudio.call(this)};
  HTMLMediaElement.prototype.pause=function(){state.audioElements.delete(this);return pauseAudio.call(this)};
  state.animationFrames=0;
  const requestFrame=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=callback=>requestFrame(time=>{state.animationFrames++;callback(time)});
  // Observe the rendered camera without adding test-only globals to the application.
  // viewMatrix's third row points backward; its negative X/Z components give forward.
  const locations=new WeakMap(), perspective=new WeakMap();
  const getLocation=WebGL2RenderingContext.prototype.getUniformLocation;
  WebGL2RenderingContext.prototype.getUniformLocation=function(program,name){
    const location=getLocation.call(this,program,name);
    if(location&&(name==='viewMatrix'||name==='projectionMatrix'))locations.set(location,{program,name});
    return location;
  };
  const matrix=WebGL2RenderingContext.prototype.uniformMatrix4fv;
  WebGL2RenderingContext.prototype.uniformMatrix4fv=function(location,transpose,data,...rest){
    const uniform=locations.get(location);
    if(uniform?.name==='projectionMatrix'){perspective.set(uniform.program,data[15]===0);if(data[15]===0)state.projection=Array.from(data)}
    // Observe uploads without synchronous GPU reads; ignore the orthographic shadow camera.
    if(uniform?.name==='viewMatrix'&&perspective.get(uniform.program)){state.forward=[-data[2],-data[10]];state.view=Array.from(data)}
    return matrix.call(this,location,transpose,data,...rest);
  };
  const Socket=window.WebSocket;
  window.WebSocket=class extends Socket {
    send(data){
      if(typeof data==='string'&&data.startsWith('42')){
        const [event,payload]=JSON.parse(data.slice(data.indexOf('[')));
        if(event==='player_move')state.position=payload.position;
      }
      return super.send(data);
    }
    constructor(...args){super(...args);this.addEventListener('message',({data})=>{
      if(typeof data==='string'&&data.startsWith('42')){
        const [event,payload]=JSON.parse(data.slice(data.indexOf('[')));
        if(event==='screen_preview'){state.frames++;state.previews.push({time:Date.now(),frame:payload.frame})}
      }
    })}
  };
`;
async function makePage(name) {
  const { browserContextId } = await send('Target.createBrowserContext');
  contexts.push(browserContextId);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  errors.set(sessionId, []);
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await send('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  await wait(sessionId, "!!document.querySelector('#username')");
  await click(sessionId, 'Create account');
  for (const [selector, text] of [
    ['#username', name],
    ['#password', PASSWORD],
    ['#confirm-password', PASSWORD],
  ]) {
    await evaluate(sessionId, `document.querySelector(${JSON.stringify(selector)}).focus()`);
    await send('Input.insertText', { text }, sessionId);
  }
  await click(sessionId, 'Create account & enter');
  await wait(sessionId, "!!document.querySelector('#space-name')");
  await evaluate(sessionId, "document.querySelector('#space-name').focus()");
  await send('Input.insertText', { text: name + ' space' }, sessionId);
  await click(sessionId, 'Create space');
  await wait(sessionId, "document.querySelector('.live-status')?.textContent.includes('here')");
  // Creating a space enters its living room. Refresh restores this account's bedroom there.
  await send('Page.reload', {}, sessionId);
  await wait(sessionId, "document.querySelector('.live-status')?.textContent.includes('here')");
  await wait(sessionId, '!!window.__screenTest.position && !!window.__screenTest.forward');
  await delay(1000);
  return sessionId;
}

async function floorClick(session, x, z, y = 0.05) {
  const point = await evaluate(
    session,
    `(()=>{
   const s=window.__screenTest;const multiply=(m,v)=>[0,1,2,3].map(i=>v.reduce((sum,n,j)=>sum+m[i+4*j]*n,0));
   const clip=multiply(s.projection,multiply(s.view,[${x},${y},${z},1]));
   const rect=document.querySelector('canvas').getBoundingClientRect();
   return {x:rect.x+(clip[0]/clip[3]+1)/2*rect.width,y:rect.y+(1-clip[1]/clip[3])/2*rect.height};
 })()`,
  );
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }, session);
  await delay(150);
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', ...point, button: 'left', clickCount: 1 },
    session,
  );
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 },
    session,
  );
  await delay(150);
}

let observer;
let sharedImage;
try {
  const a = await makePage('Object Browser');
  const room = await evaluate(
    a,
    "fetch('/api/spaces').then(r=>r.json()).then(d=>fetch('/api/rooms/'+d.spaces[0].personalRoomId)).then(r=>r.json())",
  );
  const identity = await authenticate(url, 'Object Observer', PASSWORD, true);
  const invitation = await evaluate(
    a,
    `(async()=>fetch('/api/spaces/${room.spaceId}/invitation',{method:'POST',headers:{'X-CSRF-Token':(await fetch('/api/auth/session').then(r=>r.json())).csrfToken}}).then(r=>r.json()))()`,
  );
  await identity.request('/api/spaces/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invitation.token }),
  });
  const cookie = identity.cookie;
  observer = io(url, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie },
    auth: { roomId: room.id, csrfToken: identity.csrfToken, position: [1.3, 0, 0], rotation: 0 },
  });
  await new Promise((resolve, reject) => {
    observer.once('connect', resolve);
    observer.once('connect_error', reject);
  });
  observer.on('object_update', (item) => {
    if (item.type === 'poster' && item.config?.images?.[0]) sharedImage = item.config.images[0];
  });
  await evaluate(
    a,
    `(async()=>fetch('/api/rooms/${room.id}',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':(await fetch('/api/auth/session').then(r=>r.json())).csrfToken},body:JSON.stringify({items:[]})}))()`,
  );
  await send('Page.reload', {}, a);
  await wait(a, "!!document.querySelector('.save-status')");
  await click(a, 'Edit Room');
  await delay(600);
  const count = await evaluate(a, "document.querySelectorAll('.inventory-item').length");
  assert.equal(count, Object.keys(FURNITURE_CATALOG).length);
  await evaluate(
    a,
    "Array.from(document.querySelectorAll('.inventory-item')).find(b=>b.querySelector('strong').textContent==='Póster personalizable').click()",
  );
  await wait(a, "performance.getEntriesByType('resource').some(r=>r.name.includes('03_poster'))");
  await floorClick(a, 1.5, 0);
  await wait(
    a,
    "document.querySelector('.selection-panel h3')?.textContent==='Póster personalizable'",
  );
  await click(a, 'Save Room');
  await wait(
    a,
    "document.querySelector('.save-status')?.textContent.includes('All changes saved')",
  );
  await click(a, 'Configurar / usar');
  await wait(a, "!!document.querySelector('.object-panel input[type=file]')");
  await evaluate(
    a,
    `(()=>{const c=document.createElement('canvas');c.width=3000;c.height=1700;const x=c.getContext('2d');x.fillStyle='#c9c0e7';x.fillRect(0,0,c.width,c.height);x.fillStyle='#304a41';x.font='bold 240px sans-serif';x.fillText('SOCIAL ROOMS',100,900);return new Promise(resolve=>c.toBlob(b=>{const dt=new DataTransfer();dt.items.add(new File([b],'test-photo.png',{type:'image/png'}));const input=document.querySelector('.object-panel input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));resolve();},'image/png'))})()`,
  );
  await wait(a, "!!document.querySelector('.image-preview img')");
  await click(a, 'Guardar imagen y ajustes');
  await wait(
    a,
    `fetch('/api/rooms/${room.id}').then(r=>r.json()).then(r=>r.items[0].config.images.length===1)`,
  );
  const saved = await evaluate(a, `fetch('/api/rooms/${room.id}').then(r=>r.json())`);
  assert.ok(saved.items[0].config.images[0].startsWith('/api/media/'));
  for (let tick = 0; tick < 40 && !sharedImage; tick++) await delay(25);
  assert.equal(sharedImage, saved.items[0].config.images[0]);
  const visitorImage = await fetch(url + sharedImage, { headers: { Cookie: cookie } });
  assert.equal(visitorImage.status, 200);
  assert.equal(visitorImage.headers.get('content-type'), 'image/webp');
  await evaluate(a, 'document.querySelector(\'[aria-label="Cerrar panel"]\').click()');
  await click(a, 'Done decorating');
  await wait(a, "!!document.querySelector('.object-context')");
  await key(a, 'keyDown', 'e');
  await key(a, 'keyUp', 'e');
  await wait(a, "!!document.querySelector('.photo-view img')");
  await evaluate(a, "document.querySelector('.photo-view').click()");
  await wait(a, "!!document.querySelector('.enlarged-photo img')");
  await click(a, 'Cerrar imagen');
  let shot = await send('Page.captureScreenshot', { format: 'png' }, a);
  await writeFile('/private/tmp/social-rooms-object-panel.png', Buffer.from(shot.data, 'base64'));
  await send('Page.reload', {}, a);
  await wait(a, "!!document.querySelector('.object-context')");
  await key(a, 'keyDown', 'e');
  await key(a, 'keyUp', 'e');
  await wait(a, "!!document.querySelector('.photo-view img')");
  const restored = await evaluate(
    a,
    "document.querySelector('.photo-view img').getAttribute('src')",
  );
  assert.equal(restored, saved.items[0].config.images[0]);
  await evaluate(a, 'document.querySelector(\'[aria-label="Cerrar panel"]\').click()');
  console.log(
    `PASS: all ${count} inventory items, GLB placement, image conversion/upload/preview/save, E interaction, enlargement, database restoration`,
  );
  // Exercise every GLB in the same real browser; one item at a time keeps software rendering light.
  const registry = JSON.parse(
    await readFile(new URL('../src/data/objects.json', import.meta.url), 'utf8'),
  );
  for (const [type, info] of Object.entries(registry)) {
    await evaluate(
      a,
      `(async()=>fetch('/api/rooms/${room.id}',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':(await fetch('/api/auth/session').then(r=>r.json())).csrfToken},body:JSON.stringify({items:[{id:'test-'+${JSON.stringify(type)},type:${JSON.stringify(type)},position:[1.5,0,0],rotation:0,config:${JSON.stringify(info.defaults)}}]})}))()`,
    );
    await send('Page.reload', {}, a);
    await wait(a, "!!document.querySelector('.object-context')");
    await wait(
      a,
      `performance.getEntriesByType('resource').some(r=>r.name.includes(${JSON.stringify(info.file.replace('.glb', ''))}))`,
    );
    await key(a, 'keyDown', 'e');
    await key(a, 'keyUp', 'e');
    await wait(a, "!!document.querySelector('.object-panel')");
    assert.equal(
      await evaluate(a, "document.querySelector('.object-panel h2').textContent"),
      info.label,
    );
    if (type === 'handChair' || type === 'plasticThrone') {
      await click(a, 'Sentarse');
      await wait(
        a,
        "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Levantarse')",
      );
      const occupied = await new Promise((resolve) =>
        observer.emit('player_sit', { itemId: 'test-' + type, slot: 0 }, resolve),
      );
      assert.equal(occupied.ok, false);
      await click(a, 'Levantarse');
      await delay(75);
      const available = await new Promise((resolve) =>
        observer.emit('player_sit', { itemId: 'test-' + type, slot: 0 }, resolve),
      );
      assert.equal(available.ok, true);
      await new Promise((resolve) => observer.emit('player_stand', {}, resolve));
    }
    if (
      ['eyePlant', 'wingToaster', 'giantDuck', 'tinyDoor', 'mysteryBox', 'noTouchButton'].includes(
        type,
      )
    ) {
      const button = {
        eyePlant: 'Regar',
        wingToaster: 'Hacer tostada',
        giantDuck: '¡Cuac!',
        tinyDoor: 'Llamar a la puerta',
        mysteryBox: 'Abrir caja',
        noTouchButton: 'Pulsar (¡bajo tu responsabilidad!)',
      }[type];
      await click(a, button);
      await delay(100);
    }
    if (type === 'magicMirror') {
      await click(a, 'Gafas');
      await delay(100);
    }
    if (type === 'visitorBoard') {
      await evaluate(
        a,
        "(()=>{const c=document.querySelector('.drawing-canvas');for(const [type,x,y] of [['pointerdown',100,100],['pointermove',150,140],['pointerup',150,140]]){const r=c.getBoundingClientRect();c.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,clientX:r.x+x,clientY:r.y+y}));}})()",
      );
      await click(a, 'Guardar aportación');
      await wait(a, "document.querySelectorAll('.drawing-posts article').length===1");
    }
    if (type === 'guestBook') {
      await evaluate(a, "document.querySelector('.object-panel textarea').focus()");
      await send('Input.insertText', { text: 'Hola desde el navegador' }, a);
      await click(a, 'Dejar mensaje');
      await wait(
        a,
        "document.querySelector('.guest-page blockquote')?.textContent==='Hola desde el navegador'",
      );
    }
    if (type === 'discoBall' || type === 'coneLamp') {
      await click(a, 'Activar');
      await wait(
        a,
        "Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Desactivar')",
      );
      await delay(1100);
      await click(a, 'Desactivar');
    }
    await evaluate(a, 'document.querySelector(\'[aria-label="Cerrar panel"]\').click()');
    await delay(75);
    console.log('PASS: model + panel', type);
  }

  // Resource cleanup: temporary particle geometry is removed after its deadline.
  await evaluate(
    a,
    `(async()=>fetch('/api/rooms/${room.id}',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':(await fetch('/api/auth/session').then(r=>r.json())).csrfToken},body:JSON.stringify({items:[{id:'water-test-${room.id}',type:'eyePlant',position:[1.5,0,0],rotation:0,config:{}}]})}))()`,
  );
  await send('Page.reload', {}, a);
  await wait(a, "!!document.querySelector('.object-context')");
  await key(a, 'keyDown', 'e');
  await key(a, 'keyUp', 'e');
  await wait(a, "!!document.querySelector('.object-panel')");
  await delay(200);
  const baseline = await evaluate(a, 'window.__screenTest.buffers.size');
  await click(a, 'Regar');
  await delay(500);
  const during = await evaluate(a, 'window.__screenTest.buffers.size');
  await delay(3200);
  const after = await evaluate(a, 'window.__screenTest.buffers.size');
  assert.ok(during > baseline);
  assert.ok(after < during);
  console.log('PASS: temporary particle buffers disposed after reaction', {
    baseline,
    during,
    after,
  });
  await evaluate(a, 'document.querySelector(\'[aria-label="Cerrar panel"]\').click()');
  // Real, browser-decoded WAV upload and shared radio playback, then room-leave cleanup.
  await evaluate(
    a,
    `(async()=>fetch('/api/rooms/${room.id}',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':(await fetch('/api/auth/session').then(r=>r.json())).csrfToken},body:JSON.stringify({items:[{id:'radio-test-${room.id}',type:'retroRadio',position:[1.5,0,0],rotation:0,config:{tracks:[]}}]})}))()`,
  );
  await send('Page.reload', {}, a);
  await wait(a, "!!document.querySelector('.object-context')");
  await key(a, 'keyDown', 'e');
  await key(a, 'keyUp', 'e');
  await wait(a, "!!document.querySelector('.object-panel')");
  await click(a, 'Configurar');
  await evaluate(
    a,
    `(()=>{const count=8000*12,buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer),write=(offset,text)=>{for(let i=0;i<text.length;i++)v.setUint8(offset+i,text.charCodeAt(i))};write(0,'RIFF');v.setUint32(4,36+count*2,true);write(8,'WAVE');write(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);write(36,'data');v.setUint32(40,count*2,true);for(let i=0;i<count;i++)v.setInt16(44+i*2,Math.sin(i/8000*440*Math.PI*2)*2000,true);const dt=new DataTransfer();dt.items.add(new File([buffer],'browser-tone.wav',{type:'audio/wav'}));const input=document.querySelector('.object-panel input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait(
    a,
    "document.querySelector('.object-panel input[aria-label=\"Título de audio\"]')?.value==='browser-tone.wav'",
  );
  await click(a, 'Guardar configuración');
  await wait(
    a,
    `fetch('/api/rooms/${room.id}').then(r=>r.json()).then(r=>r.items[0].config.tracks.length===1)`,
  );
  await click(a, 'Interactuar');
  await click(a, 'Activar sonido');
  await click(a, 'Reproducir');
  await wait(
    a,
    '[...window.__screenTest.audioElements].some(audio=>audio.currentTime>.1&&!audio.paused)',
  );
  await click(a, 'Pausar');
  await wait(a, 'window.__screenTest.audioElements.size===0');
  await click(a, 'Reproducir');
  await wait(
    a,
    '[...window.__screenTest.audioElements].some(audio=>audio.currentTime>.1&&!audio.paused)',
  );
  await evaluate(a, 'document.querySelector(\'[aria-label="Cerrar panel"]\').click()');
  await click(a, 'Go to Living Room');
  await wait(a, "document.querySelector('h1')?.textContent==='Meet in the living room.'");
  assert.equal(await evaluate(a, 'window.__screenTest.audioElements.size'), 0);
  assert.equal(await evaluate(a, 'window.__screenTest.audioContexts.size'), 0);
  console.log(
    'PASS: actual WAV decoding/upload, play/pause, shared state and room-leave audio cleanup',
  );
  // Return home using a real portal test is covered by the server permission tests; UI directory retains corridors.
  await send('Page.reload', {}, a);
  await wait(a, "!!document.querySelector('.object-context')");
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    a,
  );
  await delay(100);
  await evaluate(a, "document.querySelector('.object-context').click()");
  await wait(a, "!!document.querySelector('.object-panel')");
  const bounds = await evaluate(
    a,
    "(()=>{const r=document.querySelector('.object-panel').getBoundingClientRect();return [r.left,r.right,r.bottom]})()",
  );
  assert.ok(bounds[0] >= 0 && bounds[1] <= 390 && bounds[2] <= 844);
  await evaluate(a, `document.querySelector('[aria-label="Cerrar panel"]').click()`);
  await send('Emulation.setTouchEmulationEnabled', { enabled: true }, a);
  await wait(a, "getComputedStyle(document.querySelector('.touch-movement')).display==='grid'");
  const initial = await evaluate(a, 'window.__screenTest.position');
  const touchPoint = await evaluate(
    a,
    "(()=>{const r=document.querySelector('.touch-KeyW').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
  );
  await send(
    'Input.dispatchTouchEvent',
    { type: 'touchStart', touchPoints: [{ ...touchPoint, id: 1 }] },
    a,
  );
  try {
    await wait(
      a,
      `Math.hypot(window.__screenTest.position[0]-${initial[0]},window.__screenTest.position[2]-${initial[2]})>.15`,
    );
  } finally {
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, a);
  }
  assert.deepEqual(errors.get(a), []);
  console.log(
    'PASS: mobile contextual control, panel fit and actual touch movement; no browser runtime errors',
  );
} finally {
  observer?.disconnect();
  for (const browserContextId of contexts) {
    try {
      await send('Target.disposeBrowserContext', { browserContextId });
    } catch (error) {
      console.warn(error.message);
    }
  }
  connection.close();
  clearInterval(keepAlive);
}
