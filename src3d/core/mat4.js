// Minimal column-major 4x4 / vec3 maths. Just what the renderer needs.

export const mat4 = {
  create: () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),

  identity(o) {
    o.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    return o;
  },

  multiply(o, a, b) {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3], a10=a[4],a11=a[5],a12=a[6],a13=a[7],
          a20=a[8],a21=a[9],a22=a[10],a23=a[11], a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    for (let i = 0; i < 4; i++) {
      const b0=b[i*4], b1=b[i*4+1], b2=b[i*4+2], b3=b[i*4+3];
      o[i*4]   = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      o[i*4+1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      o[i*4+2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      o[i*4+3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    }
    return o;
  },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o.set([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
    return o;
  },

  lookAt(o, eye, center, up) {
    let z0=eye[0]-center[0], z1=eye[1]-center[1], z2=eye[2]-center[2];
    let len = Math.hypot(z0,z1,z2) || 1; z0/=len; z1/=len; z2/=len;
    let x0=up[1]*z2-up[2]*z1, x1=up[2]*z0-up[0]*z2, x2=up[0]*z1-up[1]*z0;
    len = Math.hypot(x0,x1,x2) || 1; x0/=len; x1/=len; x2/=len;
    const y0=z1*x2-z2*x1, y1=z2*x0-z0*x2, y2=z0*x1-z1*x0;
    o.set([x0,y0,z0,0, x1,y1,z1,0, x2,y2,z2,0,
      -(x0*eye[0]+x1*eye[1]+x2*eye[2]),
      -(y0*eye[0]+y1*eye[1]+y2*eye[2]),
      -(z0*eye[0]+z1*eye[1]+z2*eye[2]), 1]);
    return o;
  },

  fromTRS(o, tx, ty, tz, ry, sx, sy, sz) {
    const c = Math.cos(ry), s = Math.sin(ry);
    o.set([c*sx,0,-s*sx,0, 0,sy,0,0, s*sz,0,c*sz,0, tx,ty,tz,1]);
    return o;
  },

  translate(o, x, y, z) {
    o[12] += o[0]*x + o[4]*y + o[8]*z;
    o[13] += o[1]*x + o[5]*y + o[9]*z;
    o[14] += o[2]*x + o[6]*y + o[10]*z;
    return o;
  },
};

/** Transform stack used while assembling a mesh from parts. */
export class Stack {
  constructor() {
    this.m = mat4.create();
    this.saved = [];
    this.tmp = mat4.create();
  }
  push() { this.saved.push(new Float32Array(this.m)); return this; }
  pop() { this.m = this.saved.pop(); return this; }
  reset() { mat4.identity(this.m); this.saved.length = 0; return this; }

  translate(x, y, z) {
    mat4.translate(this.m, x, y, z);
    return this;
  }
  scale(x, y = x, z = x) {
    const t = this.tmp;
    t.set([x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]);
    mat4.multiply(this.m, this.m, t);
    return this;
  }
  rotateX(a) {
    const c = Math.cos(a), s = Math.sin(a), t = this.tmp;
    t.set([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
    mat4.multiply(this.m, this.m, t);
    return this;
  }
  rotateY(a) {
    const c = Math.cos(a), s = Math.sin(a), t = this.tmp;
    t.set([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
    mat4.multiply(this.m, this.m, t);
    return this;
  }
  rotateZ(a) {
    const c = Math.cos(a), s = Math.sin(a), t = this.tmp;
    t.set([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]);
    mat4.multiply(this.m, this.m, t);
    return this;
  }
  /** Apply the current matrix to a point. */
  apply(out, x, y, z) {
    const m = this.m;
    out[0] = m[0]*x + m[4]*y + m[8]*z + m[12];
    out[1] = m[1]*x + m[5]*y + m[9]*z + m[13];
    out[2] = m[2]*x + m[6]*y + m[10]*z + m[14];
    return out;
  }
}
