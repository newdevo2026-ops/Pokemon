// Minimal GLB reader.
//
// Enough of glTF 2.0 to display a model exported from Meshy, Blender, Sketchfab
// or similar: triangle meshes, baked node transforms, base-colour factors and
// base-colour textures. No skinning or animation yet — those come with the
// animation pass.
//
// Node hierarchies are flattened at load time: every primitive's vertices are
// transformed into model space, so drawing is one buffer per primitive with no
// scene graph to walk each frame.

const MAGIC = 0x46546c67;        // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const COMPONENTS_PER = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseContainer(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) {
    // A plain .gltf file is JSON; accept it with no binary chunk.
    try {
      return { json: JSON.parse(new TextDecoder().decode(buffer)), bin: null };
    } catch {
      throw new Error('not a glTF/GLB file');
    }
  }
  const length = view.getUint32(8, true);
  let offset = 12, json = null, bin = null;
  while (offset < length) {
    const chunkLen = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (chunkType === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, chunkLen)));
    } else if (chunkType === CHUNK_BIN) {
      bin = new Uint8Array(buffer, start, chunkLen);
    }
    offset = start + chunkLen + (chunkLen % 4 ? 4 - (chunkLen % 4) : 0);
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

/** Decodes a data: URI or returns the embedded binary chunk. */
async function bufferBytes(gltf, bin, index) {
  const buf = gltf.buffers[index];
  if (!buf.uri) {
    if (!bin) throw new Error('buffer has no uri and the file has no BIN chunk');
    return bin;
  }
  if (buf.uri.startsWith('data:')) {
    const res = await fetch(buf.uri);
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error('external buffer files are not supported: ' + buf.uri);
}

function readAccessor(gltf, buffers, index) {
  const acc = gltf.accessors[index];
  const n = COMPONENTS_PER[acc.type];
  const Ctor = COMPONENT[acc.componentType];
  const out = new Float32Array(acc.count * n);
  if (acc.bufferView == null) return out;             // sparse-only: treat as zeros

  const bv = gltf.bufferViews[acc.bufferView];
  const bytes = buffers[bv.buffer ?? 0];
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const elementSize = Ctor.BYTES_PER_ELEMENT * n;
  const stride = bv.byteStride || elementSize;

  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride;
    const src = new Ctor(bytes.buffer, bytes.byteOffset + at, n);
    for (let k = 0; k < n; k++) {
      let v = src[k];
      // glTF stores normalised integer attributes; scale them back to 0..1
      if (acc.normalized) {
        if (Ctor === Uint8Array) v /= 255;
        else if (Ctor === Uint16Array) v /= 65535;
        else if (Ctor === Int8Array) v = Math.max(v / 127, -1);
        else if (Ctor === Int16Array) v = Math.max(v / 32767, -1);
      }
      out[i * n + k] = v;
    }
  }
  return out;
}

function readIndices(gltf, buffers, index) {
  const acc = gltf.accessors[index];
  const Ctor = COMPONENT[acc.componentType];
  const bv = gltf.bufferViews[acc.bufferView];
  const bytes = buffers[bv.buffer ?? 0];
  const at = bytes.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const src = new Ctor(bytes.buffer, at, acc.count);
  return Array.from(src);
}

// ---------------------------------------------------------------- matrices --
const identity = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function mul(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      o[i * 4 + j] = a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1]
                   + a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
    }
  }
  return o;
}

function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

const applyPoint = (m, x, y, z) => [
  m[0]*x + m[4]*y + m[8]*z + m[12],
  m[1]*x + m[5]*y + m[9]*z + m[13],
  m[2]*x + m[6]*y + m[10]*z + m[14],
];
const applyDir = (m, x, y, z) => {
  const o = [m[0]*x + m[4]*y + m[8]*z, m[1]*x + m[5]*y + m[9]*z, m[2]*x + m[6]*y + m[10]*z];
  const l = Math.hypot(o[0], o[1], o[2]) || 1;
  return [o[0]/l, o[1]/l, o[2]/l];
};

// ----------------------------------------------------------------- images --
async function decodeImage(gltf, buffers, index) {
  const img = gltf.images[index];
  let blob;
  if (img.uri) {
    if (!img.uri.startsWith('data:')) throw new Error('external image files are not supported');
    blob = await (await fetch(img.uri)).blob();
  } else {
    const bv = gltf.bufferViews[img.bufferView];
    const bytes = buffers[bv.buffer ?? 0];
    blob = new Blob(
      [new Uint8Array(bytes.buffer, bytes.byteOffset + (bv.byteOffset ?? 0), bv.byteLength)],
      { type: img.mimeType || 'image/png' });
  }
  return createImageBitmap(blob, { imageOrientation: 'flipY' });
}

/**
 * @returns {{ primitives: Array<{pos,norm,uv,color,indices,baseColor,image}>,
 *             bounds: {min:number[], max:number[]} }}
 */
export async function parseGLB(arrayBuffer) {
  const { json: gltf, bin } = parseContainer(arrayBuffer);
  const buffers = [];
  for (let i = 0; i < (gltf.buffers?.length ?? 0); i++) {
    buffers[i] = await bufferBytes(gltf, bin, i);
  }

  const images = new Map();
  const imageFor = async (materialIndex) => {
    const mat = gltf.materials?.[materialIndex];
    const texIndex = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
    if (texIndex == null) return null;
    const source = gltf.textures?.[texIndex]?.source;
    if (source == null) return null;
    if (!images.has(source)) {
      try { images.set(source, await decodeImage(gltf, buffers, source)); }
      catch (e) { console.warn('texture skipped:', e.message); images.set(source, null); }
    }
    return images.get(source);
  };

  const primitives = [];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];

  const walk = async (nodeIndex, parent) => {
    const node = gltf.nodes[nodeIndex];
    const world = mul(parent, nodeMatrix(node));
    if (node.mesh != null) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        if (prim.mode != null && prim.mode !== 4) continue;      // triangles only
        const pos = readAccessor(gltf, buffers, prim.attributes.POSITION);
        const count = pos.length / 3;
        const norm = prim.attributes.NORMAL != null
          ? readAccessor(gltf, buffers, prim.attributes.NORMAL) : null;
        const uv = prim.attributes.TEXCOORD_0 != null
          ? readAccessor(gltf, buffers, prim.attributes.TEXCOORD_0) : new Float32Array(count * 2);
        const vcol = prim.attributes.COLOR_0 != null
          ? readAccessor(gltf, buffers, prim.attributes.COLOR_0) : null;
        const vcolStride = vcol ? vcol.length / count : 0;

        const outPos = new Float32Array(count * 3);
        const outNorm = new Float32Array(count * 3);
        const outCol = new Float32Array(count * 3);
        const mat = gltf.materials?.[prim.material];
        const base = mat?.pbrMetallicRoughness?.baseColorFactor || [1, 1, 1, 1];
        for (let i = 0; i < count; i++) {
          const p = applyPoint(world, pos[i*3], pos[i*3+1], pos[i*3+2]);
          outPos.set(p, i * 3);
          for (let k = 0; k < 3; k++) {
            if (p[k] < min[k]) min[k] = p[k];
            if (p[k] > max[k]) max[k] = p[k];
          }
          if (norm) outNorm.set(applyDir(world, norm[i*3], norm[i*3+1], norm[i*3+2]), i * 3);
          for (let k = 0; k < 3; k++) {
            outCol[i * 3 + k] = base[k] * (vcol ? vcol[i * vcolStride + k] : 1);
          }
        }
        if (!norm) computeNormals(outPos, outNorm, prim.indices != null
          ? readIndices(gltf, buffers, prim.indices) : null);

        primitives.push({
          pos: outPos, norm: outNorm, uv, color: outCol,
          indices: prim.indices != null ? readIndices(gltf, buffers, prim.indices) : null,
          image: await imageFor(prim.material),
          alpha: base[3] ?? 1,
        });
      }
    }
    for (const child of node.children || []) await walk(child, world);
  };

  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const roots = scene?.nodes ?? gltf.nodes?.map((_, i) => i) ?? [];
  for (const r of roots) await walk(r, identity());

  if (!primitives.length) throw new Error('no triangle geometry found');
  return { primitives, bounds: { min, max } };
}

/** Face normals for files that ship without them. */
function computeNormals(pos, norm, indices) {
  const tri = indices || Array.from({ length: pos.length / 3 }, (_, i) => i);
  for (let i = 0; i < tri.length; i += 3) {
    const [a, b, c] = [tri[i], tri[i + 1], tri[i + 2]];
    const ux = pos[b*3] - pos[a*3], uy = pos[b*3+1] - pos[a*3+1], uz = pos[b*3+2] - pos[a*3+2];
    const vx = pos[c*3] - pos[a*3], vy = pos[c*3+1] - pos[a*3+1], vz = pos[c*3+2] - pos[a*3+2];
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const idx of [a, b, c]) {
      norm[idx*3] += nx; norm[idx*3+1] += ny; norm[idx*3+2] += nz;
    }
  }
  for (let i = 0; i < norm.length; i += 3) {
    const l = Math.hypot(norm[i], norm[i+1], norm[i+2]) || 1;
    norm[i] /= l; norm[i+1] /= l; norm[i+2] /= l;
  }
}
