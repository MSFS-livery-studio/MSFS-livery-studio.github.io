import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const VERSION = '0.7.4';
const PROFILE_URL = './Profiles/A380X/profile.json';
const PROFILE_BASE = new URL('./Profiles/A380X/', location.href).href;
const W = 1024, H = 1024;

const $ = (id) => document.getElementById(id);
const ui = {
  list: $('surfaceList'), canvas: $('designCanvas'), title: $('surfaceTitle'), hint: $('surfaceHint'),
  status: $('statusText'), coords: $('coordText'), dot: $('profileDot'), profileStatus: $('profileStatus'),
  designer: $('designerView'), preview: $('previewView'), uvView: $('uvView'),
  btn2d: $('btn2d'), btn3d: $('btn3d'), btnUV: $('btnUV'),
  threeHost: $('threeHost'), guideToggle: $('guideToggle'), mirror: $('mirrorToggle'),
  paintColor: $('paintColor'), brushSize: $('brushSize'), brushSizeLabel: $('brushSizeLabel'),
  textInput: $('textInput'), textSize: $('textSize'), textColor: $('textColor'), fontSelect: $('fontSelect'),
  objectEmpty: $('objectEmpty'), objectControls: $('objectControls'),
  exportModal: $('exportModal'), progressBar: $('progressBar'), progressText: $('progressText'),
  uvCanvas: $('uvCanvas'), uvTextureSelect: $('uvTextureSelect'), uvBusy: $('uvBusy'),
  previewBusy: $('previewBusy'), previewLoadingDetail: $('previewLoadingDetail'),
  toast: $('toast'),
  googleState: $('googleState'), btnGoogle: $('btnGoogle'), btnGoogleTop: $('btnGoogleTop'),
  btnCloudSave: $('btnCloudSave'), btnCloudLoad: $('btnCloudLoad'), cloudAutosave: $('cloudAutosave'),
  cloudSavedAt: $('cloudSavedAt'), googleSetupModal: $('googleSetupModal'),
  googleOrigin: $('googleOrigin'), googleClientIdInput: $('googleClientIdInput')
};

const ctx = ui.canvas.getContext('2d', { alpha: true, willReadFrequently: false });
let profile = null;
let surfaces = [];
let current = 0;
let tool = 'brush';
let painting = false;
let lastPoint = null;
let selectedObject = -1;
let dragObjectOffset = null;
let history = [];
let exportWorker = null;
let previewDirtyRegions = new Set();
let previewUpdateTimer = 0;



const GOOGLE_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
const DRIVE_PROJECT_NAME = 'MSFS_Livery_Studio_Current_Project.json';

let googleTokenClient = null;
let googleTokenResolver = null;
let googleAccessToken = '';
let googleTokenExpiresAt = 0;
let googleUser = null;
let cloudSaveTimer = 0;
let cloudSaving = false;
let projectDirty = false;
let uvWorker = null;
let uvPreviewDirty = true;
let uvPreviewCache = new Map();

function configuredGoogleClientId() {
  return (window.MSFS_LIVERY_CONFIG?.googleClientId || localStorage.getItem('mls-google-client-id') || '').trim();
}
function waitForGoogleIdentity(timeout=12000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now()-start > timeout) return reject(new Error('Google Identity Services did not load'));
      setTimeout(tick, 100);
    };
    tick();
  });
}
async function ensureGoogleClient() {
  const clientId = configuredGoogleClientId();
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID_REQUIRED');
  await waitForGoogleIdentity();
  if (!googleTokenClient || googleTokenClient.__clientId !== clientId) {
    googleTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPE,
      include_granted_scopes: true,
      callback: (resp) => {
        if (resp?.error) {
          googleTokenResolver?.reject(new Error(resp.error_description || resp.error));
        } else {
          googleAccessToken = resp.access_token || '';
          googleTokenExpiresAt = Date.now() + Math.max(60, Number(resp.expires_in || 3600) - 60) * 1000;
          googleTokenResolver?.resolve(resp);
        }
        googleTokenResolver = null;
      }
    });
    googleTokenClient.__clientId = clientId;
  }
}
async function requestGoogleToken(prompt='') {
  await ensureGoogleClient();
  if (googleAccessToken && Date.now() < googleTokenExpiresAt) return googleAccessToken;
  return await new Promise((resolve, reject) => {
    googleTokenResolver = {resolve: (resp)=>resolve(resp.access_token), reject};
    googleTokenClient.requestAccessToken({prompt});
  });
}
async function connectGoogle() {
  try {
    if (!configuredGoogleClientId()) return openGoogleSetup();
    const token = await requestGoogleToken('consent');
    try {
      const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers:{Authorization:`Bearer ${token}`}
      });
      if (r.ok) googleUser = await r.json();
    } catch {}
    setGoogleConnectedUI();
    setStatus('Google Drive connected');
    toast('Google Drive connected');
  } catch (err) {
    if (String(err.message).includes('GOOGLE_CLIENT_ID_REQUIRED')) return openGoogleSetup();
    console.error(err);
    const msg = String(err?.message || err);
    if (msg.includes('access_denied')) {
      setStatus('Google access denied. Confirm the OAuth app is In production or this account is a Test user.');
    } else {
      setStatus(`Google connection failed: ${msg}`);
    }
    toast('Google connection failed');
  }
}
function setGoogleConnectedUI() {
  const label = googleUser?.email || googleUser?.name || 'Google connected';
  ui.googleState.classList.add('connected');
  ui.googleState.querySelector('span:last-child').textContent = label;
  ui.btnGoogle.textContent = 'Reconnect Google';
  ui.btnGoogleTop.textContent = 'Google ✓';
  ui.btnCloudSave.disabled = false;
  ui.btnCloudLoad.disabled = false;
  ui.cloudAutosave.disabled = false;
}
function openGoogleSetup() {
  ui.googleOrigin.textContent = location.origin;
  ui.googleClientIdInput.value = configuredGoogleClientId();
  ui.googleSetupModal.classList.remove('hidden');
}
function closeGoogleSetup() {
  ui.googleSetupModal.classList.add('hidden');
}

async function canvasToDataURL(canvas) {
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not encode project image')), 'image/png')
  );
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('Could not read project image'));
    fr.readAsDataURL(blob);
  });
}
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('Could not read image'));
    fr.readAsDataURL(file);
  });
}
async function dataURLToBitmap(dataURL) {
  const r = await fetch(dataURL);
  return await createImageBitmap(await r.blob());
}
async function serializeProject() {
  const packed = [];
  for (let i=0; i<surfaces.length; i++) {
    const paintPNG = await canvasToDataURL(surfaces[i].paint);
    const objects = surfaces[i].objects.map(o => {
      if (o.type === 'image') return {type:'image', source:o.source || '', x:o.x, y:o.y, w:o.w, h:o.h};
      return {type:'text', text:o.text, size:o.size, color:o.color, font:o.font, x:o.x, y:o.y};
    });
    packed.push({paintPNG, objects});
  }
  return {
    format:'msfs-livery-studio-web-project',
    version:VERSION,
    savedAt:new Date().toISOString(),
    profileId:profile.id,
    currentSurface:current,
    mirror:ui.mirror.checked,
    showGuide:ui.guideToggle.checked,
    package:{
      title:$('pkgTitle').value, variation:$('pkgVariation').value, registration:$('pkgRegistration').value,
      manufacturer:$('pkgManufacturer').value, model:$('pkgModel').value, creator:$('pkgCreator').value,
      base:$('pkgBase').value, description:$('pkgDescription').value
    },
    surfaces:packed
  };
}
async function restoreProject(project) {
  if (!project || project.format !== 'msfs-livery-studio-web-project') throw new Error('Unsupported project file');
  if (project.profileId && project.profileId !== profile.id) throw new Error(`Project uses a different aircraft profile: ${project.profileId}`);

  for (let i=0; i<surfaces.length; i++) {
    const saved = project.surfaces?.[i];
    const pctx = surfaces[i].paint.getContext('2d');
    pctx.clearRect(0,0,W,H);
    if (saved?.paintPNG) {
      const bmp = await dataURLToBitmap(saved.paintPNG);
      pctx.drawImage(bmp,0,0,W,H);
      bmp.close?.();
    }
    applyMask(surfaces[i]);
    surfaces[i].objects = [];
    for (const o of saved?.objects || []) {
      if (o.type === 'image' && o.source) {
        const bmp = await dataURLToBitmap(o.source);
        surfaces[i].objects.push({...o, image:bmp});
      } else if (o.type === 'text') {
        surfaces[i].objects.push({...o});
      }
    }
    surfaces[i].dirty = true;
    previewDirtyRegions.add(i);
  }

  const p = project.package || {};
  $('pkgTitle').value=p.title||''; $('pkgVariation').value=p.variation||''; $('pkgRegistration').value=p.registration||'';
  $('pkgManufacturer').value=p.manufacturer||''; $('pkgModel').value=p.model||''; $('pkgCreator').value=p.creator||'';
  $('pkgBase').value=p.base||''; $('pkgDescription').value=p.description||'';
  ui.mirror.checked=!!project.mirror;
  ui.guideToggle.checked=project.showGuide !== false;

  uvPreviewDirty = true;
  uvPreviewCache.clear();
  preview3d.textureDirty = true;

  selectSurface(Math.max(0,Math.min(surfaces.length-1,Number(project.currentSurface)||0)));
  projectDirty=false;
  setStatus(`Cloud project loaded · ${project.savedAt ? new Date(project.savedAt).toLocaleString() : ''}`);
}
async function driveRequest(url, options={}) {
  const token = await requestGoogleToken('');
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  const r = await fetch(url, {...options, headers});
  if (r.status === 401) {
    googleAccessToken='';
    googleTokenExpiresAt=0;
    throw new Error('Google authorization expired. Reconnect Google.');
  }
  if (!r.ok) throw new Error(`Google Drive ${r.status}: ${await r.text()}`);
  return r;
}
async function findCloudProjectFile() {
  const q = encodeURIComponent(`name='${DRIVE_PROJECT_NAME.replace(/'/g,"\\'")}' and trashed=false`);
  const fields = encodeURIComponent('files(id,name,modifiedTime,size)');
  const r = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=${fields}&orderBy=modifiedTime%20desc`
  );
  const data = await r.json();
  return data.files?.[0] || null;
}
async function saveCloudProject({silent=false}={}) {
  if (cloudSaving || !profile) return;
  cloudSaving=true;
  if(!silent){
    setStatus('Saving project to Google Drive…');
    ui.btnCloudSave.disabled=true;
  }
  try {
    const project = await serializeProject();
    const body = JSON.stringify(project);
    let file = await findCloudProjectFile();
    if (!file) {
      const create = await driveRequest('https://www.googleapis.com/drive/v3/files?fields=id,name', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          name:DRIVE_PROJECT_NAME,
          parents:['appDataFolder'],
          mimeType:'application/json'
        })
      });
      file = await create.json();
    }
    await driveRequest(`https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`, {
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body
    });
    projectDirty=false;
    const now=new Date();
    ui.cloudSavedAt.textContent=`Saved ${now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    setStatus('Project saved to Google Drive');
    if(!silent) toast('Cloud save complete');
  } finally {
    cloudSaving=false;
    if (googleAccessToken) ui.btnCloudSave.disabled=false;
  }
}
async function loadCloudProject() {
  setStatus('Loading project from Google Drive…');
  const file = await findCloudProjectFile();
  if (!file) {
    toast('No cloud project found');
    setStatus('No cloud project found');
    return;
  }
  const r = await driveRequest(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
  const project = await r.json();
  await restoreProject(project);
  toast('Cloud project loaded');
}
function scheduleCloudAutosave() {
  projectDirty=true;
  uvPreviewDirty=true;
  uvPreviewCache.clear();
  clearTimeout(cloudSaveTimer);
  if (!googleAccessToken || !ui.cloudAutosave.checked) return;
  cloudSaveTimer=setTimeout(async()=>{
    if(!projectDirty || cloudSaving) return;
    try {
      await saveCloudProject({silent:true});
    } catch(err) {
      console.error(err);
      setStatus(`Cloud autosave failed: ${err.message}`);
    }
  },10000);
}

const preview3d = {
  ready:false,
  scene:null, camera:null, renderer:null, controls:null, mesh:null, geometry:null,
  materials:[], textureCanvases:[], animation:0, defaultCamera:null,
  triangleCount:0, textureDirty:true, textureWorker:null
};

function setStatus(text) { ui.status.textContent = text; }
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ui.toast.classList.add('hidden'), 2600);
}
function sanitizeName(s) {
  return s.trim().replace(/[^a-zA-Z0-9 _-]+/g,'').replace(/[ _-]+/g,'_').replace(/^_+|_+$/g,'');
}
function hexToRgba(hex, alpha=255) {
  const n = parseInt(hex.slice(1),16);
  return [(n>>16)&255,(n>>8)&255,n&255,alpha];
}
function pointFromEvent(ev) {
  const r = ui.canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(W-1, (ev.clientX-r.left) * W / r.width)),
    y: Math.max(0, Math.min(H-1, (ev.clientY-r.top) * H / r.height))
  };
}
function makeCanvas() {
  const c = document.createElement('canvas'); c.width=W; c.height=H; return c;
}

async function loadImage(url) {
  const res = await fetch(url, { cache:'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  const blob = await res.blob();
  return await createImageBitmap(blob);
}
function makeProcessedMask(bitmap) {
  const src = makeCanvas(), sctx = src.getContext('2d', {willReadFrequently:true});
  sctx.drawImage(bitmap,0,0,W,H);
  const im = sctx.getImageData(0,0,W,H);
  for (let i=0;i<im.data.length;i+=4) {
    const r=im.data[i], g=im.data[i+1], b=im.data[i+2], a=im.data[i+3];
    let m = a < 250 ? a : Math.max(r,g,b);
    im.data[i]=255; im.data[i+1]=255; im.data[i+2]=255; im.data[i+3]=m;
  }
  sctx.clearRect(0,0,W,H); sctx.putImageData(im,0,0);
  return src;
}
function applyMask(surface) {
  const c = surface.paint, pctx = c.getContext('2d');
  pctx.save();
  pctx.globalCompositeOperation='destination-in';
  pctx.drawImage(surface.maskCanvas,0,0);
  pctx.restore();
}
function baseSurface(surface) {
  const c = makeCanvas(), cctx = c.getContext('2d');
  cctx.fillStyle='#f8fafc'; cctx.fillRect(0,0,W,H);
  cctx.globalCompositeOperation='destination-in';
  cctx.drawImage(surface.maskCanvas,0,0);
  cctx.globalCompositeOperation='source-over';
  return c;
}

async function init() {
  if (location.protocol === 'file:') {
    setStatus('Run this site through GitHub Pages or an HTTP server.');
    ui.dot.classList.add('bad');
    ui.profileStatus.textContent='HTTP required';
    return;
  }
  try {
    const res = await fetch(PROFILE_URL, {cache:'no-cache'});
    if (!res.ok) throw new Error(`Profile HTTP ${res.status}`);
    profile = await res.json();
    surfaces = await Promise.all(profile.surfaces.map(async (spec, idx) => {
      const [maskBmp, guideBmp] = await Promise.all([
        loadImage(new URL(spec.mask, PROFILE_BASE)),
        loadImage(new URL(spec.guide, PROFILE_BASE))
      ]);
      const maskCanvas = makeProcessedMask(maskBmp);
      const paint = makeCanvas();
      const surf = { spec, idx, maskCanvas, guideBmp, paint, base:null, objects:[], dirty:true };
      surf.base = baseSurface(surf);
      return surf;
    }));
    buildSurfaceList();
    selectSurface(0);
    ui.dot.classList.add('ok');
    ui.profileStatus.textContent=`${profile.display_name} · ${surfaces.length} surfaces`;
setStatus('Ready');
    registerServiceWorker();
  } catch (err) {
    console.error(err);
    ui.dot.classList.add('bad');
    ui.profileStatus.textContent='Profile failed';
    setStatus(`Could not load A380X profile: ${err.message}`);
  }
}

function buildSurfaceList() {
  ui.list.replaceChildren();
  const groups = new Map();
  profile.surfaces.forEach((s,i) => {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group).push([s,i]);
  });
  for (const [group, list] of groups) {
    const wrap=document.createElement('div'); wrap.className='surface-group';
    const t=document.createElement('div'); t.className='surface-group-title'; t.textContent=group; wrap.appendChild(t);
    for (const [s,i] of list) {
      const b=document.createElement('button'); b.className='surface-btn'; b.textContent=s.display_name; b.dataset.index=i;
      b.addEventListener('click',()=>selectSurface(i));
      wrap.appendChild(b);
    }
    ui.list.appendChild(wrap);
  }
}
function selectSurface(i) {
  current=i; selectedObject=-1; updateObjectControls();
  document.querySelectorAll('.surface-btn').forEach(b=>b.classList.toggle('active', Number(b.dataset.index)===i));
  ui.title.textContent=surfaces[i].spec.display_name;
  ui.hint.textContent='Paint the recognizable orthographic aircraft view. UV texture placement stays hidden and automatic.';
  render2D();
}
function render2D() {
  if (!surfaces[current]) return;
  const s=surfaces[current];
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,H);
  ctx.drawImage(s.base,0,0);
  ctx.drawImage(s.paint,0,0);
  drawObjects(ctx,s,false);
  if (ui.guideToggle.checked) {
    ctx.save(); ctx.globalAlpha=1; ctx.drawImage(s.guideBmp,0,0,W,H); ctx.restore();
  }
  if (selectedObject>=0 && s.objects[selectedObject]) drawSelection(ctx,s.objects[selectedObject]);
}
function drawObjects(target, surface, flatten=false) {
  for (let i=0;i<surface.objects.length;i++) {
    const o=surface.objects[i];
    target.save();
    if (o.type==='image') {
      target.drawImage(o.image,o.x,o.y,o.w,o.h);
    } else if (o.type==='text') {
      target.fillStyle=o.color; target.textBaseline='top';
      target.font=`${o.size}px ${o.font}`;
      target.fillText(o.text,o.x,o.y);
    }
    target.restore();
  }
  if (flatten) {
    target.save();
    target.globalCompositeOperation='destination-in';
    target.drawImage(surface.maskCanvas,0,0);
    target.restore();
  }
}
function objectBounds(o, targetCtx=ctx) {
  if (o.type==='image') return {x:o.x,y:o.y,w:o.w,h:o.h};
  targetCtx.save(); targetCtx.font=`${o.size}px ${o.font}`;
  const m=targetCtx.measureText(o.text); targetCtx.restore();
  return {x:o.x,y:o.y,w:Math.max(1,m.width),h:o.size*1.22};
}
function drawSelection(c,o) {
  const b=objectBounds(o,c);
  c.save(); c.strokeStyle='#2563eb'; c.lineWidth=3; c.setLineDash([9,6]); c.strokeRect(b.x-4,b.y-4,b.w+8,b.h+8); c.restore();
}
function hitObject(surface,p) {
  for (let i=surface.objects.length-1;i>=0;i--) {
    const b=objectBounds(surface.objects[i]);
    if (p.x>=b.x && p.x<=b.x+b.w && p.y>=b.y && p.y<=b.y+b.h) return i;
  }
  return -1;
}
function flattenSurface(index) {
  const s=surfaces[index], c=makeCanvas(), cctx=c.getContext('2d');
  cctx.clearRect(0,0,W,H);
  cctx.drawImage(s.paint,0,0);
  drawObjects(cctx,s,true);
  return c;
}
function pushHistory(index) {
  const pctx=surfaces[index].paint.getContext('2d',{willReadFrequently:true});
  history.push({ index, image:pctx.getImageData(0,0,W,H), objects:surfaces[index].objects.map(o=>({...o})) });
  if (history.length>10) history.shift();
}
function undo() {
  const h=history.pop();
  if (!h) return toast('Nothing to undo');
  const s=surfaces[h.index];
  s.paint.getContext('2d').putImageData(h.image,0,0);
  s.objects=h.objects;
  markSurfaceDirty(h.index);
  selectSurface(h.index);
  setStatus('Undo');
}
function pairIndex(index) {
  const p=profile.surfaces[index].pair;
  return Number.isInteger(p) ? p : -1;
}
function mirroredPoint(p) { return {x:W-1-p.x,y:p.y}; }

function stroke(index,a,b,erase=false,mirror=false) {
  const s=surfaces[index], pctx=s.paint.getContext('2d');
  pctx.save();
  pctx.globalCompositeOperation=erase?'destination-out':'source-over';
  pctx.strokeStyle=ui.paintColor.value;
  pctx.lineWidth=Number(ui.brushSize.value);
  pctx.lineCap='round'; pctx.lineJoin='round';
  pctx.beginPath(); pctx.moveTo(a.x,a.y); pctx.lineTo(b.x,b.y); pctx.stroke(); pctx.restore();
  applyMask(s); markSurfaceDirty(index);
  if (mirror && pairIndex(index)>=0) {
    const pi=pairIndex(index), pa=mirroredPoint(a), pb=mirroredPoint(b);
    const ps=surfaces[pi], pc=ps.paint.getContext('2d');
    pc.save(); pc.globalCompositeOperation=erase?'destination-out':'source-over';
    pc.strokeStyle=ui.paintColor.value; pc.lineWidth=Number(ui.brushSize.value); pc.lineCap='round'; pc.lineJoin='round';
    pc.beginPath(); pc.moveTo(pa.x,pa.y); pc.lineTo(pb.x,pb.y); pc.stroke(); pc.restore();
    applyMask(ps); markSurfaceDirty(pi);
  }
}
function fillSurface(index, mirror=false) {
  pushHistory(index);
  const s=surfaces[index], p=s.paint.getContext('2d');
  p.save(); p.globalCompositeOperation='source-over'; p.fillStyle=ui.paintColor.value; p.fillRect(0,0,W,H); p.restore(); applyMask(s); markSurfaceDirty(index);
  if (mirror && pairIndex(index)>=0) {
    const pi=pairIndex(index); pushHistory(pi);
    const ps=surfaces[pi], pc=ps.paint.getContext('2d');
    pc.fillStyle=ui.paintColor.value; pc.fillRect(0,0,W,H); applyMask(ps); markSurfaceDirty(pi);
  }
  render2D(); setStatus('Surface filled');
}

ui.canvas.addEventListener('pointerdown', ev => {
  if (!surfaces[current]) return;
  const p=pointFromEvent(ev); ui.canvas.setPointerCapture(ev.pointerId);
  if (tool==='fill') return fillSurface(current,ui.mirror.checked);
  if (tool==='move') {
    const hit=hitObject(surfaces[current],p); selectedObject=hit; updateObjectControls();
    if (hit>=0) {
      pushHistory(current);
      const b=objectBounds(surfaces[current].objects[hit]);
      dragObjectOffset={x:p.x-b.x,y:p.y-b.y};
    }
    render2D(); return;
  }
  pushHistory(current);
  painting=true; lastPoint=p;
  stroke(current,p,p,tool==='eraser',ui.mirror.checked); render2D();
});
ui.canvas.addEventListener('pointermove', ev => {
  const p=pointFromEvent(ev); ui.coords.textContent=`${Math.round(p.x)}, ${Math.round(p.y)}`;
  if (tool==='move' && dragObjectOffset && selectedObject>=0) {
    const o=surfaces[current].objects[selectedObject];
    o.x=p.x-dragObjectOffset.x; o.y=p.y-dragObjectOffset.y;
    markSurfaceDirty(current); render2D(); return;
  }
  if (!painting || !lastPoint) return;
  stroke(current,lastPoint,p,tool==='eraser',ui.mirror.checked); lastPoint=p; render2D();
});
function endPointer() { painting=false; lastPoint=null; dragObjectOffset=null; schedulePreviewUpdate(); }
ui.canvas.addEventListener('pointerup',endPointer);
ui.canvas.addEventListener('pointercancel',endPointer);
ui.canvas.addEventListener('pointerleave',()=>{ui.coords.textContent=''; if(painting) endPointer();});

document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click',()=>{
  tool=b.dataset.tool;
  document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x===b));
  setStatus(`Tool: ${b.textContent}`);
}));
ui.brushSize.addEventListener('input',()=>ui.brushSizeLabel.textContent=ui.brushSize.value);
ui.guideToggle.addEventListener('change',render2D);
$('btnUndo').addEventListener('click',undo);

$('btnLogo').addEventListener('click',()=>$('logoFile').click());
$('logoFile').addEventListener('change',async ev=>{
  const file=ev.target.files?.[0]; ev.target.value=''; if(!file) return;
  const source=await fileToDataURL(file);
  const bmp=await createImageBitmap(file);
  pushHistory(current);
  const maxW=420,maxH=250, scale=Math.min(1,maxW/bmp.width,maxH/bmp.height);
  const w=bmp.width*scale,h=bmp.height*scale;
  surfaces[current].objects.push({type:'image',image:bmp,source,x:(W-w)/2,y:(H-h)/2,w,h});
  selectedObject=surfaces[current].objects.length-1; tool='move';
  document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x.dataset.tool==='move'));
  markSurfaceDirty(current); updateObjectControls(); render2D(); setStatus('Logo added');
});
$('btnAddText').addEventListener('click',()=>{
  const text=ui.textInput.value.trim(); if(!text) return toast('Enter text first');
  pushHistory(current);
  const size=Math.max(12,Math.min(320,Number(ui.textSize.value)||72));
  const o={type:'text',text,size,color:ui.textColor.value,font:ui.fontSelect.value,x:W*.36,y:H*.43};
  surfaces[current].objects.push(o); selectedObject=surfaces[current].objects.length-1; tool='move';
  document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x.dataset.tool==='move'));
  markSurfaceDirty(current); updateObjectControls(); render2D(); setStatus('Text added');
});
function scaleSelected(factor) {
  if(selectedObject<0) return;
  const s=surfaces[current], o=s.objects[selectedObject]; pushHistory(current);
  if(o.type==='image'){ const cx=o.x+o.w/2,cy=o.y+o.h/2; o.w=Math.max(12,o.w*factor);o.h=Math.max(12,o.h*factor);o.x=cx-o.w/2;o.y=cy-o.h/2; }
  else o.size=Math.max(12,Math.min(360,o.size*factor));
  markSurfaceDirty(current); render2D();
}
$('btnLogoSmaller').addEventListener('click',()=>scaleSelected(.86));
$('btnLogoLarger').addEventListener('click',()=>scaleSelected(1.16));
$('btnObjectSmaller').addEventListener('click',()=>scaleSelected(.86));
$('btnObjectLarger').addEventListener('click',()=>scaleSelected(1.16));
$('btnDeleteObject').addEventListener('click',()=>{
  if(selectedObject<0)return; pushHistory(current); surfaces[current].objects.splice(selectedObject,1); selectedObject=-1;
  markSurfaceDirty(current); updateObjectControls(); render2D();
});
function updateObjectControls(){
  const yes=selectedObject>=0;
  ui.objectEmpty.classList.toggle('hidden',yes); ui.objectControls.classList.toggle('hidden',!yes);
}

function markSurfaceDirty(index) {
  surfaces[index].dirty=true; previewDirtyRegions.add(index);
  scheduleCloudAutosave();
  if (!ui.preview.classList.contains('hidden')) schedulePreviewUpdate();
}
function schedulePreviewUpdate() {
  preview3d.textureDirty=true;
  clearTimeout(previewUpdateTimer);
  if (!ui.preview.classList.contains('hidden') && preview3d.ready) {
    previewUpdateTimer=setTimeout(()=>updatePreviewTextures(false),650);
  }
}

ui.btn2d.addEventListener('click',()=>switchView('2d'));
ui.btn3d.addEventListener('click',()=>switchView('3d'));
ui.btnUV.addEventListener('click',()=>switchView('uv'));
$('btnReset3d').addEventListener('click',()=>reset3D());

async function switchView(mode) {
  const three=mode==='3d', uv=mode==='uv';
  ui.btn2d.classList.toggle('active',mode==='2d');
  ui.btn3d.classList.toggle('active',three);
  ui.btnUV.classList.toggle('active',uv);
  ui.designer.classList.toggle('hidden',mode!=='2d');
  ui.preview.classList.toggle('hidden',!three);
  ui.uvView.classList.toggle('hidden',!uv);
  if (three) {
    ui.title.textContent='3D Preview';
    ui.hint.textContent='Live GPU preview of the current aircraft surface design.';
    try { await show3DPreview(); }
    catch(err){ console.error(err); setStatus(`3D preview failed: ${err.message}`); }
  } else if (uv) {
    ui.title.textContent='Generated UV Preview';
    ui.hint.textContent='This is the UV texture generated automatically from the aircraft surface editor.';
    await renderUVPreview(false);
  } else {
    selectSurface(current);
  }
}

function setPreviewLoading(show, detail='Preparing high-detail A380X mesh') {
  if (!ui.previewBusy) return;
  ui.previewBusy.classList.toggle('hidden', !show);
  if (ui.previewLoadingDetail) ui.previewLoadingDetail.textContent=detail;
}
async function nextFrame() {
  await new Promise(requestAnimationFrame);
}
async function fetchArrayBufferWithProgress(url, onProgress) {
  const r=await fetch(url,{cache:'force-cache'});
  if(!r.ok) throw new Error(`3D mesh HTTP ${r.status}`);
  const total=Number(r.headers.get('content-length')||0);
  if(!r.body || !r.body.getReader) return await r.arrayBuffer();
  const reader=r.body.getReader(), chunks=[];
  let received=0;
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    chunks.push(value); received+=value.byteLength;
    onProgress?.(received,total);
  }
  const out=new Uint8Array(received);
  let offset=0;
  for(const c of chunks){out.set(c,offset);offset+=c.byteLength;}
  return out.buffer;
}
async function decodeHDMesh(buf) {
  return await new Promise((resolve,reject)=>{
    const worker=new Worker('./mesh-worker.js');
    worker.onmessage=ev=>{
      worker.terminate();
      if(ev.data?.error) reject(new Error(ev.data.error));
      else resolve(ev.data);
    };
    worker.onerror=e=>{worker.terminate();reject(new Error(e.message||'3D mesh worker failed'));};
    worker.postMessage(buf,[buf]);
  });
}
async function show3DPreview() {
  setPreviewLoading(true, preview3d.ready ? 'Updating livery textures' : 'Preparing high-detail A380X mesh');
  await nextFrame();
  try {
    if(!preview3d.ready) await init3D();
    resize3D();
    if(preview3d.textureDirty) await updatePreviewTextures(true);
  } finally {
    setPreviewLoading(false);
  }
}
async function init3D() {
  setStatus('Loading high-detail 3D preview…');
  setPreviewLoading(true,'Downloading high-detail A380X mesh');
  await nextFrame();

  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0xf4f7fa);
  const camera=new THREE.PerspectiveCamera(36,1,.05,10000);
  const renderer=new THREE.WebGLRenderer({
    antialias:true,
    powerPreference:'high-performance',
    precision:'highp'
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.05;
  ui.threeHost.replaceChildren(renderer.domElement);

  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=.065;
  controls.screenSpacePanning=true;

  scene.add(new THREE.HemisphereLight(0xffffff,0x718096,2.25));
  const key=new THREE.DirectionalLight(0xffffff,2.6); key.position.set(4,7,5); scene.add(key);
  const fill=new THREE.DirectionalLight(0xc6dcff,1.15); fill.position.set(-5,2,-4); scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffffff,.65); rim.position.set(0,-3,5); scene.add(rim);

  const meshURL=new URL(profile.preview_mesh,PROFILE_BASE);
  const buf=await fetchArrayBufferWithProgress(meshURL,(done,total)=>{
    if(total>0){
      const pct=Math.min(100,done*100/total);
      ui.previewLoadingDetail.textContent=
        `Downloading high-detail mesh · ${(done/1048576).toFixed(1)} / ${(total/1048576).toFixed(1)} MB · ${pct.toFixed(0)}%`;
    }else{
      ui.previewLoadingDetail.textContent=`Downloading high-detail mesh · ${(done/1048576).toFixed(1)} MB`;
    }
  });

  ui.previewLoadingDetail.textContent='Decoding 1M+ triangles in background…';
  const decoded=await decodeHDMesh(buf);
  await nextFrame();

  ui.previewLoadingDetail.textContent='Building GPU geometry…';
  const positions=new Float32Array(decoded.positions);
  const normals=new Float32Array(decoded.normals);
  const uvs=new Float32Array(decoded.uvs);
  const indices=new Uint32Array(decoded.indices);

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
  geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
  geometry.setIndex(new THREE.BufferAttribute(indices,1));
  for(let i=0;i<decoded.groups.length;i++){
    const g=decoded.groups[i];
    if(g.count>0) geometry.addGroup(g.start,g.count,i);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const center=new THREE.Vector3();
  geometry.boundingBox.getCenter(center);
  geometry.translate(-center.x,-center.y,-center.z);
  geometry.computeBoundingSphere();

  const maxAnisotropy=renderer.capabilities.getMaxAnisotropy();
  const materials=profile.texture_outputs.map((t,i)=>{
    const mapped=t.mapped_in_surface_editor!==false;
    const m=new THREE.MeshStandardMaterial({
      color:mapped?0xffffff:0xd6dee7,
      roughness:.72,
      metalness:.02,
      side:THREE.FrontSide
    });
    m.userData={materialIndex:i,mapped,maxAnisotropy};
    return m;
  });

  const mesh=new THREE.Mesh(geometry,materials);
  scene.add(mesh);

  const radius=geometry.boundingSphere.radius||100;
  camera.near=Math.max(.02,radius/2000);
  camera.far=radius*40;
  camera.updateProjectionMatrix();
  // three-quarter top view; aircraft longitudinal axis is Z in the Paintkit.
  camera.position.set(radius*1.28,radius*.72,radius*1.55);
  controls.target.set(0,0,0);
  controls.minDistance=radius*.28;
  controls.maxDistance=radius*5.5;
  controls.update();

  preview3d.defaultCamera={pos:camera.position.clone(),target:controls.target.clone()};
  preview3d.scene=scene; preview3d.camera=camera; preview3d.renderer=renderer; preview3d.controls=controls;
  preview3d.mesh=mesh; preview3d.geometry=geometry; preview3d.materials=materials;
  preview3d.triangleCount=decoded.indexCount/3;
  preview3d.ready=true;
  preview3d.textureDirty=true;

  const animate=()=>{
    preview3d.animation=requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene,camera);
  };
  animate();
  resize3D();
  setStatus(
    `High-detail 3D ready · ${Math.round(preview3d.triangleCount).toLocaleString()} triangles · `+
    `${decoded.vertexCount.toLocaleString()} vertices`
  );
}
function reset3D(){
  if(!preview3d.ready||!preview3d.defaultCamera)return;
  preview3d.camera.position.copy(preview3d.defaultCamera.pos);
  preview3d.controls.target.copy(preview3d.defaultCamera.target);
  preview3d.controls.update();
}
function resize3D(){
  if(!preview3d.ready)return;
  const r=ui.threeHost.getBoundingClientRect();
  if(!r.width||!r.height)return;
  preview3d.camera.aspect=r.width/r.height;
  preview3d.camera.updateProjectionMatrix();
  preview3d.renderer.setSize(r.width,r.height,false);
}
window.addEventListener('resize',resize3D);
new ResizeObserver(resize3D).observe(ui.threeHost);

async function updatePreviewTextures(force=false) {
  if(!preview3d.ready)return;
  if(!force && !preview3d.textureDirty)return;

  setPreviewLoading(true,'Baking livery textures for the high-detail model…');
  await nextFrame();
  const surfaceBuffers=await collectSurfaceBuffers();
  if(preview3d.textureWorker) preview3d.textureWorker.terminate();

  const worker=new Worker('./bake-worker.js');
  preview3d.textureWorker=worker;

  try{
    const textures=await new Promise((resolve,reject)=>{
      worker.onmessage=ev=>{
        const m=ev.data;
        if(m.type==='progress'){
          ui.previewLoadingDetail.textContent=m.text;
        }else if(m.type==='preview-all-done'){
          resolve(m.textures||[]);
        }else if(m.type==='error'){
          reject(new Error(m.message));
        }
      };
      worker.onerror=e=>reject(new Error(e.message||'3D texture worker failed'));
      worker.postMessage(
        {type:'preview-all',profile,profileBase:PROFILE_BASE,surfaceBuffers},
        surfaceBuffers
      );
    });

    ui.previewLoadingDetail.textContent='Uploading livery textures to GPU…';
    for(const item of textures){
      const mat=preview3d.materials[item.index];
      if(!mat)continue;
      const blob=new Blob([item.buffer],{type:'image/png'});
      const bmp=await createImageBitmap(blob);
      const canvas=document.createElement('canvas');
      canvas.width=W; canvas.height=H;
      const c=canvas.getContext('2d');
      c.drawImage(bmp,0,0,W,H);
      bmp.close?.();

      if(mat.map) mat.map.dispose();
      const tex=new THREE.CanvasTexture(canvas);
      tex.colorSpace=THREE.SRGBColorSpace;
      tex.flipY=true;
      tex.anisotropy=Math.min(16,mat.userData.maxAnisotropy||1);
      tex.needsUpdate=true;
      mat.map=tex;
      mat.color.set(0xffffff);
      mat.needsUpdate=true;
    }
    preview3d.textureDirty=false;
    previewDirtyRegions.clear();
    setStatus(
      `High-detail 3D ready · ${Math.round(preview3d.triangleCount).toLocaleString()} triangles`
    );
  } finally {
    worker.terminate();
    if(preview3d.textureWorker===worker) preview3d.textureWorker=null;
    setPreviewLoading(false);
  }
}


document.querySelectorAll('#pkgTitle,#pkgVariation,#pkgRegistration,#pkgManufacturer,#pkgModel,#pkgCreator,#pkgBase,#pkgDescription')
  .forEach(el=>el.addEventListener('input', scheduleCloudAutosave));
async function collectSurfaceBuffers() {
  const surfaceBuffers=[];
  for(let i=0;i<surfaces.length;i++){
    const c=flattenSurface(i);
    const blob=await new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('PNG encode failed')),'image/png'));
    surfaceBuffers.push(await blob.arrayBuffer());
    await new Promise(requestAnimationFrame);
  }
  return surfaceBuffers;
}
function populateUVTextureSelect() {
  if (!profile || ui.uvTextureSelect.options.length) return;
  profile.texture_outputs.forEach((t,i)=>{
    const o=document.createElement('option');
    o.value=String(i);
    o.textContent=`${i+1}. ${t.file}${t.mapped_in_surface_editor===false ? ' · not mapped yet' : ''}`;
    if(t.mapped_in_surface_editor===false) o.disabled=true;
    ui.uvTextureSelect.appendChild(o);
  });
}
async function renderUVPreview(force=false) {
  if(!profile)return;
  populateUVTextureSelect();
  const index=Math.max(0,Math.min(profile.texture_outputs.length-1,Number(ui.uvTextureSelect.value)||0));
  if(!force && !uvPreviewDirty && uvPreviewCache.has(index)){
    drawUVBlob(uvPreviewCache.get(index)); return;
  }
  ui.uvBusy.classList.remove('hidden');
  setStatus(`Baking UV preview: ${profile.texture_outputs[index].file}`);
  try{
    const surfaceBuffers=await collectSurfaceBuffers();
    if(uvWorker)uvWorker.terminate();
    uvWorker=new Worker('./bake-worker.js');
    await new Promise((resolve,reject)=>{
      uvWorker.onmessage=ev=>{
        const m=ev.data;
        if(m.type==='preview-done'){
          const blob=new Blob([m.buffer],{type:'image/png'});
          uvPreviewCache.set(index,blob);
          uvPreviewDirty=false;
          drawUVBlob(blob); resolve();
        }else if(m.type==='error')reject(new Error(m.message));
      };
      uvWorker.onerror=e=>reject(new Error(e.message||'UV worker failed'));
      uvWorker.postMessage({type:'preview',profile,profileBase:PROFILE_BASE,surfaceBuffers,index},surfaceBuffers);
    });
    setStatus(`UV preview ready · ${profile.texture_outputs[index].file}`);
  }catch(err){
    console.error(err); setStatus(`UV preview failed: ${err.message}`); toast('UV preview failed');
  }finally{
    ui.uvBusy.classList.add('hidden');
    uvWorker?.terminate(); uvWorker=null;
  }
}
async function drawUVBlob(blob){
  const bmp=await createImageBitmap(blob);
  const c=ui.uvCanvas.getContext('2d');
  c.clearRect(0,0,W,H); c.drawImage(bmp,0,0,W,H); bmp.close?.();
}
ui.uvTextureSelect.addEventListener('change',()=>renderUVPreview(false));
$('btnRefreshUV').addEventListener('click',()=>renderUVPreview(true));

ui.btnGoogle.addEventListener('click', connectGoogle);
ui.btnGoogleTop.addEventListener('click', connectGoogle);
ui.btnCloudSave.addEventListener('click', async()=>{
  try {
    await saveCloudProject();
  } catch(err) {
    console.error(err);
    setStatus(`Cloud save failed: ${err.message}`);
    toast('Cloud save failed');
  }
});
ui.btnCloudLoad.addEventListener('click', async()=>{
  try {
    await loadCloudProject();
  } catch(err) {
    console.error(err);
    setStatus(`Cloud load failed: ${err.message}`);
    toast('Cloud load failed');
  }
});
$('btnGoogleSetupCancel').addEventListener('click', closeGoogleSetup);
$('btnGoogleSetupSave').addEventListener('click', async()=>{
  const id=ui.googleClientIdInput.value.trim();
  if(!id.endsWith('.apps.googleusercontent.com')) return toast('Enter a valid Google OAuth Client ID');
  localStorage.setItem('mls-google-client-id',id);
  googleTokenClient=null;
  closeGoogleSetup();
  await connectGoogle();
});

$('btnExport').addEventListener('click',exportLivery);
$('btnCancelExport').addEventListener('click',()=>{
  if(exportWorker){ exportWorker.terminate(); exportWorker=null; }
  ui.exportModal.classList.add('hidden'); setStatus('Export cancelled');
});

async function exportLivery() {
  if(!profile)return;
  const fields={
    title:$('pkgTitle').value.trim(), variation:$('pkgVariation').value.trim(), registration:$('pkgRegistration').value.trim(),
    manufacturer:$('pkgManufacturer').value.trim(), model:$('pkgModel').value.trim(), creator:$('pkgCreator').value.trim(),
    base:$('pkgBase').value.trim(), description:$('pkgDescription').value.trim()
  };
  if(!fields.title || !fields.variation){ toast('Enter Package title and Display name in Export Details'); document.querySelector('.package-card').open=true; return; }
  ui.exportModal.classList.remove('hidden'); ui.progressBar.style.width='4%'; ui.progressText.textContent='Flattening aircraft surfaces…';
  try {
    const surfaceBuffers=await collectSurfaceBuffers();
    ui.progressBar.style.width='23%';
    exportWorker=new Worker('./bake-worker.js');
    exportWorker.onmessage=ev=>{
      const m=ev.data;
      if(m.type==='progress'){ ui.progressBar.style.width=`${m.percent}%`; ui.progressText.textContent=m.text; }
      else if(m.type==='done'){
        const blob=new Blob([m.buffer],{type:'application/zip'}); const a=document.createElement('a');
        a.href=URL.createObjectURL(blob); a.download=m.filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(a.href),3000);
        ui.exportModal.classList.add('hidden'); setStatus('Livery ZIP created'); toast('Livery ZIP created');
        exportWorker.terminate(); exportWorker=null;
      } else if(m.type==='error'){
        throw new Error(m.message);
      }
    };
    exportWorker.onerror=err=>{
      console.error(err); ui.exportModal.classList.add('hidden'); setStatus('Export failed'); toast(`Export failed: ${err.message}`);
      exportWorker?.terminate(); exportWorker=null;
    };
    exportWorker.postMessage({type:'export',profile,profileBase:PROFILE_BASE,surfaceBuffers,fields,version:VERSION},surfaceBuffers);
  } catch(err) {
    console.error(err); ui.exportModal.classList.add('hidden'); setStatus(`Export failed: ${err.message}`); toast('Export failed');
  }
}

async function registerServiceWorker(){
  if('serviceWorker' in navigator && location.protocol==='https:'){
    try { await navigator.serviceWorker.register('./sw.js'); } catch(e){ console.warn('SW',e); }
  }
}
init();
