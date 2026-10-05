import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Opt-in browser check. Display capture is replaced ONLY here with a moving canvas;
// real WebRTC, socket signaling, UI, and keyboard movement are exercised.
const url = process.env.TEST_SERVER_URL || 'http://127.0.0.1:5003';
const metadata = await (await fetch('http://127.0.0.1:9229/json/version')).json();
const connection = new WebSocket(metadata.webSocketDebuggerUrl);
await new Promise(resolve => connection.addEventListener('open', resolve, { once: true }));
// Keep Node alive while a slow browser command is waiting for its response.
const keepAlive = setInterval(() => {}, 1000);
let sequence = 0;
const pending = new Map(), errors = new Map(), contexts = [];
connection.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') errors.get(message.sessionId)?.push(message.params.exceptionDetails.exception?.description);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.get(message.sessionId)?.push(message.params.args.map(arg => arg.description || arg.value));
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
      resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
  });
  connection.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return result;
}
async function evaluate(session, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, session);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(session, expression) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await evaluate(session, expression)) return;
    await delay(100);
  }
  throw new Error('Timeout: ' + expression + '\n' + JSON.stringify(await evaluate(session, `({
    status:document.querySelector('.screen-status')?.textContent,error:document.querySelector('.screen-error')?.textContent,
    position:window.__screenTest.position,pcs:window.__screenTest.peers.map(pc=>pc.connectionState)})`)));
}
async function click(session, text) {
  await evaluate(session, `Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`);
}
async function key(session, type, key) {
  await send('Input.dispatchKeyEvent', { type, key, code: 'Key' + key.toUpperCase(), windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }, session);
}
async function walkTo(session, x, z) {
  await send('Page.bringToFront', {}, session);
  for (let attempt = 0; attempt < 120; attempt++) {
    const position = await evaluate(session, 'window.__screenTest.position');
    const dx = x - position[0], dz = z - position[2];
    if (Math.hypot(dx, dz) < 0.3) return;
    const forward = await evaluate(session, 'window.__screenTest.forward');
    const length = Math.hypot(...forward);
    const desired = [dx, dz];
    const f = (desired[0] * forward[0] + desired[1] * forward[1]) / length;
    const r = (-desired[0] * forward[1] + desired[1] * forward[0]) / length;
    // Choose the closest of the eight WASD directions, including diagonals.
    const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    const [moveForward, moveRight] = directions.reduce((best, direction) =>
      (direction[0]*f+direction[1]*r)/Math.hypot(...direction) >
      (best[0]*f+best[1]*r)/Math.hypot(...best) ? direction : best);
    const keys = [];
    if (moveForward) keys.push(moveForward > 0 ? 'w' : 's');
    if (moveRight) keys.push(moveRight > 0 ? 'd' : 'a');
    // Wait for one rendered frame so slow headless rendering cannot miss a short key press.
    const frame = await evaluate(session, 'window.__screenTest.animationFrames || 0');
    for (const code of keys) await key(session, 'keyDown', code);
    for (let tick = 0; tick < 40; tick++) {
      await delay(25);
      if (await evaluate(session, 'window.__screenTest.animationFrames') > frame) break;
    }
    for (const code of keys) await key(session, 'keyUp', code);
    await delay(100);
  }
  throw new Error(`Could not walk to ${x},${z}; at ${await evaluate(session, 'window.__screenTest.position')}`);
}
const instrumentation = `
  window.__screenTest={peers:[],streams:[],position:null,frames:0,previews:[],deny:false,defer:false,release:null,options:null};
  const state=window.__screenTest;
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
    if(uniform?.name==='projectionMatrix')perspective.set(uniform.program,data[15]===0);
    // Observe uploads without synchronous GPU reads; ignore the orthographic shadow camera.
    if(uniform?.name==='viewMatrix'&&perspective.get(uniform.program))state.forward=[-data[2],-data[10]];
    return matrix.call(this,location,transpose,data,...rest);
  };
  navigator.mediaDevices.getDisplayMedia=async options=>{
    state.options=options;
    if(state.deny)throw new DOMException('Test screen denial','NotAllowedError');
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
    const context=canvas.getContext('2d');let frame=0;
    const paint=()=>{
      context.fillStyle='#314e46';context.fillRect(0,0,1280,720);
      context.fillStyle='#fff8e8';context.font='bold 64px system-ui';context.fillText('Social Rooms · Screen Test',80,130);
      context.font='36px system-ui';context.fillText('720p simulated screen · frame '+frame++,80,210);
      context.fillStyle='#c6d4ad';context.fillRect(80+frame%700,300,240,240);
    };
    paint();const timer=setInterval(paint,33);const stream=canvas.captureStream(30);state.streams.push(stream);
    const track=stream.getVideoTracks()[0];const stop=track.stop.bind(track);
    track.stop=()=>{clearInterval(timer);stop()};
    if(state.defer)await new Promise(resolve=>state.release=resolve);
    return stream;
  };
  const Peer=window.RTCPeerConnection;
  window.RTCPeerConnection=class extends Peer {constructor(...args){super(...args);state.peers.push(this)}};
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  await wait(sessionId, "!!document.querySelector('#bedroom-name')");
  await evaluate(sessionId, "document.querySelector('input').focus()");
  await send('Input.insertText', { text: name }, sessionId);
  await click(sessionId, 'Enter the house');
  await wait(sessionId, "document.querySelector('.live-status')?.textContent.includes('here')");
  await click(sessionId, 'Go to Living Room');
  await wait(sessionId, "document.querySelector('h1')?.textContent==='Meet in the living room.' && !!window.__screenTest.position && !!window.__screenTest.forward");
  await delay(1000);
  return sessionId;
}
const sharing = "!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Stop sharing')";
const canView = "!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='View screen'&&!b.disabled)";
const stopped = "window.__screenTest.streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))";
try {
  // Reuse the first two identities from browserVoice, so their doors stay at ±8.2.
  const a = await makePage('Voice Test A'), b = await makePage('Voice Test B');
  const hallwayShot = await send('Page.captureScreenshot', { format: 'png' }, a);
  await writeFile(join(tmpdir(), 'social-rooms-enclosed-hallway.png'), Buffer.from(hallwayShot.data, 'base64'));
  assert.equal(await evaluate(a,"Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Share screen')"),false);
  await walkTo(a,-3.4,0.7);await walkTo(a,-3.4,1.25);await walkTo(a,-0.8,1.25);
  await wait(a,"!!document.querySelector('.screen-panel')");
  await click(a, 'Share screen');
  await wait(a, sharing);
  await wait(b, 'window.__screenTest.frames>=2');
  assert.equal(await evaluate(b, 'window.__screenTest.peers.length'), 0);
  assert.equal(await evaluate(b, canView), false);
  assert.equal(await evaluate(b,'window.__screenTest.previews[1].time-window.__screenTest.previews[0].time>=4300'),true);
  assert.deepEqual(await evaluate(b,`(async()=>{
    const image=new Image();image.src=window.__screenTest.previews[0].frame;await image.decode();return[image.width,image.height];
  })()`),[240,135]);
  assert.deepEqual(await evaluate(a, 'window.__screenTest.options'), {
    video:{width:{ideal:1280,max:1280},height:{ideal:720,max:720},frameRate:{ideal:30,max:30}},audio:false,
  });
  console.log('PASS: projector buttons require approach; previews are 240×135 stills five seconds apart without full-video connections');
  await walkTo(b, 3.4, 0.7); await walkTo(b, 3.4, 1.25); await walkTo(b, 0.8, 1.25);
  await wait(b, canView);
  const previewShot = await send('Page.captureScreenshot', { format: 'png' }, b);
  await writeFile(join(tmpdir(), 'social-rooms-projector-preview.png'), Buffer.from(previewShot.data, 'base64'));
  await click(b, 'View screen');
  await wait(b, "document.querySelector('.screen-viewer')?.open && document.querySelector('.screen-viewer video')?.videoWidth>0");
  await wait(b, `(async()=>{
    const pc=window.__screenTest.peers.find(pc=>pc.connectionState==='connected');
    if(!pc)return false;
    return Array.from((await pc.getStats()).values()).some(s=>s.type==='inbound-rtp'&&s.kind==='video'&&s.framesDecoded>5&&s.frameWidth===1280&&s.frameHeight===720);
  })()`);
  const size = await evaluate(b, "[document.querySelector('.screen-viewer video').videoWidth,document.querySelector('.screen-viewer video').videoHeight]");
  assert.deepEqual(size, [1280,720]);
  const before = await evaluate(b, 'window.__screenTest.position');
  await key(b,'keyDown','w');await delay(300);await key(b,'keyUp','w');
  assert.deepEqual(await evaluate(b, 'window.__screenTest.position'), before);
  const shot = await send('Page.captureScreenshot', { format: 'png' }, b);
  await writeFile(join(tmpdir(), 'social-rooms-screen-viewer.png'), Buffer.from(shot.data, 'base64'));
  console.log('PASS: walking to projector enables View; real WebRTC decodes 1280×720 video; viewer pauses movement');
  await click(b, 'Close viewer');
  await wait(b, "window.__screenTest.peers.every(pc=>pc.connectionState==='closed')");
  await wait(a, "window.__screenTest.peers.every(pc=>pc.connectionState==='closed')");
  await click(b, 'View screen');await wait(b,"document.querySelector('.screen-viewer video')?.videoWidth>0");
  await click(a,'Stop sharing');await wait(a,stopped);
  await wait(b,"!document.querySelector('.screen-viewer') && document.querySelector('.screen-status').textContent.includes('Put something')");
  console.log('PASS: closing disconnects viewer; viewing again reconnects; stopping capture closes remote viewing');
  await evaluate(a,'window.__screenTest.defer=true');await click(a,'Share screen');
  await wait(a,'!!window.__screenTest.release');await click(a,'Cancel');
  await evaluate(a,'window.__screenTest.release();window.__screenTest.defer=false');await wait(a,stopped);
  await evaluate(a,'window.__screenTest.deny=true');await click(a,'Share screen');
  await wait(a,"document.querySelector('.screen-error')?.textContent.includes('denied')");
  await evaluate(a,'window.__screenTest.deny=false');
  console.log('PASS: canceled late capture is stopped; permission denial is shown');
  await click(a,'Share screen');await wait(a,sharing);await wait(b,'window.__screenTest.frames>=4');
  await evaluate(a,"window.__screenTest.streams.at(-1).getVideoTracks()[0].dispatchEvent(new Event('ended'))");
  await wait(a,stopped);await wait(b,"document.querySelector('.screen-status').textContent.includes('Put something')");
  await click(a,'Share screen');await wait(a,sharing);
  await click(a,'Join Voice');await click(b,'Join Voice');
  await wait(a,"document.querySelector('.voice-status')?.textContent.includes('1 connected')");
  await wait(b,"document.querySelector('.voice-status')?.textContent.includes('1 connected')");
  await click(b,'View screen');await wait(b,"document.querySelector('.screen-viewer video')?.videoWidth>0");
  assert.equal(await evaluate(b,"document.querySelector('.voice-status').textContent.includes('1 connected')"),true);
  await click(b,'Close viewer');
  console.log('PASS: browser-ended capture clears projector; proximity voice and screen video work together');
  await walkTo(a,-3.4,1.25);await walkTo(a,-3.4,0.7);await walkTo(a,-8.2,0.7);await walkTo(a,-8.2,-0.6);
  await wait(a,"document.querySelector('.door-prompt')?.textContent.includes('Voice Test A')");
  await key(a,'keyDown','e');await key(a,'keyUp','e');
  await wait(a,"document.querySelector('h1')?.textContent==='Voice Test A’s bedroom'");
  await delay(1000);
  const bedroomShot = await send('Page.captureScreenshot', { format: 'png' }, a);
  await writeFile(join(tmpdir(), 'social-rooms-entered-bedroom.png'), Buffer.from(bedroomShot.data, 'base64'));
  await wait(a,stopped);await wait(b,"document.querySelector('.screen-status').textContent.includes('Put something')");
  console.log('PASS: leaving living room stops capture and clears projector for everyone');
  for(const session of[a,b]) assert.deepEqual(errors.get(session),[]);
  console.log('PASS: no browser runtime exceptions or console errors');
} finally {
  // Cleanup failures should not replace the original assertion or timeout error.
  for (const browserContextId of contexts) {
    try { await send('Target.disposeBrowserContext', { browserContextId }); }
    catch (error) { console.warn('Browser cleanup:', error.message); }
  }
  connection.close();
  clearInterval(keepAlive);
}
