import test from 'node:test';
import assert from 'node:assert/strict';
import {indexEncoding} from '../scripts/benchmark-entrance-encoding.mjs';

function fixture(){
  const bytes=Buffer.alloc(512);bytes.writeUInt32BE(16,0);bytes.write('avcC',4);Buffer.from('01640034ffe10000','hex').copy(bytes,8);
  const streams=[{codec_type:'video',codec_name:'h264',width:3840,height:2160,r_frame_rate:'60/1',has_b_frames:0,
    color_primaries:'bt709',color_transfer:'bt709',color_space:'bt709'}];
  const packets=Array.from({length:5},(_,i)=>({pos:String(100+i*10),size:'10',pts_time:(i/60).toFixed(6),dts_time:(i/60).toFixed(6),flags:i%4===0?'K__':'___'}));
  return {bytes,streams,packets};
}

test('encoding experiment indexes exact MP4 sample ranges including a partial final group',()=>{
  const {bytes,...metadata}=fixture(),indexed=indexEncoding(bytes,metadata,4,5);
  assert.deepEqual(indexed.frames,[[100,10,1],[110,10,0],[120,10,0],[130,10,0],[140,10,1]]);
  assert.deepEqual(indexed.decoder,{codec:'avc1.640034',description:'01640034ffe10000',keyframeInterval:4});
});

test('benchmark refuses wrong prediction boundaries and reordered or missing pictures',()=>{
  for(const mutate of [
    f=>f.packets[2].flags='K__',
    f=>f.packets[1].pts_time='0.050000',
    f=>f.packets[1].dts_time='0.000000',
    f=>delete f.packets[1].pts_time,
    f=>f.packets[1].dts_time='N/A',
    f=>f.packets.pop(),
    f=>f.streams[0].has_b_frames=2,
  ]){
    const fixtureData=fixture();mutate(fixtureData);const {bytes,...metadata}=fixtureData;
    assert.throws(()=>indexEncoding(bytes,metadata,4,5));
  }
});

test('benchmark rejects corrupt byte ranges, truncated AVC config and changed 4K color contract',()=>{
  for(const mutate of [
    f=>f.packets[1].pos='105',
    f=>f.packets[1].size='999',
    f=>f.bytes.writeUInt32BE(4096,0),
    f=>f.streams[0].width=1920,
    f=>f.streams[0].color_transfer='unknown',
  ]){
    const fixtureData=fixture();mutate(fixtureData);const {bytes,...metadata}=fixtureData;
    assert.throws(()=>indexEncoding(bytes,metadata,4,5));
  }
});
