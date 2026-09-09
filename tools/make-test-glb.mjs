// Builds a textured, translated/rotated/scaled cube as a real .glb, so the
// model loader can be exercised without waiting on artist-made assets.
//
//   node tools/make-test-glb.mjs assets/models/<id>.glb
//
// Then add that id to assets/models/manifest.json. A correct import shows a
// red/blue checkered box, auto-fitted to that creature's height and standing
// on the ground — which also proves node transforms are being baked.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// ---- tiny PNG encoder ----
const CRC = (() => { const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t; })();
function crc32(buf) { let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = [];
  for (let y = 0; y < h; y++) { raw.push(0);
    for (let x = 0; x < w; x++) raw.push(...pixel(x, y)); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- cube geometry ----
const faces = [
  { n: [0,0,1],  v: [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]] },
  { n: [0,0,-1], v: [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]] },
  { n: [1,0,0],  v: [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]] },
  { n: [-1,0,0], v: [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]] },
  { n: [0,1,0],  v: [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]] },
  { n: [0,-1,0], v: [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]] },
];
const pos = [], nrm = [], uv = [], idx = [];
faces.forEach((f, fi) => {
  f.v.forEach((v, i) => { pos.push(...v); nrm.push(...f.n);
    uv.push([0,0],[1,0],[1,1],[0,1][i] ?? 0); });
  uv.length = (fi + 1) * 8;
  const b = fi * 4;
  idx.push(b, b+1, b+2, b, b+2, b+3);
});
// rewrite UVs cleanly
uv.length = 0;
for (let f = 0; f < 6; f++) uv.push(0,0, 1,0, 1,1, 0,1);

const posB = Buffer.from(new Float32Array(pos).buffer);
const nrmB = Buffer.from(new Float32Array(nrm).buffer);
const uvB  = Buffer.from(new Float32Array(uv).buffer);
const idxB = Buffer.from(new Uint16Array(idx).buffer);
const texB = png(8, 8, (x, y) => (x + y) % 2 ? [235, 90, 70] : [40, 60, 120]);

const pad = (b) => b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b;
const parts = [posB, nrmB, uvB, idxB, texB].map(pad);
const offsets = []; let at = 0;
for (const p of parts) { offsets.push(at); at += p.length; }
const bin = Buffer.concat(parts);

const gltf = {
  asset: { version: '2.0', generator: 'aurelia-test' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  // deliberately offset, rotated and scaled, to prove transforms get baked
  nodes: [{ mesh: 0, translation: [5, 3, -2], scale: [2.5, 2.5, 2.5],
            rotation: [0, 0.3826834, 0, 0.9238795] }],
  meshes: [{ primitives: [{
    attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
  materials: [{ pbrMetallicRoughness: {
    baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 } } }],
  textures: [{ source: 0, sampler: 0 }],
  samplers: [{}],
  images: [{ bufferView: 4, mimeType: 'image/png' }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3',
      min: [-1,-1,-1], max: [1,1,1] },
    { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: 24, type: 'VEC2' },
    { bufferView: 3, componentType: 5123, count: 36, type: 'SCALAR' },
  ],
  bufferViews: parts.map((p, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: p.length })),
  buffers: [{ byteLength: bin.length }],
};

const jsonBuf = pad(Buffer.from(JSON.stringify(gltf), 'utf8'));
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
const chunkHdr = (len, type) => { const b = Buffer.alloc(8);
  b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
writeFileSync(process.argv[2], Buffer.concat([
  header, chunkHdr(jsonBuf.length, 0x4e4f534a), jsonBuf,
  chunkHdr(bin.length, 0x004e4942), bin,
]));
console.log('wrote', process.argv[2], bin.length + jsonBuf.length + 20, 'bytes');
