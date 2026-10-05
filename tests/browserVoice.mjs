import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Opt-in test: use an isolated Chromium instance on port 9229 with fake-media
// flags (see backend/PROXIMITY_VOICE.md). No real microphone is captured.
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
  if (message.method === 'Runtime.exceptionThrown') {
    errors.get(message.sessionId)?.push(message.params.exceptionDetails.exception?.description);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    errors.get(message.sessionId)?.push(message.params.args.map(arg => arg.description || arg.value));
  }
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
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await evaluate(session, expression)) return;
    await delay(100);
  }
  const state = await evaluate(session, `(async()=>({status:document.querySelector('.voice-status')?.textContent,
    error:document.querySelector('.voice-error')?.textContent,
    pcs:window.__voiceTest.peers.map(pc=>pc.connectionState),
    contexts:window.__voiceTest.contexts.map(ctx=>({state:ctx.state,time:ctx.currentTime})),
    audio:await Promise.all(window.__voiceTest.peers.filter(pc=>pc.connectionState==='connected').map(async pc=>
      Array.from((await pc.getStats()).values()).filter(stat=>stat.type==='inbound-rtp').map(stat=>
        ({kind:stat.kind,bytes:stat.bytesReceived,energy:stat.totalAudioEnergy,duration:stat.totalSamplesDuration,level:stat.audioLevel}))))
  }))()`);
  throw new Error('Timeout: ' + expression + '\n' + JSON.stringify(state));
}
async function click(session, text) {
  await evaluate(session, `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
}
async function key(session, type, key) {
  await send('Input.dispatchKeyEvent', { type, key, code: 'Key' + key.toUpperCase(), windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }, session);
}
async function walkTo(session, x, z) {
  await send('Page.bringToFront', {}, session);
  for (let attempt = 0; attempt < 120; attempt++) {
    const position = await evaluate(session, 'window.__voiceTest.position');
    const dx = x - position[0], dz = z - position[2];
    if (Math.hypot(dx, dz) < 0.35) return;
    const forward = await evaluate(session, 'window.__voiceTest.forward');
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
    const frame = await evaluate(session, 'window.__voiceTest.animationFrames || 0');
    for (const code of keys) await key(session, 'keyDown', code);
    for (let tick = 0; tick < 40; tick++) {
      await delay(25);
      if (await evaluate(session, 'window.__voiceTest.animationFrames') > frame) break;
    }
    for (const code of keys) await key(session, 'keyUp', code);
    await delay(100);
  }
  throw new Error(`Could not walk to ${x},${z}; at ${await evaluate(session, 'window.__voiceTest.position')}`);
}

const instrumentation = `
  window.__voiceTest = {peers:[],gains:[],streams:[],contexts:[],analysers:[],texts:[],position:null,deferMic:false,releaseMic:null,denyMic:false};
  const state=window.__voiceTest;
  state.animationFrames=0;
  const requestFrame=window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame=callback=>requestFrame(time=>{state.animationFrames++;callback(time)});
  // Read the rendered camera: hallway controls no longer assume a fixed 45-degree view.
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
  const Peer=window.RTCPeerConnection;
  window.RTCPeerConnection=class extends Peer {constructor(...args){super(...args);state.peers.push(this);}};
  const Context=window.AudioContext;
  window.AudioContext=class extends Context {
    constructor(...args){super(...args);state.contexts.push(this);}
    createGain(){
      const gain=super.createGain();state.gains.push(gain);
      const analyser=this.createAnalyser();gain.connect(analyser);state.analysers.push(analyser);
      return gain;
    }
  };
  const media=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async options=>{
    if(state.denyMic)throw new DOMException('Test permission denial','NotAllowedError');
    const stream=await media(options);state.streams.push(stream);
    if(state.deferMic)await new Promise(resolve=>state.releaseMic=resolve);
    return stream;
  };
  const fillText=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){state.texts.push(text);return fillText.call(this,text,...args);};
  const Socket=window.WebSocket;
  window.WebSocket=class extends Socket {
    send(data){
      if(typeof data==='string'&&data.startsWith('42')){
        // Socket.IO puts an optional acknowledgement ID before the JSON array.
        const [event,payload]=JSON.parse(data.slice(data.indexOf('[')));
        if(event==='player_move')state.position=payload.position;
      }
      return super.send(data);
    }
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
  await wait(sessionId, "document.querySelector('h1')?.textContent === 'Meet in the living room.' && document.querySelector('.live-status')?.textContent.includes('here') && !!window.__voiceTest.position && !!window.__voiceTest.forward");
  await delay(1000);
  return sessionId;
}

const voiceOn = "document.querySelector('.voice-status')?.textContent.startsWith('Mic on')";
const voiceConnected = "document.querySelector('.voice-status')?.textContent.includes('1 connected')";
const gain = 'window.__voiceTest.gains.at(-1)?.gain.value';
const stopped = 'window.__voiceTest.streams.every(stream=>stream.getTracks().every(track=>track.readyState===\'ended\'))';
try {
  const a = await makePage('Voice Test A');
  const b = await makePage('Voice Test B');
  for (const session of [a, b]) {
    await wait(session, "window.__voiceTest.texts.includes('Voice Test A') && window.__voiceTest.texts.includes('Voice Test B')");
    await click(session, 'Join Voice');
    await wait(session, voiceOn);
  }
  console.log('PASS: both chosen names render on avatar labels; voice needs explicit opt-in');
  await walkTo(a, -8.2, 0.95); await walkTo(a, -3.5, 0.95);
  await walkTo(a, -3.5, 1.7); await walkTo(a, 0, 1.7);
  await walkTo(b, 8.2, 0.95); await walkTo(b, 3.5, 0.95);
  await walkTo(b, 3.5, 1.7); await walkTo(b, 1, 1.7);
  for (const session of [a, b]) {
    await wait(session, voiceConnected);
    await wait(session, `${gain} > 0.95`);
    await wait(session, `(async()=>{
      const pc=window.__voiceTest.peers.find(pc=>pc.connectionState==='connected');
      if(!pc)return false;
      const stats=Array.from((await pc.getStats()).values());
      const analyser=window.__voiceTest.analysers.at(-1);
      const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
      return stats.some(stat=>stat.type==='inbound-rtp'&&stat.kind==='audio'&&stat.bytesReceived>0)
        && samples.some(value=>Math.abs(value)>0.001);
    })()`);
  }
  console.log('PASS: two actual WebRTC audio connections receive nonzero simulated-microphone audio');
  const shot = await send('Page.captureScreenshot', { format: 'png' }, a);
  await writeFile(join(tmpdir(), 'social-rooms-proximity-voice.png'), Buffer.from(shot.data, 'base64'));
  await click(a, 'Mute mic');
  await wait(a, 'window.__voiceTest.streams.at(-1).getAudioTracks().every(track=>!track.enabled)');
  await wait(b, `${gain} < 0.002`);
  await click(a, 'Unmute mic');
  await wait(a, 'window.__voiceTest.streams.at(-1).getAudioTracks().every(track=>track.enabled)');
  await wait(b, `${gain} > 0.95`);
  console.log('PASS: mute stops transmission and silences the remote gain; unmute restores it');
  await walkTo(b, 3.5, 1.7); await walkTo(b, 3.5, 0.95); await walkTo(b, 7, 0.95);
  await wait(a, `${gain} > 0.001 && ${gain} < 0.1`);
  await walkTo(b, 8.8, 0.95);
  await wait(a, `${gain} < 0.002`);
  await walkTo(b, 10.8, 0.95);
  await wait(a, "window.__voiceTest.peers.every(pc=>pc.connectionState==='closed')");
  await walkTo(b, 3.5, 0.95); await walkTo(b, 3.5, 1.7); await walkTo(b, 1, 1.7);
  await wait(a, voiceConnected); await wait(b, voiceConnected);
  console.log('PASS: walking reduces volume, becomes inaudible, closes distant calls, and reconnects on approach');
  await click(a, 'Leave Voice'); await wait(a, stopped);
  await click(b, 'Leave Voice'); await wait(b, stopped);
  await evaluate(b, 'window.__voiceTest.deferMic=true');
  await click(b, 'Join Voice'); await wait(b, '!!window.__voiceTest.releaseMic');
  await click(b, 'Cancel');
  await evaluate(b, 'window.__voiceTest.releaseMic();window.__voiceTest.deferMic=false');
  await wait(b, stopped);
  await evaluate(b, 'window.__voiceTest.denyMic=true');
  await click(b, 'Join Voice');
  await wait(b, "document.querySelector('.voice-error')?.textContent.includes('permission was denied')");
  await evaluate(b, 'window.__voiceTest.denyMic=false');
  console.log('PASS: leaving stops microphone tracks; a late permission result is stopped; denial is shown clearly');
  await click(a, 'Join Voice'); await wait(a, voiceOn);
  await walkTo(a, -3.5, 1.7); await walkTo(a, -3.5, 0.95);
  await walkTo(a, -8.2, 0.95); await walkTo(a, -8.2, -0.6);
  await wait(a, "document.querySelector('.door-prompt')?.textContent.includes('Voice Test A')");
  await key(a, 'keyDown', 'e'); await key(a, 'keyUp', 'e');
  await wait(a, "document.querySelector('h1')?.textContent === 'Voice Test A’s bedroom'");
  await wait(a, stopped);
  await wait(a, "document.querySelector('.voice-status')?.textContent.startsWith('Talk with')");
  console.log('PASS: entering a bedroom stops the previous room microphone and resets voice controls');
  for (const session of [a, b]) assert.deepEqual(errors.get(session), []);
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
