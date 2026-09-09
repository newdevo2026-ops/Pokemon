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
uniform mat4 uViewProj;
uniform mat4 uModel;
flat out vec3 vNormal;
out vec3 vColor;
out float vDepth;
out vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * world;
  // Uniform scale only, so the model matrix doubles as the normal matrix.
  vNormal = normalize(mat3(uModel) * aNormal);
  vColor = aColor;
  vWorld = world.xyz;
  vDepth = gl_Position.w;
}`;

const FRAG = `#version 300 es
precision highp float;
flat in vec3 vNormal;
in vec3 vColor;
in float vDepth;
in vec3 vWorld;
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
  vec3 n = normalize(vNormal);
  float lambert = max(dot(n, uLightDir), 0.0);
  // Hemisphere ambient: sky above, bounced ground light below.
  float hemi = n.y * 0.5 + 0.5;
  vec3 ambient = mix(uGroundColor, uSkyColor, hemi);
  vec3 warm = vec3(1.06, 1.0, 0.90);
  vec3 lit = vColor * uTint * (ambient + lambert * 0.95 * warm);
  lit = mix(lit, vColor * uTint, uEmissive);
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
  constructor(gl, data) {
    this.gl = gl;
    this.count = data.count;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const attach = (loc, arr) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
      return buf;
    };
    this.bufs = [attach(0, data.pos), attach(1, data.norm), attach(2, data.col)];
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
                     'uFogColor','uFogRange','uTint','uAlpha','uEmissive']) {
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
    gl.uniform3fv(this.u.uTint, o.tint ?? [1, 1, 1]);
    gl.uniform1f(this.u.uAlpha, o.alpha ?? 1);
    gl.uniform1f(this.u.uEmissive, o.emissive ?? 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  /** Draw with a fully composed model matrix — used for animated limbs. */
  drawMatrix(mesh, model, o = {}) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.u.uModel, false, model);
    gl.uniform3fv(this.u.uTint, o.tint ?? [1, 1, 1]);
    gl.uniform1f(this.u.uAlpha, o.alpha ?? 1);
    gl.uniform1f(this.u.uEmissive, o.emissive ?? 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
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
