// Interactive model of the mocap frame on the BOM page.
// Geometry, dimension definitions and BOM rows come from the JSON block that bom/make_bom.py embeds in the
// page; nothing here knows frame sizes.  The model is drawn with three.js (orthographic camera, solid parts
// with edge outlines); dimensions are drawn in an SVG overlay from 3D points projected every frame, so line
// weights, arrowheads and numbers keep a constant drawing-sheet size at any zoom.
//
// Build hook: bom.html?shot=<iso|front|side|top>[&s=<px per mm>] shows one view full-frame without controls and
// sets <html data-ready="1"> once it is drawn.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { LineSegments2 } from './vendor/lines/LineSegments2.js';
import { LineSegmentsGeometry } from './vendor/lines/LineSegmentsGeometry.js';
import { LineMaterial } from './vendor/lines/LineMaterial.js';

const model = JSON.parse(document.getElementById('bom-model').textContent);
const host = document.getElementById('bom-viewer');
const canvas = host.querySelector('canvas');
const svg = host.querySelector('svg');
const query = new URLSearchParams(location.search);
const shot = query.get('shot');
const shotScale = parseFloat(query.get('s')) || 0;
if (shot) {
  document.documentElement.classList.add('shot');
  document.body.replaceChildren(host);
  for (const el of host.querySelectorAll('.selinfo, .hint')) el.remove();
}

// drawing-sheet sizes in CSS px: extension-line gap and overrun, arrowhead length, first-step and step distance
// between parallel dimension lines, text height.  The print captures are scaled down, so they use tighter steps.
const SHEET = shot
  ? { gap: 2, over: 5, arrow: 8, first: 17, step: 17, text: 11.5, edge: 0.9, pad: 6 }
  : { gap: 3, over: 7, arrow: 11, first: 26, step: 23, text: 12.5, edge: 1.15, pad: 22 };
const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const UP = new THREE.Vector3(0, 0, 1);

// ---------------------------------------------------------------- scene
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: !!shot });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 4));
renderer.setClearColor(0xffffff, 1);
const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight(0xffffff, 0xaab2bf, 1.9);
hemi.position.set(0, 0, 1);
const key = new THREE.DirectionalLight(0xffffff, 1.5);   // follows the viewer, see frame()
scene.add(hemi, key);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 100, 80000);
const centre = V3(model.centre);
const controls = new OrbitControls(camera, host);
controls.enableDamping = !shot;
controls.dampingFactor = 0.14;
controls.screenSpacePanning = true;
controls.zoomToCursor = true;
controls.minZoom = 0.04; controls.maxZoom = 6;
controls.target.copy(centre);
// touch screens: the controls would claim every touch, so a swipe over the drawing could not scroll the page
const touch = matchMedia('(pointer: coarse)').matches;
if (touch && !shot) host.style.touchAction = 'pan-y';

const FACE = { alu: 0xdde1e7, steel: 0xaab2bd, dark: 0x3a404a, wood_top: 0xdcb681, wood_leg: 0xbd8f58, upper: 0x1f4fa8, lower: 0xc8641e, extra: 0xb5226f, lens: 0x1c2027 };
const EDGE = { alu: 0x2d343f, steel: 0x2d343f, dark: 0x14181e, wood_top: 0x80582a, wood_leg: 0x80582a, upper: 0x0f2c63, lower: 0x74370c, extra: 0x660f3c, lens: 0x000000 };
const SEL_FACE = 0xffc23d, SEL_EDGE = 0x8a4b00;
const faceMats = {}, edgeMats = {};
const faceMat = (k) => faceMats[k] || (faceMats[k] = new THREE.MeshLambertMaterial({ color: k === 'sel' ? SEL_FACE : FACE[k], polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
const edgeMat = (k) => edgeMats[k] || (edgeMats[k] = new LineMaterial({ color: k === 'sel' ? SEL_EDGE : EDGE[k], linewidth: k === 'sel' ? SHEET.edge + 0.5 : SHEET.edge }));

function solid(geo, mat, matrix) {
  // one mesh plus its outline; both keep the names of their normal materials so highlighting can swap them
  const mesh = new THREE.Mesh(geo, faceMat(mat));
  const lines = new LineSegments2(new LineSegmentsGeometry().setPositions(new THREE.EdgesGeometry(geo, 25).attributes.position.array), edgeMat(mat));
  mesh.userData.mat = lines.userData.mat = mat;
  const g = new THREE.Group();
  g.add(mesh, lines);
  if (matrix) { g.matrix.copy(matrix); g.matrixAutoUpdate = false; }
  return g;
}
function frameMatrix(origin, zAxis, xHint) {
  // rigid transform whose local z runs along zAxis and local x as close to xHint as possible
  const z = zAxis.clone().normalize();
  const y = new THREE.Vector3().crossVectors(z, xHint).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
}
function prismGeometry(pts, n, t) {
  const h = n.clone().multiplyScalar(t / 2);
  const lo = pts.map((p) => p.clone().sub(h)), hi = pts.map((p) => p.clone().add(h));
  const tri = [lo[0], lo[2], lo[1], hi[0], hi[1], hi[2]];
  for (let i = 0; i < 3; i++) { const j = (i + 1) % 3; tri.push(lo[i], lo[j], hi[j], lo[i], hi[j], hi[i]); }
  const g = new THREE.BufferGeometry().setFromPoints(tri);
  g.computeVertexNormals();
  return g;
}
function buildPart(p) {
  if (p.kind === 'bar') {
    const a = V3(p.a), b = V3(p.b), d = b.clone().sub(a);
    return solid(new THREE.BoxGeometry(30, 30, d.length()), p.mat, frameMatrix(a.clone().add(b).multiplyScalar(0.5), d, V3(p.n)));
  }
  if (p.kind === 'box') return solid(new THREE.BoxGeometry(...p.size), p.mat, new THREE.Matrix4().setPosition(V3(p.c)));
  if (p.kind === 'foot') {
    const c = V3(p.c); c.z += p.h / 2;
    return solid(new THREE.CylinderGeometry(p.r * 0.72, p.r, p.h, 32).rotateX(Math.PI / 2), p.mat, new THREE.Matrix4().setPosition(c));
  }
  if (p.kind === 'prism') return solid(prismGeometry(p.pts.map(V3), V3(p.n), p.t), p.mat);
  if (p.kind === 'camera') {
    const g = new THREE.Group(), aim = V3(p.aim), pos = V3(p.pos), mount = V3(p.mount);
    const [w, h, d] = p.body, [r, len] = p.lens;
    const right = new THREE.Vector3().crossVectors(aim, UP).normalize();
    g.add(solid(new THREE.BoxGeometry(w, h, d), p.mat, frameMatrix(pos, aim, right)));
    g.add(solid(new THREE.CylinderGeometry(r, r, len, 24).rotateX(Math.PI / 2), 'lens', frameMatrix(pos.clone().addScaledVector(aim, d / 2 + len / 2), aim, right)));
    const stem = pos.clone().sub(mount);
    g.add(solid(new THREE.CylinderGeometry(5, 5, stem.length(), 10).rotateX(Math.PI / 2), 'dark', frameMatrix(mount.clone().add(pos).multiplyScalar(0.5), stem, right)));
    return g;
  }
  throw new Error('unknown part kind ' + p.kind);
}

const layers = { cameras: new THREE.Group(), table: new THREE.Group(), frame: new THREE.Group() };
const parts = [];      // { data, group, meshes, lines, layer }
const pickable = [];
for (const data of model.parts) {
  const group = buildPart(data);
  const layer = data.kind === 'camera' ? 'cameras' : data.bom ? 'frame' : 'table';
  const part = { data, group, layer, meshes: [], lines: [] };
  group.traverse((o) => {
    if (o.isLineSegments2) part.lines.push(o);
    else if (o.isMesh) { part.meshes.push(o); o.userData.part = part; pickable.push(o); }
  });
  layers[layer].add(group);
  parts.push(part);
}
scene.add(layers.frame, layers.table, layers.cameras);
// floor outline: reads as the ground line in the elevation views
{
  const [lo, hi] = model.bbox, m = 150, z = -0.5;
  const c = [[lo[0] - m, lo[1] - m], [hi[0] + m, lo[1] - m], [hi[0] + m, hi[1] + m], [lo[0] - m, hi[1] + m]];
  const pos = [];
  for (let i = 0; i < 4; i++) pos.push(c[i][0], c[i][1], z, c[(i + 1) % 4][0], c[(i + 1) % 4][1], z);
  edgeMats.floor = new LineMaterial({ color: 0xb4bbc6, linewidth: SHEET.edge });
  var floor = new LineSegments2(new LineSegmentsGeometry().setPositions(pos), edgeMats.floor);
  scene.add(floor);
}

// ---------------------------------------------------------------- state
const state = { view: 'iso', layers: { dims: true, cameras: true, table: true }, sel: null, userMoved: false };
let W = 1, H = 1, dirty = true, snapQuat = null;
const viewButtons = [...document.querySelectorAll('[data-view]')];
const layerInputs = [...document.querySelectorAll('[data-layer]')];
const rows = new Map([...document.querySelectorAll('tr[data-bom]')].map((tr) => [tr.dataset.bom, tr]));
const selInfo = host.querySelector('.selinfo');

// ---------------------------------------------------------------- projection helpers
const _v = new THREE.Vector3();
const project = (p) => { _v.copy(p).project(camera); return [(_v.x + 1) / 2 * W, (1 - _v.y) / 2 * H]; };
const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(s, size, weight = 400) {
  measureCtx.font = `${weight} ${size}px "Noto Sans CJK SC", system-ui, sans-serif`;
  return measureCtx.measureText(s).width;
}
const f1 = (v) => v.toFixed(1);

// ---------------------------------------------------------------- dimensions (SVG overlay)
// Mechanical-drawing conventions: thin extension lines that start a small gap off the outline and run a little
// past the dimension line; a thin dimension line parallel to the measured feature with slender filled arrowheads;
// the number centred just above the line and parallel to it, vertical ones reading from the right of the sheet;
// parallel dimension lines stacked with the shortest nearest the model.
const dimBoxes = [];
function drawOverlay() {
  const out = [];
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (x, y) => { box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); };
  const [lo, hi] = model.bbox;
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) grow(...project(_v.set(x, y, z).clone()));
  const modelBox = { ...box };
  const line = (a, b) => { out.push(`<line class="dl" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`); grow(...a); grow(...b); };
  const arrow = (tip, dir) => {
    // slender filled arrowhead, length three times its width, pointing along dir with the tip on the extension line
    const L = SHEET.arrow, w = L / 6, bx = tip[0] - dir[0] * L, by = tip[1] - dir[1] * L;
    out.push(`<path class="da" d="M${f1(tip[0])} ${f1(tip[1])}L${f1(bx - dir[1] * w)} ${f1(by + dir[0] * w)}L${f1(bx + dir[1] * w)} ${f1(by - dir[0] * w)}Z"/>`);
  };

  if (state.layers.dims) {
    const set = model.dims[state.view === 'free' ? 'iso' : state.view] || [];
    const shown = set.filter((d) => !d.needs || state.layers[d.needs]);
    const tierOf = new Map();
    for (const side of new Set(shown.map((d) => d.side))) {
      shown.filter((d) => d.side === side).sort((a, b) => a.order - b.order).forEach((d, i) => tierOf.set(d, i));
    }
    const o = project(centre);
    const pictorial = state.view === 'iso' || state.view === 'free';
    dimBoxes.length = 0;
    const groupSide = new Map();                         // dimensions of one group stay on the corner its first member took
    for (const d of shown) {
      let A = V3(d.a), B = V3(d.b), e = V3(d.e);
      // on-screen length of one model unit along e: the plane of this dimension must face the viewer
      const unitLen = (v) => { const p = project(centre.clone().add(v)); return Math.hypot(p[0] - o[0], p[1] - o[1]); };
      if (pictorial) {
        // overall dimensions may sit on any of the four mirrored sides of the frame: take the one that lands
        // furthest out on screen, so the lines stay clear of the model from every orbit angle
        let best = -1, chosen = null;
        const fixed = d.group ? groupSide.get(d.group) : null;
        for (const [sx, sy] of fixed ? [fixed] : [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const flip = (v) => new THREE.Vector3(v.x * sx, v.y * sy, v.z);
          const a = flip(V3(d.a)), b = flip(V3(d.b)), n = flip(V3(d.e));
          if (unitLen(n) < 0.35 * camera.zoom) continue;
          const m = project(a.clone().add(b).multiplyScalar(0.5).addScaledVector(n, 300));
          const score = Math.hypot(m[0] - o[0], m[1] - o[1]) * (sx + sy === 2 ? 1.15 : 1);
          if (score > best) { best = score; A = a; B = b; e = n; chosen = [sx, sy]; }
        }
        if (d.group && !fixed && chosen) groupSide.set(d.group, chosen);
      }
      const scale = unitLen(e);
      if (scale < 0.35 * camera.zoom) continue;
      const ae = A.dot(e), be = B.dot(e), base = d.base ?? Math.max(ae, be);
      const off = (SHEET.first + (d.tier ?? tierOf.get(d)) * SHEET.step) / scale;
      const A2 = A.clone().addScaledVector(e, base - ae + off), B2 = B.clone().addScaledVector(e, base - be + off);
      const value = Math.round(A2.distanceTo(B2));
      const pa = project(A), pb = project(B), qa = project(A2), qb = project(B2);
      let dx = qb[0] - qa[0], dy = qb[1] - qa[1];
      const len = Math.hypot(dx, dy);
      if (len < 4) continue;
      dx /= len; dy /= len;
      for (const [p, q] of [[pa, qa], [pb, qb]]) {
        let ex = q[0] - p[0], ey = q[1] - p[1];
        const el = Math.hypot(ex, ey);
        if (el < SHEET.gap + 1) continue;
        ex /= el; ey /= el;
        line([p[0] + ex * SHEET.gap, p[1] + ey * SHEET.gap], [q[0] + ex * SHEET.over, q[1] + ey * SHEET.over]);
      }
      const text = String(value) + (d.note || ''), tw = textWidth(text, SHEET.text);
      const inside = len >= tw + 2 * SHEET.arrow + 6;
      if (inside) {
        line(qa, qb);
        arrow(qa, [-dx, -dy]); arrow(qb, [dx, dy]);
      } else {
        // too short for arrowheads between the extension lines: they point inwards from outside
        const t = SHEET.arrow * 1.9;
        line([qa[0] - dx * t, qa[1] - dy * t], [qb[0] + dx * t, qb[1] + dy * t]);
        arrow(qa, [dx, dy]); arrow(qb, [-dx, -dy]);
      }
      // number parallel to the dimension line, upright; exactly vertical lines read bottom-to-top
      let ang = Math.atan2(dy, dx) * 180 / Math.PI;
      if (ang >= 90 - 1e-6) ang -= 180; else if (ang < -90 - 1e-6) ang += 180;
      const rad = ang * Math.PI / 180, nx = Math.sin(rad), ny = -Math.cos(rad);
      let mx = (qa[0] + qb[0]) / 2, my = (qa[1] + qb[1]) / 2;
      if (!inside && len < tw + 5) {
        // not even room for the number: put it beyond the second arrowhead, on the extended dimension line
        const along = len / 2 + SHEET.arrow * 1.9 + tw / 2 + 3, s = (dx * Math.cos(rad) + dy * Math.sin(rad)) >= 0 ? 1 : -1;
        mx += dx * along; my += dy * along;
        line(qb, [qb[0] + dx * (SHEET.arrow * 1.9 + tw + 6), qb[1] + dy * (SHEET.arrow * 1.9 + tw + 6)]);
        void s;
      }
      const lift = 3;
      out.push(`<text class="dt" font-size="${SHEET.text}" text-anchor="middle" transform="translate(${f1(mx + nx * lift)} ${f1(my + ny * lift)}) rotate(${ang.toFixed(2)})">${text}</text>`);
      const hw = tw / 2 + 2, up = lift + SHEET.text;
      {                                                  // screen box of this number, for the camera names to avoid
        const xs = [], ys = [];
        for (const s of [-1, 1]) for (const u of [0, up]) { xs.push(mx + Math.cos(rad) * hw * s + nx * u); ys.push(my + Math.sin(rad) * hw * s + ny * u); }
        dimBoxes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      }
      for (const s of [-1, 1]) { grow(mx + Math.cos(rad) * hw * s, my + Math.sin(rad) * hw * s); grow(mx + Math.cos(rad) * hw * s + nx * up, my + Math.sin(rad) * hw * s + ny * up); }
    }
  }

  // camera names in the pictorial views (in the flat views they stack on top of each other): just beyond the
  // lens, towards the open middle of the frame
  if (!shot && state.layers.dims && state.layers.cameras && (state.view === 'iso' || state.view === 'free')) {
    const size = SHEET.text - 1;
    for (const part of parts) {
      if (part.layer !== 'cameras') continue;
      const p = project(V3(part.data.pos)), t = project(V3(part.data.pos).addScaledVector(V3(part.data.aim), 100));
      let ux = t[0] - p[0], uy = t[1] - p[1];
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul; uy /= ul;
      const tw0 = textWidth(part.data.name, size, 600);
      let r = 12 + 75 * camera.zoom, x, y, anchor;
      for (const dir of [1, -1]) {                       // behind the camera instead, when the name would cover a dimension number
        x = p[0] + ux * r * dir; y = p[1] + uy * r * dir + size * 0.35;
        anchor = ux * dir > 0.3 ? 'start' : ux * dir < -0.3 ? 'end' : 'middle';
        const x0 = anchor === 'start' ? x : anchor === 'end' ? x - tw0 : x - tw0 / 2;
        if (!dimBoxes.some((b) => x0 - 2 < b[2] && b[0] < x0 + tw0 + 2 && y - size - 2 < b[3] && b[1] < y + 4)) break;
      }
      out.push(`<text class="cam" font-size="${size}" text-anchor="${anchor}" fill="#${FACE[part.data.mat].toString(16).padStart(6, '0')}" x="${f1(x)}" y="${f1(y)}">${part.data.name}</text>`);
      const tw = textWidth(part.data.name, size, 600);
      grow(anchor === 'start' ? x + tw : anchor === 'end' ? x - tw : x - tw / 2, y - size); grow(anchor === 'middle' ? x + tw / 2 : x, y + 2);
    }
  }
  svg.innerHTML = out.join('');
  return { box, modelBox };
}

// ---------------------------------------------------------------- camera and views
const VIEW_DIR = {
  iso: (() => { const az = 38 * Math.PI / 180, el = 23 * Math.PI / 180; return new THREE.Vector3(Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)); })(),
  front: new THREE.Vector3(0, -1, 0),
  side: new THREE.Vector3(-1, 0, 0),             // from the left end, as the left-side view of first-angle projection
  top: new THREE.Vector3(0, -1e-4, 1).normalize(),   // a hair off vertical so that +y stays up on screen
};
function resize() {
  const r = host.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
  renderer.setSize(W, H, false);
  camera.left = -W / 2; camera.right = W / 2; camera.top = H / 2; camera.bottom = -H / 2;   // zoom = px per mm
  camera.updateProjectionMatrix();
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  for (const m of Object.values(edgeMats)) m.resolution.set(W, H);
  dirty = true;
}
function fit() {
  // centre the model together with its annotations; unless the scale is fixed, zoom so that both fit.
  // Annotations keep their size on screen, so a few rounds converge.
  for (let i = 0; i < 4; i++) {
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    let { box, modelBox: mb } = drawOverlay();
    if (shot && shotScale) camera.zoom = shotScale;
    else {
      const mw = mb.x1 - mb.x0, mh = mb.y1 - mb.y0;
      const ex = (mb.x0 - box.x0) + (box.x1 - mb.x1), ey = (mb.y0 - box.y0) + (box.y1 - mb.y1);
      camera.zoom *= Math.min((W - 2 * SHEET.pad - ex) / mw, (H - 2 * SHEET.pad - ey) / mh);
    }
    camera.updateProjectionMatrix();
    ({ box } = drawOverlay());
    const sx = W / 2 - (box.x0 + box.x1) / 2, sy = H / 2 - (box.y0 + box.y1) / 2;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const move = right.multiplyScalar(-sx / camera.zoom).addScaledVector(up, sy / camera.zoom);
    camera.position.add(move); controls.target.add(move);
  }
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  dirty = true;
}
function setView(name) {
  state.view = name; state.userMoved = false;
  for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset.view === name));
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();                               // flush any leftover inertia
  controls.target.copy(centre);
  camera.position.copy(centre).addScaledVector(VIEW_DIR[name], 30000);
  camera.zoom = 0.2;
  controls.update();
  controls.enableDamping = damping;
  snapQuat = camera.quaternion.clone();
  fit();
}
function setLayer(name, on) {
  state.layers[name] = on;
  if (layers[name]) layers[name].visible = on;
  for (const i of layerInputs) if (i.dataset.layer === name) i.checked = on;
  if (!state.userMoved && state.view !== 'free') fit();
  dirty = true;
}

// ---------------------------------------------------------------- selection: model <-> BOM table
function select(bom, from, part) {
  state.sel = bom;
  let n = 0;
  for (const p of parts) {
    const on = bom !== null && p.data.bom === bom;
    if (on) n++;
    for (const m of p.meshes) m.material = faceMat(on ? 'sel' : m.userData.mat);
    for (const l of p.lines) l.material = edgeMat(on ? 'sel' : l.userData.mat);
  }
  edgeMat('sel').resolution.set(W, H);
  for (const [id, tr] of rows) tr.classList.toggle('sel', id === bom);
  if (selInfo) {
    selInfo.hidden = bom === null;
    if (bom !== null) {
      const r = model.rows[bom];
      selInfo.firstElementChild.textContent = `${bom} ${r.name} · ${r.spec} · ${r.qty} ${r.unit}` + (part && part.data.name ? `（${part.data.name}）` : '');
    }
  }
  // on a touch screen the page stays on the drawing: the row is below it, and the caption already names the part
  if (bom !== null && from === 'model' && rows.has(bom) && !touch) rows.get(bom).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (bom !== null && from === 'row') host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  dirty = true;
  return n;
}
const raycaster = new THREE.Raycaster();
function pickAt(clientX, clientY) {
  // the part under a viewport point, or null
  const r = host.getBoundingClientRect();
  camera.updateMatrixWorld();
  raycaster.setFromCamera(new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, 1 - (clientY - r.top) / r.height * 2), camera);
  const hit = raycaster.intersectObjects(pickable.filter((m) => layers[m.userData.part.layer].visible), false)[0];
  return hit ? hit.object.userData.part : null;
}
function clickAt(clientX, clientY) {
  const part = pickAt(clientX, clientY);
  select(part && part.data.bom ? part.data.bom : null, 'model', part);
  return part;
}

if (!shot) {
  let down = null;
  host.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
  host.addEventListener('pointerup', (ev) => {
    if (down && ev.button === 0 && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) < 5 && !ev.target.closest('.selinfo')) clickAt(ev.clientX, ev.clientY);
    down = null;
  });
  host.addEventListener('contextmenu', (ev) => ev.preventDefault());
  // A swipe that the browser turns into a page scroll first reaches the controls as a few moves and is then cancelled:
  // put the camera back where the touch began, so scrolling past the drawing never turns the model.
  let held = null;
  host.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'touch' && ev.isPrimary) held = { p: camera.position.clone(), t: controls.target.clone(), z: camera.zoom, moved: state.userMoved, view: state.view };
  }, true);
  host.addEventListener('pointerup', () => { held = null; });
  host.addEventListener('pointercancel', () => {
    if (!held) return;
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();                               // spend the leftover inertia before restoring
    camera.position.copy(held.p); controls.target.copy(held.t); camera.zoom = held.z;
    camera.updateProjectionMatrix();
    controls.update();
    controls.enableDamping = damping;
    state.userMoved = held.moved; state.view = held.view;
    held = null; down = null; dirty = true;
  });
  controls.addEventListener('start', () => { state.userMoved = true; });
  for (const b of viewButtons) b.addEventListener('click', () => setView(b.dataset.view));
  for (const i of layerInputs) i.addEventListener('change', () => setLayer(i.dataset.layer, i.checked));
  for (const [id, tr] of rows) {
    const go = () => select(state.sel === id ? null : id, 'row');
    tr.addEventListener('click', (ev) => { if (!ev.target.closest('a')) go(); });   // a shop link opens the shop, nothing else
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
  }
  selInfo.querySelector('button').addEventListener('click', () => select(null));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && state.sel !== null) select(null); });
  new ResizeObserver(() => { resize(); if (!state.userMoved) fit(); }).observe(host);
}

// ---------------------------------------------------------------- render loop
function frame() {
  requestAnimationFrame(frame);
  if (controls.update()) dirty = true;
  if (state.view !== 'free' && snapQuat && camera.quaternion.angleTo(snapQuat) > 2e-3) {
    // orbited away from a snapped view: the flat dimension sets no longer apply
    state.view = 'free';
    for (const b of viewButtons) b.setAttribute('aria-pressed', 'false');
    dirty = true;
  }
  if (!dirty) return;
  dirty = false;
  // light from over the viewer's right shoulder, so the faces towards the viewer are evenly lit in every view
  const m = camera.matrixWorld;
  key.position.setFromMatrixColumn(m, 2).addScaledVector(_v.setFromMatrixColumn(m, 0), 0.35).addScaledVector(_v.setFromMatrixColumn(m, 1), 0.5);
  floor.visible = Math.abs(_v.setFromMatrixColumn(m, 2).z) < 0.95;   // from above it would read as a border
  renderer.render(scene, camera);
  drawOverlay();
}
resize();
setView(VIEW_DIR[shot || query.get('view')] ? (shot || query.get('view')) : 'iso');
if (query.has('az')) {
  // free-orbit start angle for checks: azimuth from the front towards the right end, elevation, in degrees
  const az = parseFloat(query.get('az')) * Math.PI / 180, el = parseFloat(query.get('el') || '20') * Math.PI / 180;
  camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)), 30000);
  controls.update();
  state.view = 'free';
  fit();
  for (const b of viewButtons) b.setAttribute('aria-pressed', 'false');
}
frame();
requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '1'; }));

// handle for the scripted check (bom_selftest.js)
window.bomView = { THREE, model, parts, state, rows, project, pickAt, clickAt, select, setView, setLayer, host };
if (query.has('selftest')) import('./bom_selftest.js');
