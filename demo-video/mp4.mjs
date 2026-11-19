import assert from 'node:assert/strict';
function boxes(data,start=0,end=data.length){
 const result=[];
 for(let pos=start;pos+8<=end;){
  let size=data.readUInt32BE(pos),header=8;
  if(size===1){assert.ok(pos+16<=end);size=Number(data.readBigUInt64BE(pos+8));header=16;}
  if(size===0)size=end-pos;
  assert.ok(Number.isSafeInteger(size)&&size>=header&&pos+size<=end,'Malformed MP4 box');
  result.push({type:data.toString('ascii',pos+4,pos+8),start:pos+header,end:pos+size});
  pos+=size;
 }
 return result;
}
function child(data,box,type){return boxes(data,box.start,box.end).find(b=>b.type===type);}
function required(value,label){assert.ok(value,'Missing MP4 '+label);return value;}
function duration(data,b){const v=data[b.start],scale=data.readUInt32BE(b.start+(v===1?20:12));const d=v===1?Number(data.readBigUInt64BE(b.start+24)):data.readUInt32BE(b.start+16);return d/scale;}
export function measureMP4(data){
 const moov=required(boxes(data).find(b=>b.type==='moov'),'movie');
 const seconds=duration(data,required(child(data,moov,'mvhd'),'duration'));
 let width=0,height=0,frames=0,audio=false;
 for(const t of boxes(data,moov.start,moov.end).filter(b=>b.type==='trak')){
  const mdia=required(child(data,t,'mdia'),'media'),hdlr=required(child(data,mdia,'hdlr'),'handler');
  const handler=data.toString('ascii',hdlr.start+8,hdlr.start+12);
  if(handler==='soun')audio=true;
  if(handler!=='vide')continue;
  const tkhd=required(child(data,t,'tkhd'),'video track');width=data.readUInt32BE(tkhd.end-8)/65536;height=data.readUInt32BE(tkhd.end-4)/65536;
  const minf=required(child(data,mdia,'minf'),'media info'),stbl=required(child(data,minf,'stbl'),'sample table'),stts=required(child(data,stbl,'stts'),'sample timing');
  const count=data.readUInt32BE(stts.start+4);
  for(let n=0;n<count;n++)frames+=data.readUInt32BE(stts.start+8+n*8);
 }
 return {durationSeconds:seconds,width,height,frames,fps:frames/seconds,audio};
}
