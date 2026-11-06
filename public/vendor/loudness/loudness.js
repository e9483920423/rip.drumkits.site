// node_modules/@audio/biquad/biquad.js
var PI2 = Math.PI * 2;
var state = () => new Float64Array(2);
function process(data, c, s = state()) {
  let b0 = c.b0, b1 = c.b1, b2 = c.b2, a1 = c.a1, a2 = c.a2;
  let z1 = s[0], z2 = s[1];
  for (let i = 0, l = data.length; i < l; i++) {
    let x = data[i];
    let y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    data[i] = y;
  }
  s[0] = z1;
  s[1] = z2;
  return data;
}
function process2(data, c, s, d, t) {
  let b0 = c.b0, b1 = c.b1, b2 = c.b2, a1 = c.a1, a2 = c.a2;
  let e0 = d.b0, e1 = d.b1, e2 = d.b2, f1 = d.a1, f2 = d.a2;
  let z1 = s[0], z2 = s[1], w1 = t[0], w2 = t[1];
  for (let i = 0, l = data.length; i < l; i++) {
    let x = data[i];
    let y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    data[i] = y;
    x = data[i];
    y = e0 * x + w1;
    w1 = e1 * x - f1 * y + w2;
    w2 = e2 * x - f2 * y;
    data[i] = y;
  }
  s[0] = z1;
  s[1] = z2;
  t[0] = w1;
  t[1] = w2;
}
function step(c, s, x) {
  let y = c.b0 * x + s[0];
  s[0] = c.b1 * x - c.a1 * y + s[1];
  s[1] = c.b2 * x - c.a2 * y;
  return y;
}
function cascade(data, coefs2, states) {
  states ??= coefs2.map(() => state());
  let i = 0;
  for (; i + 1 < coefs2.length; i += 2) process2(data, coefs2[i], states[i], coefs2[i + 1], states[i + 1]);
  if (i < coefs2.length) process(data, coefs2[i], states[i]);
  return data;
}
function filter(data, params) {
  let coefs2 = Array.isArray(params.coefs) ? params.coefs : [params.coefs];
  if (coefs2[0] == null || coefs2[0].b0 == null) throw Error("filter: params.coefs must be SOS section(s) {b0,b1,b2,a1,a2}");
  params.state ??= coefs2.map(() => state());
  return cascade(data, coefs2, params.state);
}
function magnitude(c, f, fs = 44100) {
  let w = PI2 * f / fs;
  let cos1 = Math.cos(w), cos2 = Math.cos(2 * w), sin1 = Math.sin(w), sin2 = Math.sin(2 * w);
  let nr = c.b0 + c.b1 * cos1 + c.b2 * cos2, ni = -(c.b1 * sin1 + c.b2 * sin2);
  let dr = 1 + c.a1 * cos1 + c.a2 * cos2, di = -(c.a1 * sin1 + c.a2 * sin2);
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}
function cascadeMagnitude(sos, f, fs = 44100) {
  let mag = 1;
  for (let c of sos) mag *= magnitude(c, f, fs);
  return mag;
}

// node_modules/@audio/weighting-k/k-weighting.js
function kWeighting(data, params = {}) {
  return filter(data, design(params));
}
function design(params) {
  let fs = params.fs || 48e3;
  if (!params._sos || params._fs !== fs) {
    params._fs = fs;
    params._sos = kWeighting.coefs(fs);
    params.coefs = params._sos;
  }
  return params;
}
kWeighting.ms = function ms(channels, params = {}, out = new Float64Array(channels.length)) {
  let [c, d] = design(params)._sos, st = params.states ??= [], n = channels.length, k = 0;
  for (; k + 1 < n; k += 2) msPair(channels[k], channels[k + 1], c, d, st[k] ??= new Float64Array(4), st[k + 1] ??= new Float64Array(4), out, k);
  if (k < n) msOne(channels[k], c, d, st[k] ??= new Float64Array(4), out, k);
  return out;
};
function msOne(x, c, d, s, out, k) {
  let b0 = c.b0, b1 = c.b1, b2 = c.b2, a1 = c.a1, a2 = c.a2, e0 = d.b0, e1 = d.b1, e2 = d.b2, f1 = d.a1, f2 = d.a2;
  let z1 = s[0], z2 = s[1], w1 = s[2], w2 = s[3], q = 0;
  for (let i = 0, l = x.length; i < l; i++) {
    let v = x[i];
    let y = b0 * v + z1;
    z1 = b1 * v - a1 * y + z2;
    z2 = b2 * v - a2 * y;
    let u = e0 * y + w1;
    w1 = e1 * y - f1 * u + w2;
    w2 = e2 * y - f2 * u;
    q += u * u;
  }
  s[0] = z1;
  s[1] = z2;
  s[2] = w1;
  s[3] = w2;
  out[k] = q / x.length;
}
function msPair(x, x2, c, d, s, t, out, k) {
  let b0 = c.b0, b1 = c.b1, b2 = c.b2, a1 = c.a1, a2 = c.a2, e0 = d.b0, e1 = d.b1, e2 = d.b2, f1 = d.a1, f2 = d.a2;
  let z1 = s[0], z2 = s[1], w1 = s[2], w2 = s[3], q = 0;
  let r1 = t[0], r2 = t[1], p1 = t[2], p2 = t[3], q2 = 0;
  for (let i = 0, l = x.length; i < l; i++) {
    let v = x[i], v2 = x2[i];
    let y = b0 * v + z1, y2 = b0 * v2 + r1;
    z1 = b1 * v - a1 * y + z2;
    r1 = b1 * v2 - a1 * y2 + r2;
    z2 = b2 * v - a2 * y;
    r2 = b2 * v2 - a2 * y2;
    let u = e0 * y + w1, u2 = e0 * y2 + p1;
    w1 = e1 * y - f1 * u + w2;
    p1 = e1 * y2 - f1 * u2 + p2;
    w2 = e2 * y - f2 * u;
    p2 = e2 * y2 - f2 * u2;
    q += u * u;
    q2 += u2 * u2;
  }
  s[0] = z1;
  s[1] = z2;
  s[2] = w1;
  s[3] = w2;
  t[0] = r1;
  t[1] = r2;
  t[2] = p1;
  t[3] = p2;
  out[k] = q / x.length;
  out[k + 1] = q2 / x2.length;
}
kWeighting.coefs = function coefs(fs = 48e3) {
  let G = 3.999843853973347, Qs = 0.7071752369554196, fc = 1681.974450955533;
  let K = Math.tan(Math.PI * fc / fs);
  let Vh = Math.pow(10, G / 20);
  let Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Qs + K * K;
  let shelf = {
    b0: (Vh + Vb * K / Qs + K * K) / a0,
    b1: 2 * (K * K - Vh) / a0,
    b2: (Vh - Vb * K / Qs + K * K) / a0,
    a1: 2 * (K * K - 1) / a0,
    a2: (1 - K / Qs + K * K) / a0
  };
  let Qh = 0.5003270373238773, fh = 38.13547087602444;
  let Kh = Math.tan(Math.PI * fh / fs);
  let d0 = 1 + Kh / Qh + Kh * Kh;
  let rlb = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: 2 * (Kh * Kh - 1) / d0,
    a2: (1 - Kh / Qh + Kh * Kh) / d0
  };
  return [shelf, rlb];
};
var respFs = NaN;
var respSos = null;
kWeighting.response = function response(f, fs = 48e3) {
  if (fs !== respFs) {
    respSos = kWeighting.coefs(fs);
    respFs = fs;
  }
  return cascadeMagnitude(respSos, f, fs);
};

// node_modules/@audio/loudness-lufs/lufs.js
var OFFSET = -0.691;
var ABS_GATE = -70;
var REL_GATE = -10;
var GATE_WINDOW = 0.4;
var GATE_HOP = 0.1;
var LAYOUTS = Object.freeze({
  1: Object.freeze([1]),
  // mono
  2: Object.freeze([1, 1]),
  // L R
  4: Object.freeze([1, 1, 1.41, 1.41]),
  // L R Ls Rs
  5: Object.freeze([1, 1, 1, 1.41, 1.41]),
  // L R C Ls Rs
  6: Object.freeze([1, 1, 1, 0, 1.41, 1.41]),
  // L R C LFE Ls Rs
  8: Object.freeze([1, 1, 1, 0, 1, 1, 1.41, 1.41])
  // L R C LFE Lb Rb Ls Rs
});
function lufs(channels, { fs = 48e3, weights } = {}) {
  if (channels[0]?.length === void 0) channels = [channels];
  let G = weights || LAYOUTS[channels.length] || channels.map(() => 1);
  let hop = Math.round(GATE_HOP * fs);
  let per = Math.round(GATE_WINDOW / GATE_HOP);
  let win = hop * per;
  let n = channels[0].length;
  if (n < win) return null;
  let hops = Math.floor(n / hop);
  let blocks = new Float64Array(hops - per + 1);
  let power = new Float64Array(hops);
  let [shelf, rlb] = kWeighting.coefs(fs);
  for (let c = 0; c < channels.length; c++) {
    if (!G[c]) continue;
    let ch = channels[c], s1 = state(), s2 = state();
    for (let h = 0, i = 0; h < hops; h++) {
      let z = 0;
      for (let e = i + hop; i < e; i++) {
        let y = step(rlb, s2, step(shelf, s1, ch[i]));
        z += y * y;
      }
      power[h] = z;
    }
    for (let b = 0; b < blocks.length; b++) {
      let z = 0;
      for (let p = 0; p < per; p++) z += power[b + p];
      blocks[b] += G[c] * z / win;
    }
  }
  let absT = 10 ** ((ABS_GATE - OFFSET) / 10);
  let sum = 0, count = 0;
  for (let p of blocks) if (p > absT) {
    sum += p;
    count++;
  }
  if (!count) return null;
  let relT = sum / count * 10 ** (REL_GATE / 10);
  sum = 0;
  count = 0;
  for (let p of blocks) if (p > absT && p > relT) {
    sum += p;
    count++;
  }
  if (!count) return null;
  return OFFSET + 10 * Math.log10(sum / count);
}

// node_modules/@audio/loudness-truepeak/truepeak.js
var HALF = 48;
var TAPS = 2 * HALF;
var NEAR = 6;
var BETA = 8;
var BLK = 8;
var NB = TAPS / BLK + 1;
var RISE = 9 / 8 * (1 + 2 ** -20);
var SLACK = 2 ** -36;
var sinc = (x) => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
var i0 = (x) => {
  let s = 1, t = 1;
  for (let k = 1; k < 50; k++) s += t *= (x / 2 / k) ** 2;
  return s;
};
var kernel = (x) => Math.abs(x) >= HALF ? 0 : sinc(x) * i0(BETA * Math.sqrt(1 - (x / HALF) ** 2)) / i0(BETA);
var kernels = /* @__PURE__ */ new Map();
function phases(n) {
  if (kernels.has(n)) return kernels.get(n);
  let list = [], g = n >> 1, bend = new Float64Array(NB), far = new Float64Array(BLK * NB);
  let wide = [new Float64Array(g * HALF), new Float64Array(g * HALF)], near = [new Float64Array(g * (NEAR + 1)), new Float64Array(g * (NEAR + 1))];
  const fold = ([even, odd], h, p, w) => {
    for (let k = 0; k < h; k++) {
      let a = w[HALF - 1 - k], b = w[HALF + k];
      even[p * h + k] = (a + b) / 2;
      odd[p * h + k] = (a - b) / 2;
    }
  };
  for (let p = 1; p < n; p++) {
    let w = new Float64Array(TAPS), sum = 0;
    for (let j = 0; j < TAPS; j++) sum += w[j] = kernel(j + 1 - HALF - p / n);
    for (let j = 0; j < TAPS; j++) w[j] /= sum;
    list.push(w);
    let e = new Float64Array(TAPS), v = new Float64Array(TAPS), B = 0;
    for (let j = 0; j < TAPS; j++) B += w[j] * (j + 1 - HALF);
    for (let j = 0; j < TAPS; j++) for (let i = 0; i < TAPS; i++) if (j < HALF ? i < j : i > j) e[j] += w[i] * Math.abs(i - j);
    v[HALF - 1] = 1 - B;
    v[HALF] = B;
    for (let j = HALF - NEAR; j < HALF + NEAR; j++) {
      v[j - 1] += e[j];
      v[j] -= 2 * e[j];
      v[j + 1] += e[j];
    }
    for (let r = 0; r < BLK; r++) {
      let b = new Float64Array(NB), f = new Float64Array(NB);
      for (let j = 0; j < TAPS; j++) {
        let k = r + 1 + j >> 3, a = Math.abs(e[j]);
        b[k] += a;
        if (j < HALF - NEAR || j >= HALF + NEAR) f[k] += a;
      }
      for (let k = 0; k < NB; k++) {
        bend[k] = Math.max(bend[k], b[k]);
        far[r * NB + k] = Math.max(far[r * NB + k], f[k]);
      }
    }
    if (p <= g) {
      fold(wide, HALF, p - 1, w);
      fold(near, NEAR + 1, p - 1, v);
    }
  }
  let set = { list, bend, far, wide, near };
  kernels.set(n, set);
  return set;
}
var vertex = (l, m, r) => {
  let c = 2 * m - l - r;
  return m >= l && m >= r && c > 0 ? m + (l - r) * (l - r) / (8 * c) : m;
};
function most(l, m, r, d) {
  if (m + d < l - d || m + d < r - d) return m + d;
  let s = (l < r ? r - l : l - r) + 2 * d, t = 2 * m - l - r - 4 * d;
  return m + d + (t > s ? s * s / t : s) / 8;
}
function read(x, w, base) {
  let lo = base + 1 - HALF, len = x.length;
  if (lo >= 0 && lo + TAPS <= len) {
    let a = 0, b = 0, c = 0, d = 0;
    for (let j = 0; j < TAPS; j += 4) {
      a += x[lo + j] * w[j];
      b += x[lo + j + 1] * w[j + 1];
      c += x[lo + j + 2] * w[j + 2];
      d += x[lo + j + 3] * w[j + 3];
    }
    return a + b + c + d;
  }
  let v = 0;
  for (let j = Math.max(0, -lo), e = Math.min(TAPS, len - lo); j < e; j++) v += x[lo + j] * w[j];
  return v;
}
function reach(x, list, base, q, peak) {
  let n = list.length + 1;
  q[0] = Math.abs(x[base]);
  q[n] = base + 1 < x.length ? Math.abs(x[base + 1]) : 0;
  for (let p = 1; p < n; p++) q[p] = Math.abs(read(x, list[p - 1], base));
  for (let p = 1; p < n; p++) {
    let v = vertex(q[p - 1], q[p], q[p + 1]);
    if (v > peak) peak = v;
  }
  if (base > 0 && 9 / 8 * q[0] > peak && q[0] >= q[1]) {
    let v = vertex(Math.abs(read(x, list[n - 2], base - 1)), q[0], q[1]);
    if (v > peak) peak = v;
  }
  return peak;
}
function block(x, P, mx, m2) {
  let len = x.length, i = (P - 6) * BLK, z = i + BLK, a = 0, e = 0;
  if (i > 0 && z < len) for (; i < z; i++) {
    a = Math.max(a, Math.abs(x[i]));
    e = Math.max(e, Math.abs(x[i - 1] - 2 * x[i] + x[i + 1]));
  }
  else for (i = Math.max(i, -1), z = Math.min(z, len + 1); i < z; i++) {
    let l = i > 0 && i <= len ? x[i - 1] : 0, c = i >= 0 && i < len ? x[i] : 0, r = i + 1 < len ? x[i + 1] : 0;
    a = Math.max(a, Math.abs(c));
    e = Math.max(e, Math.abs(l - 2 * c + r));
  }
  mx[P & 15] = a;
  m2[P & 15] = e;
}
var passes = (q, n, d, peak) => {
  for (let p = 1; p < n; p++) if (most(q[p - 1], q[p], q[p + 1], d) > peak) return true;
  return false;
};
function truepeak(channels, { fs = 48e3, oversample = 4 } = {}) {
  if (channels[0]?.length === void 0) channels = [channels];
  let n = Math.ceil(oversample), peak = 0, loud = channels[0], at = 0;
  for (let x of channels) for (let i = 0; i < x.length; i++) {
    let a = Math.abs(x[i]);
    if (a > peak) {
      peak = a;
      loud = x;
      at = i;
    }
  }
  if (n < 2) return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  let { list, bend, far, wide: [we, wo], near: [ne, no] } = phases(n), g = n >> 1, last = list[n - 2];
  let q = new Float64Array(n + 1), s = new Float64Array(HALF), d = new Float64Array(HALF), mx = new Float64Array(16), m2 = new Float64Array(16);
  if (peak > 0) for (let base = Math.max(0, at - 1); base <= at; base++) peak = reach(loud, list, base, q, peak);
  for (let x of channels) {
    let len = x.length, nb = Math.ceil(len / BLK);
    for (let P = 0; P < NB - 1; P++) block(x, P, mx, m2);
    let b1 = -1, l1 = 0, d1 = 0, b2 = -1, l2 = 0;
    for (let J = 0; J < nb; J++) {
      block(x, J + NB - 1, mx, m2);
      let bent = 0;
      for (let k = 0; k < NB; k++) bent += bend[k] * m2[J + k & 15];
      if (RISE * (Math.max(mx[J + 6 & 15], mx[J + 7 & 15]) + bent) <= peak) continue;
      for (let r = 0, base = J * BLK; r < BLK && base < len; r++, base++) {
        let a = Math.abs(x[base]), b = base + 1 < len ? Math.abs(x[base + 1]) : 0, rim = base > 0 && RISE * a > peak;
        if (RISE * (Math.max(a, b) + bent) <= peak) continue;
        if (base >= HALF - 1 && base + HALF < len) {
          let dd = peak * SLACK + far[r * NB] * m2[J & 15], de = 0;
          for (let k = 1, i = r * NB + 1; k < NB; k += 2, i += 2) {
            dd += far[i] * m2[J + k & 15];
            de += far[i + 1] * m2[J + k + 1 & 15];
          }
          dd += de;
          for (let k = 0; k <= NEAR; k++) {
            let u = x[base - k], v = x[base + 1 + k];
            s[k] = u + v;
            d[k] = u - v;
          }
          q[0] = a;
          q[n] = b;
          let top = Math.max(a, b);
          for (let p = 0, h = NEAR + 1; p < g; p++) {
            let e = 0, o = 0;
            for (let k = 0; k < h; k++) {
              e += ne[p * h + k] * s[k];
              o += no[p * h + k] * d[k];
            }
            let u = q[p + 1] = Math.abs(e + o), v = q[n - 1 - p] = Math.abs(e - o);
            top = Math.max(top, u + dd, v + dd);
          }
          let pass = RISE * top > peak && (passes(q, n, dd, peak) || rim && (b1 !== base - 1 || most(l1, a, q[1], Math.max(d1, dd)) > peak));
          b1 = base;
          l1 = q[n - 1];
          d1 = dd;
          if (!pass) continue;
          for (let k = NEAR + 1; k < HALF; k++) {
            let u = x[base - k], v = x[base + 1 + k];
            s[k] = u + v;
            d[k] = u - v;
          }
          for (let p = 0; p < g; p++) {
            let e = 0, f = 0, o = 0, h = 0;
            if (2 * p + 2 === n) for (let k = 0, i = p * HALF; k < HALF; k += 2, i += 2) {
              e += we[i] * s[k];
              f += we[i + 1] * s[k + 1];
            }
            else for (let k = 0, i = p * HALF; k < HALF; k += 2, i += 2) {
              e += we[i] * s[k];
              f += we[i + 1] * s[k + 1];
              o += wo[i] * d[k];
              h += wo[i + 1] * d[k + 1];
            }
            e += f;
            o += h;
            q[p + 1] = Math.abs(e + o);
            q[n - 1 - p] = Math.abs(e - o);
          }
          dd = peak * SLACK;
          pass = passes(q, n, dd, peak) || rim && most(b2 === base - 1 ? l2 : Math.abs(read(x, last, base - 1)), a, q[1], dd) > peak;
          b2 = base;
          l2 = q[n - 1];
          if (!pass) continue;
        }
        peak = reach(x, list, base, q, peak);
      }
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

// node_modules/@audio/loudness-lra/lra.js
var OFFSET2 = -0.691;
var ABS_GATE2 = -70;
var REL_GATE2 = -20;
var ST_WINDOW = 3;
var ST_HOP = 0.1;
var LAYOUTS2 = Object.freeze({
  1: Object.freeze([1]),
  // mono
  2: Object.freeze([1, 1]),
  // L R
  4: Object.freeze([1, 1, 1.41, 1.41]),
  // L R Ls Rs
  5: Object.freeze([1, 1, 1, 1.41, 1.41]),
  // L R C Ls Rs
  6: Object.freeze([1, 1, 1, 0, 1.41, 1.41]),
  // L R C LFE Ls Rs
  8: Object.freeze([1, 1, 1, 0, 1, 1, 1.41, 1.41])
  // L R C LFE Lb Rb Ls Rs
});
function lra(channels, { fs = 48e3, weights } = {}) {
  if (channels[0]?.length === void 0) channels = [channels];
  let G = weights || LAYOUTS2[channels.length] || channels.map(() => 1);
  let hop = Math.round(ST_HOP * fs);
  let per = Math.round(ST_WINDOW / ST_HOP);
  let win = hop * per;
  let n = channels[0].length;
  if (n < win) return null;
  let hops = Math.floor(n / hop);
  let st = new Float64Array(hops - per + 1);
  let power = new Float64Array(hops);
  let [shelf, rlb] = kWeighting.coefs(fs);
  for (let c = 0; c < channels.length; c++) {
    if (!G[c]) continue;
    let ch = channels[c], s1 = state(), s2 = state();
    for (let h = 0, i = 0; h < hops; h++) {
      let z = 0;
      for (let e = i + hop; i < e; i++) {
        let y = step(rlb, s2, step(shelf, s1, ch[i]));
        z += y * y;
      }
      power[h] = z;
    }
    for (let b = 0; b < st.length; b++) {
      let z = 0;
      for (let p = 0; p < per; p++) z += power[b + p];
      st[b] += G[c] * z / win;
    }
  }
  let absT = 10 ** ((ABS_GATE2 - OFFSET2) / 10);
  let gated = [...st].filter((p) => p >= absT);
  if (!gated.length) return null;
  let mean = gated.reduce((a, b) => a + b, 0) / gated.length;
  let final = gated.filter((p) => p >= mean * 10 ** (REL_GATE2 / 10)).sort((a, b) => a - b);
  if (final.length < 2) return 0;
  let q = (arr, p) => arr[Math.min(arr.length - 1, Math.round(p * (arr.length - 1)))];
  let lo = q(final, 0.1), hi = q(final, 0.95);
  return 10 * Math.log10(hi / lo);
}

// node_modules/@audio/loudness-replaygain/replaygain.js
var REFERENCE = -18;
function replaygain(channels, opts = {}) {
  let measured = lufs(channels, opts);
  if (measured === null) return null;
  if (channels[0]?.length === void 0) channels = [channels];
  let peak = 0;
  for (let ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      let m = ch[i] < 0 ? -ch[i] : ch[i];
      if (m > peak) peak = m;
    }
  }
  return { gain: REFERENCE - measured, lufs: measured, peak };
}
export {
  lra,
  lufs,
  replaygain,
  truepeak
};
