/* MSFS Livery Studio Web v0.6.0 - background UV baker */
importScripts('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');

const W=1024,H=1024;
const enc=new TextEncoder();
function progress(percent,text){ postMessage({type:'progress',percent,text}); }
function safe(s){return String(s||'').replace(/"/g,"'");}
function slug(s){return String(s||'').trim().replace(/[^a-zA-Z0-9 _-]+/g,'').replace(/[ _-]+/g,'_').replace(/^_+|_+$/g,'');}
function filetime(){return Date.now()*10000+116444736000000000;}
async function bitmapToData(blob){
  const bmp=await createImageBitmap(blob);
  const c=new OffscreenCanvas(W,H),x=c.getContext('2d',{willReadFrequently:true});
  x.drawImage(bmp,0,0,W,H); bmp.close?.();
  return x.getImageData(0,0,W,H).data;
}
async function fetchMap(url){
  const r=await fetch(url); if(!r.ok) throw new Error(`Bake map ${r.status}: ${url}`);
  return await bitmapToData(await r.blob());
}
async function encodePNG(rgba){
  const c=new OffscreenCanvas(W,H),x=c.getContext('2d');
  x.putImageData(new ImageData(rgba,W,H),0,0);
  const b=await c.convertToBlob({type:'image/png'}); return new Uint8Array(await b.arrayBuffer());
}
function aircraftCFG(id,f){
  let s='[VERSION]\r\nmajor=1\r\nminor=0\r\n\r\n';
  if(f.base)s+=`[VARIATION]\r\nbase_container=..\\${safe(f.base)}\r\n\r\n`;
  s+='[FLTSIM.0]\r\n';
  s+=`title="${safe(f.title)}"\r\nmodel=\r\npanel=${id}\r\nsound=\r\ntexture=${id}\r\n`;
  s+=`ui_variation="${safe(f.variation)}"\r\n`;
  if(f.manufacturer)s+=`ui_manufacturer="${safe(f.manufacturer)}"\r\n`;
  if(f.model)s+=`ui_type="${safe(f.model)}"\r\n`;
  if(f.creator)s+=`ui_createdby="${safe(f.creator)}"\r\n`;
  if(f.registration)s+=`atc_id="${safe(f.registration)}"\r\n`;
  s+='isAirTraffic=0\r\nisUserSelectable=1\r\n';
  return s;
}
onmessage=async ev=>{
  if(ev.data?.type!=='export')return;
  try{
    const {profile,profileBase,surfaceBuffers,fields,version}=ev.data;
    progress(25,'Decoding aircraft surfaces…');
    const surfaceData=[];
    for(let i=0;i<surfaceBuffers.length;i++){
      surfaceData.push(await bitmapToData(new Blob([surfaceBuffers[i]],{type:'image/png'})));
      progress(25+Math.round((i+1)/surfaceBuffers.length*10),'Decoding aircraft surfaces…');
    }
    const textures=[];
    for(let ti=0;ti<profile.texture_outputs.length;ti++){
      const out=profile.texture_outputs[ti];
      progress(36+Math.round(ti/profile.texture_outputs.length*40),`Baking ${out.material}…`);
      const map=await fetchMap(new URL(out.bake_map,profileBase));
      const dst=new Uint8ClampedArray(W*H*4);
      for(let p=0,px=0;p<map.length;p+=4,px++){
        const packed=(map[p]<<16)|(map[p+1]<<8)|map[p+2];
        if(!packed)continue;
        const region=((packed>>>20)&0x0f)-1;
        const sy=(packed>>>10)&0x3ff, sx=packed&0x3ff;
        if(region<0||region>=surfaceData.length)continue;
        const si=(sy*W+sx)*4, di=px*4, src=surfaceData[region];
        let a=src[si+3],r=src[si],g=src[si+1],b=src[si+2];
        if(a===0){r=248;g=250;b=252;a=255;}
        dst[di]=r;dst[di+1]=g;dst[di+2]=b;dst[di+3]=255;
      }
      textures.push({file:out.file,data:await encodePNG(dst)});
    }
    progress(78,'Building MSFS package…');
    const zip=new JSZip(), id=slug(fields.variation)||slug(fields.title)||'Livery';
    const root=id, sim=`${root}/SimObjects/Airplanes/FBW_A380X_${id}`, tex=`${sim}/texture.${id}`, panel=`${sim}/panel.${id}`;
    const entries=[];
    const add=(path,data)=>{
      zip.file(path,data);
      const size=typeof data==='string'?enc.encode(data).byteLength:data.byteLength;
      entries.push({path:path.slice(root.length+1),size,date:filetime()});
    };
    for(const t of textures)add(`${tex}/${t.file}`,t.data);
    let textureCfg='[fltsim]\r\n'; if(fields.base)textureCfg+=`fallback.1=..\\..\\${safe(fields.base)}\\texture\r\n`;
    add(`${tex}/texture.cfg`,textureCfg);
    add(`${panel}/panel.cfg`,'[VARIATION]\r\noverride_base_container=1\r\n');
    add(`${sim}/aircraft.cfg`,aircraftCFG(id,fields));
    if(fields.description)add(`${root}/README.txt`,fields.description+'\r\n');
    const manifest={
      dependencies:[],content_type:'AIRCRAFT',title:fields.title,manufacturer:fields.manufacturer||'',
      creator:fields.creator||'',package_version:version,minimum_game_version:'1.30.12',
      release_notes:{neutral:{LastUpdate:'',OlderHistory:''}}
    };
    add(`${root}/manifest.json`,JSON.stringify(manifest,null,2));
    entries.sort((a,b)=>a.path.localeCompare(b.path));
    zip.file(`${root}/layout.json`,JSON.stringify({content:entries},null,2));
    progress(88,'Compressing ZIP…');
    const blob=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:5}},
      m=>progress(88+Math.round(m.percent*.11),`Compressing ZIP… ${Math.round(m.percent)}%`));
    progress(100,'Done');
    postMessage({type:'done',buffer:blob.buffer,filename:`${id}_A380X_Livery_v${version}.zip`},[blob.buffer]);
  }catch(err){
    console.error(err);postMessage({type:'error',message:err?.message||String(err)});
  }
};
