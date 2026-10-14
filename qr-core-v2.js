(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LabelQR = api;
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';

  function parsePayload(payload) {
    if (typeof payload !== 'string') return null;
    const plain = payload.trim().toUpperCase();
    if (/^(?:TAA|TBA|THA)\d{6,10}$/.test(plain)) return {code:plain, method:'qr', inferred:false};
    try {
      const url = new URL(payload);
      if (url.protocol !== 'https:' || url.hostname !== 'sqasiapps.sirim.my' || url.pathname !== '/index'
        || url.searchParams.get('v') !== '1.1' || url.searchParams.get('c') !== 'I1NR' || url.searchParams.get('o') !== 'A') return null;
      const token = url.search.slice(1).split('&')[0];
      if (!/^[A-Za-z0-9_-]{30}==$/.test(token)) return null;
      const binary = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
      if (binary.length !== 22) return null;
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      if (bytes.slice(0,4).some(byte => byte !== 0) || bytes[12] !== 0x30 || bytes[13] !== 0x81 || bytes[15] !== 0x02) return null;
      const counter = new DataView(bytes.buffer).getUint32(8, false);
      if (counter > 999998) return null;
      // This payload supplies a suffix only. Its front must come from the same label's text.
      const suffix = String(counter + 1).padStart(6,'0');
      return {code:suffix, suffix, method:'qr', inferred:true};
    } catch { return null; }
  }

  function combineFront(text, suffix) {
    if (!/^\d{6}$/.test(suffix || '')) return null;
    const normalized = String(text || '').toUpperCase().replace(/\s+/g, '');
    const digit = {O:'0',I:'1',L:'1',S:'5'};
    const fronts = [...normalized.matchAll(/(T(?:AA|BA|HA))([0-9OILS])/g)].map(match => match[1] + (digit[match[2]] || match[2]));
    const unique = [...new Set(fronts)];
    return unique.length === 1 ? unique[0] + suffix : null;
  }

  function positions(length, size, step) {
    const result = [0];
    for (let offset = step; offset < length - size; offset += step) result.push(offset);
    if (length > size) result.push(length - size);
    return [...new Set(result)];
  }

  function finderRegions(frame) {
    const {data,width,height} = frame, grey = new Uint8Array(width*height), centers = [];
    for (let i=0,j=0;i<grey.length;i++,j+=4) grey[i]=(data[j]*77+data[j+1]*150+data[j+2]*29)>>8;
    const ratio = runs => {
      const module = runs.reduce((a,b)=>a+b,0)/7;
      if (module<1.5) return 0;
      return runs.every((run,i)=>Math.abs(run-module*(i===2?3:1))<module*(i===2?1.25:.75)) ? module : 0;
    };
    for (const threshold of [55,80,110,140,170,200]) {
      const dark = (x,y)=>grey[y*width+x]<threshold;
      const vertical = (x,y,expected) => {
        const runs=[0,0,1,0,0], limit=Math.ceil(expected*7);
        let up=y-1,down=y+1;
        while(up>=0 && dark(x,up) && runs[2]<limit) {runs[2]++;up--;}
        const topCenter=up;
        while(down<height && dark(x,down) && runs[2]<limit) {runs[2]++;down++;}
        const bottomCenter=down;
        while(up>=0 && !dark(x,up) && runs[1]<limit) {runs[1]++;up--;}
        while(up>=0 && dark(x,up) && runs[0]<limit) {runs[0]++;up--;}
        while(down<height && !dark(x,down) && runs[3]<limit) {runs[3]++;down++;}
        while(down<height && dark(x,down) && runs[4]<limit) {runs[4]++;down++;}
        const module=ratio(runs);
        return module && Math.abs(module-expected)<expected*.65 ? {y:(topCenter+bottomCenter)/2,module:(module+expected)/2} : null;
      };
      for(let y=1;y<height-1;y+=2) {
        const runs=[]; let color=dark(0,y),length=1;
        for(let x=1;x<=width;x++) {
          const next=x<width ? dark(x,y) : !color;
          if(next===color) {length++;continue;}
          runs.push(length); if(runs.length>5) runs.shift();
          if(color && runs.length===5) {
            const module=ratio(runs);
            if(module) {
              const centerX=x-runs[4]-runs[3]-runs[2]/2, cross=vertical(Math.round(centerX),y,module);
              if(cross) {
                const nearby=centers.find(center=>Math.abs(center.x-centerX)<cross.module*2 && Math.abs(center.y-cross.y)<cross.module*2);
                if(nearby) {
                  nearby.x=(nearby.x*nearby.hits+centerX)/(nearby.hits+1);
                  nearby.y=(nearby.y*nearby.hits+cross.y)/(nearby.hits+1);
                  nearby.module=(nearby.module*nearby.hits+cross.module)/(nearby.hits+1); nearby.hits++;
                } else centers.push({x:centerX,y:cross.y,module:cross.module,hits:1});
              }
            }
          }
          color=next;length=1;
        }
      }
    }
    const patterns=centers.filter(center=>center.hits>=3), regions=[];
    for(const corner of patterns) {
      const neighbors=patterns.filter(point=>{
        const distance=Math.hypot(point.x-corner.x,point.y-corner.y)/corner.module;
        return point!==corner && distance>22 && distance<42 && point.module/corner.module>.65 && point.module/corner.module<1.5;
      }).sort((a,b)=>Math.hypot(a.x-corner.x,a.y-corner.y)-Math.hypot(b.x-corner.x,b.y-corner.y)).slice(0,12);
      for(let i=0;i<neighbors.length;i++) for(let j=i+1;j<neighbors.length;j++) {
        const a=neighbors[i],b=neighbors[j],ax=a.x-corner.x,ay=a.y-corner.y,bx=b.x-corner.x,by=b.y-corner.y;
        const first=Math.hypot(ax,ay),second=Math.hypot(bx,by);
        if(Math.abs(ax*bx+ay*by)/(first*second)>.25 || first/second<.65 || first/second>1.5) continue;
        const module=(corner.module+a.module+b.module)/3, margin=module*6;
        const xs=[corner.x,a.x,b.x,a.x+b.x-corner.x],ys=[corner.y,a.y,b.y,a.y+b.y-corner.y];
        const x=Math.max(0,Math.floor(Math.min(...xs)-margin)),y=Math.max(0,Math.floor(Math.min(...ys)-margin));
        const w=Math.min(width,Math.ceil(Math.max(...xs)+margin))-x,h=Math.min(height,Math.ceil(Math.max(...ys)+margin))-y;
        if(w<40 || h<40 || regions.some(region=>Math.abs(region.x-x)<module*4 && Math.abs(region.y-y)<module*4 && Math.abs(region.w-w)<module*6 && Math.abs(region.h-h)<module*6)) continue;
        regions.push({x,y,w,h,score:corner.hits+a.hits+b.hits});
      }
    }
    return regions.sort((a,b)=>b.score-a.score).slice(0,80);
  }

  async function scanFrame(frame, decode, options = {}) {
    if (typeof decode !== 'function' || !frame?.data || frame.data.length !== frame.width * frame.height * 4) return [];
    if (options.cancelled?.()) return [];
    const {width, height, data} = frame;
    const exhaustive = Boolean(options.exhaustive), results = new Map(), seen = new Set();
    // A centred label usually decodes immediately. Avoid the six-threshold
    // finder search and tiled passes when the live frame already has a new QR.
    if (!exhaustive && options.stopWhen) {
      const qr = decode(data,width,height,{inversionAttempts:'attemptBoth'});
      const reading = qr && parsePayload(qr.data);
      if (reading && options.stopWhen(reading)) {
        const corners = ['topLeftCorner','topRightCorner','bottomLeftCorner','bottomRightCorner'].map(key=>qr.location[key]);
        if (corners.every(p=>p && Number.isFinite(p.x) && Number.isFinite(p.y))) {
          options.onDecode?.({supported:true});
          const left=Math.max(0,Math.min(...corners.map(p=>p.x))-5),top=Math.max(0,Math.min(...corners.map(p=>p.y))-5);
          const right=Math.min(width,Math.max(...corners.map(p=>p.x))+5),bottom=Math.min(height,Math.max(...corners.map(p=>p.y))+5);
          return [{...reading,corners:corners.map(p=>({x:p.x/width,y:p.y/height})),bounds:{left:left/width,top:top/height,width:(right-left)/width,height:(bottom-top)/height}}];
        }
      }
    }
    const focused = finderRegions(frame).map(region=>({...region,focused:true}));
    const windows = [{x:0,y:0,w:width,h:height},...focused];
    const add = (x,y,w,h) => {
      const key = `${x},${y},${w},${h}`;
      if (!seen.has(key)) { seen.add(key); windows.push({x,y,w,h}); }
    };
    const small = Math.min(width,height);
    const center = Math.min(640,small);
    const centerRegion={x:Math.round((width-center)/2),y:Math.round((height-center)/2),w:center,h:center,focused:true};
    windows.push(centerRegion);
    const tileStart=windows.length;
    const edge = Math.min(480,small);
    for (const y of positions(height,edge,Math.round(edge/2))) {
      for (const x of positions(width,edge,Math.round(edge/2))) add(x,y,edge,edge);
    }
    if (exhaustive) {
      const finer = Math.min(320,small);
      for (const y of positions(height,finer,Math.round(finer/2))) {
        for (const x of positions(width,finer,Math.round(finer/2))) add(x,y,finer,finer);
      }
    }
    // Cover the frame during live scanning without blocking it with every tile at once.
    const pass=options.pass || 0;
    // Reserve space for tiles even when background patterns create many candidate regions.
    // Rotate both candidate regions and tiles so later passes do not repeat only the top 24.
    const rotate=(regions,offset)=>regions.length ? [...regions.slice(offset%regions.length),...regions.slice(0,offset%regions.length)] : [];
    const selected = exhaustive ? windows : [windows[0],centerRegion,...rotate(focused,pass*10).slice(0,10),...rotate(windows.slice(tileStart),pass*12).slice(0,12)];
    const limit = exhaustive ? 180 : 24;
    for (let index = 0; index < Math.min(selected.length,limit); index++) {
      if (options.cancelled?.()) break;
      const region = selected[index], pixels = new Uint8ClampedArray(region.w * region.h * 4);
      for (let y = 0; y < region.h; y++) {
        const offset = ((region.y + y) * width + region.x) * 4;
        pixels.set(data.subarray(offset,offset + region.w * 4),y * region.w * 4);
      }
      for (let count = 0; count < 4; count++) {
        let qr = decode(pixels,region.w,region.h,{inversionAttempts:'attemptBoth'}), zoom=1;
        if (!qr && count === 0 && region.focused && region.w <= 640 && region.h <= 640) {
          const enlarged=new Uint8ClampedArray(region.w*region.h*16), enlargedWidth=region.w*2;
          for(let y=0;y<region.h;y++) for(let x=0;x<region.w;x++) {
            const source=(y*region.w+x)*4;
            for(let dy=0;dy<2;dy++) for(let dx=0;dx<2;dx++) enlarged.set(pixels.subarray(source,source+4),((y*2+dy)*enlargedWidth+x*2+dx)*4);
          }
          qr=decode(enlarged,region.w*2,region.h*2,{inversionAttempts:'attemptBoth'}); zoom=2;
        }
        if (!qr) break;
        const corners = ['topLeftCorner','topRightCorner','bottomLeftCorner','bottomRightCorner'].map(key=>qr.location[key] && {x:qr.location[key].x/zoom,y:qr.location[key].y/zoom});
        if (corners.some(point=>!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) break;
        const x0 = Math.max(0,Math.floor(Math.min(...corners.map(point=>point.x)))-5);
        const y0 = Math.max(0,Math.floor(Math.min(...corners.map(point=>point.y)))-5);
        const x1 = Math.min(region.w,Math.ceil(Math.max(...corners.map(point=>point.x)))+5);
        const y1 = Math.min(region.h,Math.ceil(Math.max(...corners.map(point=>point.y)))+5);
        const reading = parsePayload(qr.data);
        options.onDecode?.({supported:Boolean(reading)});
        if (reading && !results.has(reading.code)) {
          results.set(reading.code,{...reading,corners:corners.map(point=>({x:(region.x+point.x)/width,y:(region.y+point.y)/height})),bounds:{left:(region.x+x0)/width,top:(region.y+y0)/height,width:(x1-x0)/width,height:(y1-y0)/height}});
          if(options.stopWhen?.(reading)) return [...results.values()].sort((a,b)=>a.bounds.top-b.bounds.top || a.bounds.left-b.bounds.left);
        }
        // Mask a decoded QR in this tile to find other labels, never modifying the source.
        for (let y=y0;y<y1;y++) pixels.fill(255,(y*region.w+x0)*4,(y*region.w+x1)*4);
      }
      if (index % 3 === 2) {
        options.progress?.(Math.round((index+1)/Math.min(selected.length,limit)*100));
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    return [...results.values()].sort((a,b)=>a.bounds.top-b.bounds.top || a.bounds.left-b.bounds.left);
  }
  return {parsePayload,scanFrame,finderRegions,combineFront};
});

