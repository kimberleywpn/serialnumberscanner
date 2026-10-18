'use strict';
importScripts('jsqr-1.4.0.js?v=3.4','qr-core-v2.js?v=3.21');
self.onmessage = async ({data:job}) => {
  try {
    const diagnostics={available:true,decoded:0,unsupported:0};
    const excluded = new Set(job.excluded);
    const readings = await LabelQR.scanFrame({data:new Uint8ClampedArray(job.buffer),width:job.width,height:job.height},jsQR,{
      exhaustive:job.exhaustive,deep:job.deep,pass:job.pass,
      stopWhen:job.exhaustive ? undefined : reading=>!excluded.has(reading.code),
      onDecode:({supported})=>{diagnostics.decoded++;if(!supported) diagnostics.unsupported++;}
    });
    self.postMessage({id:job.id,readings,diagnostics});
  } catch(error) { self.postMessage({id:job.id,error:error.message}); }
};

