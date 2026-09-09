// WebGL2 renderer: flat-shaded, vertex-coloured, one directional light plus
// hemisphere ambient and distance fog.  No textures anywhere — the whole look
// comes from geometry and colour, which is what keeps the art style coherent
// and the build a single dependency-free file.

import { mat4 } from './mat4.js';

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in vec2 aUV;
uniform mat4 uViewProj;
uniform mat4 uModel;
// Two copies of the normal: procedural geometry wants the faceted look,
// imported models ship smooth normals and should keep them.
flat out vec3 vNormalFlat;
out vec3 vNormalSmooth;
out vec3 vColor;
out vec2 vUV;
out float vDepth;
out vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * world;
  // Uniform scale only, so the model matrix doubles as the normal matrix.
  vec3 n = normalize(mat3(uModel) * aNormal);
  vNormalFlat = n;
  vNormalSmooth = n;
  vColor = aColor;
  vUV = aUV;
  vWorld = world.xyz;
  vDepth = gl_Position.w;
}`;

const FRAG = `#version 300 es
precision highp float;
flat in vec3 vNormalFlat;
in vec3 vNormalSmooth;
in vec3 vColor;
in vec2 vUV;
in float vDepth;
in vec3 vWorld;
uniform sampler2D uTex;
uniform float uUseTex;
uniform float uSmooth;
uniform vec3 uLightDir;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform vec3 uTint;
uniform float uAlpha;
uniform float uEmissive;
out vec4 fragColor;
void main() {
  vec3 n = normalize(mix(vNormalFlat, vNormalSmooth, uSmooth));
  vec4 tex = texture(uTex, vUV);
  vec3 albedo = mix(vColor, vColor * tex.rgb, uUseTex);
  float lambert = max(dot(n, uLightDir), 0.0);
  // Hemisphere ambient: sky above, bounced ground light below.
  float hemi = n.y * 0.5 + 0.5;
  vec3 ambient = mix(uGroundColor, uSkyColor, hemi);
  vec3 warm = vec3(1.06, 1.0, 0.90);
  vec3 lit = albedo * uTint * (ambient + lambert * 0.95 * warm);
  lit = mix(lit, albedo * uTint, uEmissive);
  float fog = clamp((vDepth - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  fragColor = vec4(mix(lit, uFogColor, fog * 0.75), uAlpha);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

export class Mesh {
  /** @param data {pos, norm, col, count, uv?, indices?} */
  constructor(gl, data) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.bufs = [];
    const attach = (loc, arr, size) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      this.bufs.push(buf);
    };
    attach(0, data.pos, 3);
    attach(1, data.norm, 3);
    attach(2, data.col, 3);
    if (data.uv) attach(3, data.uv, 2);
    if (data.indices) {
      const big = data.pos.length / 3 > 65535;
      this.indexType = big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      const arr = big ? new Uint32Array(data.indices) : new Uint16Array(data.indices);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      this.bufs.push(buf);
      this.count = arr.length;
      this.indexed = true;
    } else {
      this.count = data.count ?? data.pos.length / 3;
      this.indexed = false;
    }
    gl.bindVertexArray(null);
  }
  dispose() {
    this.gl.deleteVertexArray(this.vao);
    for (const b of this.bufs) this.gl.deleteBuffer(b);
  }
}

export class Renderer {
  constructor(canvas) {
    // alpha:true lets a CSS sky gradient show through behind the scene, which
    // is far cheaper than rendering a sky dome and looks better than a flat
    // clear colour.
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL 2 is not available in this browser');
    this.gl = gl;
    this.canvas = canvas;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(prog));
    }
    this.prog = prog;
    this.u = {};
    for (const n of ['uViewProj','uModel','uLightDir','uSkyColor','uGroundColor',
                     'uFogColor','uFogRange','uTint','uAlpha','uEmissive',
                     'uTex','uUseTex','uSmooth']) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }

    this.proj = mat4.create();
    this.view = mat4.create();
    this.viewProj = mat4.create();
    this.model = mat4.create();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Warm key light, cool sky fill: the classic outdoor pairing that stops
    // flat-shaded geometry from looking like plastic.
    this.sky = [0.44, 0.52, 0.66];
    this.ground = [0.24, 0.21, 0.16];
    this.fog = [0.78, 0.87, 0.95];
    this.fogRange = [70, 210];
    this.lightDir = this.normalize([0.42, 0.80, 0.44]);
  }

  normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0]/l, v[1]/l, v[2]/l];
  }

  mesh(data) { return new Mesh(this.gl, data); }

  /** Uploads an ImageBitmap as a mipmapped, repeating texture. */
  texture(bitmap) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const max = gl.getExtension('EXT_texture_filter_anisotropic');
    if (max) {
      gl.texParameterf(gl.TEXTURE_2D, max.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(8, gl.getParameter(max.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
    return tex;
  }

  /** `dpr` is the display ratio; we render above it and let the browser
   *  downscale, which is what actually removes the stair-stepping. */
  resize(w, h, dpr = 1) {
    const ss = Math.min(2.6, dpr * 1.6);
    this.canvas.width = Math.floor(w * ss);
    this.canvas.height = Math.floor(h * ss);
    this.aspect = w / h;
  }

  beginFrame(camera) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    mat4.perspective(this.proj, camera.fov, this.aspect, 0.5, 400);
    mat4.lookAt(this.view, camera.eye, camera.target, [0, 1, 0]);
    mat4.multiply(this.viewProj, this.proj, this.view);

    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uViewProj, false, this.viewProj);
    gl.uniform3fv(this.u.uLightDir, this.lightDir);
    gl.uniform3fv(this.u.uSkyColor, this.sky);
    gl.uniform3fv(this.u.uGroundColor, this.ground);
    gl.uniform3fv(this.u.uFogColor, this.fog);
    gl.uniform2fv(this.u.uFogRange, this.fogRange);
  }

  /** @param o {x,y,z,rotY,scale,tint,alpha,emissive} */
  draw(mesh, o = {}) {
    const gl = this.gl;
    const s = o.scale ?? 1;
    mat4.fromTRS(this.model, o.x ?? 0, o.y ?? 0, o.z ?? 0, o.rotY ?? 0, s, o.scaleY ?? s, s);
    gl.uniformMatrix4fv(this.u.uModel, false, this.model);
    this._material(o);
    this._issue(mesh);
  }

  /** Draw with a fully composed model matrix — used for animated limbs. */
  drawMatrix(mesh, model, o = {}) {
    this.gl.uniformMatrix4fv(this.u.uModel, false, model);
    this._material(o);
    this._issue(mesh);
  }

  _material(o) {
    const gl = this.gl;
    gl.uniform3fv(this.u.uTint, o.tint ?? [1, 1, 1]);
    gl.uniform1f(this.u.uAlpha, o.alpha ?? 1);
    gl.uniform1f(this.u.uEmissive, o.emissive ?? 0);
    gl.uniform1f(this.u.uSmooth, o.smooth ? 1 : 0);
    if (o.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, o.texture);
      gl.uniform1i(this.u.uTex, 0);
      gl.uniform1f(this.u.uUseTex, 1);
    } else {
      gl.uniform1f(this.u.uUseTex, 0);
    }
  }

  _issue(mesh) {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    if (mesh.indexed) gl.drawElements(gl.TRIANGLES, mesh.count, mesh.indexType, 0);
    else gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  depthWrite(on) { this.gl.depthMask(on); }
}

/** Orbit camera locked to a target, the way a fixed-pitch RPG camera behaves. */
export class OrbitCamera {
  constructor() {
    this.yaw = 0.6;
    this.pitch = 0.66;
    this.distance = 38;
    this.height = 1.6;
    this.fov = 0.72;
    this.target = [0, 0, 0];
    this.eye = [0, 0, 0];
    this.follow = [0, 0, 0];
  }
  update(tx, ty, tz, dt) {
    const k = 1 - Math.pow(0.0001, dt);
    this.follow[0] += (tx - this.follow[0]) * k;
    this.follow[1] += (ty - this.follow[1]) * k;
    this.follow[2] += (tz - this.follow[2]) * k;
    this.target[0] = this.follow[0];
    this.target[1] = this.follow[1] + this.height;
    this.target[2] = this.follow[2];
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.eye[0] = this.target[0] + Math.sin(this.yaw) * cp * this.distance;
    this.eye[1] = this.target[1] + sp * this.distance;
    this.eye[2] = this.target[2] + Math.cos(this.yaw) * cp * this.distance;
  }
  /** Camera-relative forward/right on the ground plane, for movement input. */
  basis() {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    return { fx: -s, fz: -c, rx: c, rz: -s };
  }
}
