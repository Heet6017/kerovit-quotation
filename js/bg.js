// Living background: a dot grid that bends away from the pointer like a lens, lights up and
// threads itself into a mesh around it, sends a shockwave on click/tap and breathes slowly when idle.
// Purely decorative: a fixed canvas behind the page, never catches clicks.
const cv = document.createElement("canvas");
cv.className = "bg-canvas";
cv.setAttribute("aria-hidden", "true");
document.body.prepend(cv);
const ctx = cv.getContext("2d");
const root = document.documentElement;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

const GAP = innerWidth < 720 ? 30 : 26; // grid spacing (a little wider on phones)
const R = 210;           // pointer influence radius
const PUSH = 34;         // how far dots are pushed at the centre
let W = 0, H = 0, dpr = 1, cols = 0, rows = 0;
let px, py, vx, vy, ox, oy, heat; // rest positions, velocities, offsets, glow (typed arrays)

const mouse = { x: -9999, y: -9999, sx: -9999, sy: -9999, on: 0, target: 0 };
const waves = []; // click shockwaves {x, y, t0}

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cols = Math.ceil(W / GAP) + 1; rows = Math.ceil(H / GAP) + 1;
  const n = cols * rows;
  px = new Float32Array(n); py = new Float32Array(n);
  vx = new Float32Array(n); vy = new Float32Array(n);
  ox = new Float32Array(n); oy = new Float32Array(n); heat = new Float32Array(n);
  const offX = (W - (cols - 1) * GAP) / 2, offY = (H - (rows - 1) * GAP) / 2;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    px[i] = offX + c * GAP; py[i] = offY + r * GAP;
  }
  if (reduced.matches) drawStatic();
}

const palette = () => root.getAttribute("data-theme") === "dark"
  ? { dot: [141, 182, 226], hot: [185, 211, 239], base: .15, glow: "rgba(61,116,168,.26)", line: .45 }
  : { dot: [31, 78, 120], hot: [61, 116, 168], base: .16, glow: "rgba(31,78,120,.13)", line: .38 };

function drawStatic() {
  const p = palette();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = `rgba(${p.dot},${p.base})`;
  for (let i = 0; i < px.length; i++) ctx.fillRect(px[i] - .75, py[i] - .75, 1.5, 1.5);
}

addEventListener("pointermove", (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.target = 1;
  if (mouse.sx < -1000) { mouse.sx = mouse.x; mouse.sy = mouse.y; }
}, { passive: true });
addEventListener("pointerdown", (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.target = 1;
  waves.push({ x: e.clientX, y: e.clientY, t0: performance.now() });
  if (waves.length > 4) waves.shift();
}, { passive: true });
document.addEventListener("pointerleave", () => { mouse.target = 0; });
addEventListener("blur", () => { mouse.target = 0; });
// touch: let the effect fade after the finger lifts
addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") mouse.target = 0; }, { passive: true });

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || reduced.matches) { last = now; return; }
  const dt = Math.min(2.5, (now - last) / 16.67); last = now;
  const p = palette();

  // pointer follows with a little lag so the lens feels weighty
  mouse.sx += (mouse.x - mouse.sx) * Math.min(1, .18 * dt);
  mouse.sy += (mouse.y - mouse.sy) * Math.min(1, .18 * dt);
  mouse.on += (mouse.target - mouse.on) * Math.min(1, .06 * dt);
  const mx = mouse.sx, my = mouse.sy, on = mouse.on;

  ctx.clearRect(0, 0, W, H);

  // soft spotlight under the pointer
  if (on > .01) {
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, R * 2.4);
    g.addColorStop(0, p.glow); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = on; ctx.fillStyle = g;
    ctx.fillRect(mx - R * 2.4, my - R * 2.4, R * 4.8, R * 4.8);
    ctx.globalAlpha = 1;
  }

  // live shockwaves
  const t = now / 1000;
  for (let w = waves.length - 1; w >= 0; w--) {
    const age = (now - waves[w].t0) / 1000;
    if (age > 1.6) waves.splice(w, 1); else waves[w].r = age * 620, waves[w].k = (1 - age / 1.6);
  }

  // a slow wandering light keeps the page alive when the pointer is still
  const ax = W * (.5 + .42 * Math.sin(t * .13)), ay = H * (.5 + .38 * Math.sin(t * .21 + 1.3));
  const AR = 260, AR2 = AR * AR, amb = .45 * (1 - on * .6);
  const ag = ctx.createRadialGradient(ax, ay, 0, ax, ay, AR * 1.6);
  ag.addColorStop(0, p.glow); ag.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = amb; ctx.fillStyle = ag; ctx.fillRect(ax - AR * 1.6, ay - AR * 1.6, AR * 3.2, AR * 3.2); ctx.globalAlpha = 1;

  const n = px.length, R2 = R * R;
  const k = .075 * dt, damp = Math.pow(.84, dt);
  for (let i = 0; i < n; i++) {
    const bx = px[i], by = py[i];
    let fx = 0, fy = 0, h = 0;
    const dx = bx - mx, dy = by - my, d2 = dx * dx + dy * dy;
    if (on > .01 && d2 < R2) {
      const d = Math.sqrt(d2) || 1, f = 1 - d / R, s = f * f * on;
      fx += dx / d * s * PUSH * .35; fy += dy / d * s * PUSH * .35;
      h = Math.max(h, f * on);
    }
    const adx = bx - ax, ady = by - ay, ad2 = adx * adx + ady * ady;
    if (ad2 < AR2) h = Math.max(h, (1 - Math.sqrt(ad2) / AR) * amb);
    for (let w = 0; w < waves.length; w++) {
      const wv = waves[w], ddx = bx - wv.x, ddy = by - wv.y, d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      const band = 1 - Math.abs(d - wv.r) / 56;
      if (band > 0) { const s = band * wv.k; fx += ddx / d * s * 14; fy += ddy / d * s * 14; h = Math.max(h, s * .9); }
    }
    // spring back to the rest position
    vx[i] = (vx[i] + (fx - ox[i]) * k) * damp;
    vy[i] = (vy[i] + (fy - oy[i]) * k) * damp;
    ox[i] += vx[i] * dt; oy[i] += vy[i] * dt;
    heat[i] = h;
  }

  // mesh threads between neighbouring lit dots
  // (lines are grouped into a few brightness levels so each level is one stroke call)
  ctx.lineWidth = 1;
  const LV = 6, paths = Array.from({ length: LV }, () => new Path2D());
  const seg = (i, j, hh) => {
    const b = paths[Math.min(LV - 1, (hh * LV) | 0)];
    b.moveTo(px[i] + ox[i], py[i] + oy[i]); b.lineTo(px[j] + ox[j], py[j] + oy[j]);
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, h = heat[i];
    if (h < .06) continue;
    if (c + 1 < cols) { const hh = Math.min(h, heat[i + 1]); if (hh > .06) seg(i, i + 1, hh); }
    if (r + 1 < rows) { const hh = Math.min(h, heat[i + cols]); if (hh > .06) seg(i, i + cols, hh); }
  }
  for (let l = 0; l < LV; l++) {
    ctx.strokeStyle = `rgba(${p.hot},${(((l + .5) / LV) * p.line).toFixed(3)})`;
    ctx.stroke(paths[l]);
  }

  // dots: a slow diagonal breathing wave keeps the page alive, the pointer lights them up
  // (dots are grouped by brightness so each group is one fill call)
  const DL = 12, cold = Array.from({ length: DL }, () => new Path2D()), hot = Array.from({ length: DL }, () => new Path2D());
  const aMax = p.base * 1.9 + .75;
  for (let i = 0; i < n; i++) {
    const x = px[i] + ox[i], y = py[i] + oy[i], h = heat[i];
    const breathe = .5 + .5 * Math.sin((px[i] + py[i]) * .006 - t * 1.1);
    const a = p.base + breathe * p.base * .9 + h * .75;
    const s = 1.6 + breathe * .6 + h * 2.6;
    (h > .05 ? hot : cold)[Math.min(DL - 1, (a / aMax * DL) | 0)].rect(x - s / 2, y - s / 2, s, s);
  }
  for (let l = 0; l < DL; l++) {
    const a = Math.min(1, ((l + .5) / DL) * aMax).toFixed(3);
    ctx.fillStyle = `rgba(${p.dot},${a})`; ctx.fill(cold[l]);
    ctx.fillStyle = `rgba(${p.hot},${a})`; ctx.fill(hot[l]);
  }
}

addEventListener("resize", resize);
reduced.addEventListener?.("change", resize);
new MutationObserver(() => { if (reduced.matches) drawStatic(); }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
resize();
requestAnimationFrame(frame);
