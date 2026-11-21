// Hex field hero: a tilted field of dark frosted-glass hexagon prisms. Tiles near the cursor light up in pastel colours,
// rise a little and leave a fading trail; light from below glows through the gaps around lit tiles; bloom on top.
// three.js r187, vendored in /vendor/three (imports rewritten to relative paths).
import * as THREE from "./vendor/three/three.module.js";
import { EffectComposer } from "./vendor/three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "./vendor/three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./vendor/three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "./vendor/three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "./vendor/three/addons/environments/RoomEnvironment.js";

const PASTEL = ["#f2a48c", "#d98270", "#b8735f", "#8199f2", "#6a7fe8", "#e9d19c", "#f0b7a8", "#8c6a5f"].map((c) => new THREE.Color(c));
const R = 1, GAP = 0.17, HEIGHT = 1.3, HOT_N = 28;

// glyphs drawn into one atlas (5 cells): sparkle, burst, dots, window, wave
function glyphAtlas() {
  const S = 256, c = document.createElement("canvas"); c.width = S * 5; c.height = S;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineCap = "round";
  const cell = (i, fn) => { g.save(); g.translate(i * S + S / 2, S / 2); fn(); g.restore(); };
  cell(0, () => { g.beginPath(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; g.quadraticCurveTo(Math.cos(a + Math.PI / 4) * 14, Math.sin(a + Math.PI / 4) * 14, Math.cos(a + Math.PI / 2) * 74, Math.sin(a + Math.PI / 2) * 74); } g.closePath(); g.moveTo(74, 0); g.fill(); });
  cell(1, () => { g.lineWidth = 11; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6 + (k % 2) * 0.12; const r0 = 16, r1 = k % 3 === 0 ? 70 : 58; g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke(); } });
  cell(2, () => { const e = (x, y, rx, ry) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }; e(-6, -18, 46, 30); e(-28, 34, 26, 20); e(30, 30, 18, 15); });
  cell(3, () => { g.lineWidth = 12; const w = 120, h = 92; g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 16); g.stroke(); g.beginPath(); g.moveTo(-w / 2, -h / 2 + 28); g.lineTo(w / 2, -h / 2 + 28); g.stroke(); });
  cell(4, () => { g.lineWidth = 12; g.beginPath(); for (let x = -64; x <= 64; x += 2) { const y = Math.sin(x / 64 * Math.PI * 1.5) * 26; x === -64 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function hexShape(r, round) {
  // flat-top hexagon with rounded corners
  const s = new THREE.Shape(), pts = [];
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r)); }
  for (let k = 0; k < 6; k++) {
    const p = pts[k], prev = pts[(k + 5) % 6], next = pts[(k + 1) % 6];
    const a = p.clone().lerp(prev, round), b = p.clone().lerp(next, round);
    k === 0 ? s.moveTo(a.x, a.y) : s.lineTo(a.x, a.y);
    s.quadraticCurveTo(p.x, p.y, b.x, b.y);
  }
  s.closePath(); return s;
}

export function createHexField(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene(); scene.background = new THREE.Color("#0b0b0e");
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.22;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const CAM = new THREE.Vector3(0.6, 6.3, 8.2), LOOK = new THREE.Vector3(0.6, 0.4, -0.5);

  // ---------- tiles ----------
  const COLS = opts.cols || 40, ROWS = opts.rows || 34;
  const dx = (1.5 * R) + GAP * 0.866, dz = Math.sqrt(3) * R + GAP;
  const tiles = [];
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    const x = (c - (COLS - 1) / 2) * dx, z = (r - (ROWS - 1) / 2) * dz + (c % 2 ? dz / 2 : 0);
    tiles.push({ x, z, heat: 0, tint: PASTEL[(c * 7 + r * 3) % PASTEL.length].clone(), icon: (c * 3 + r * 5 + ((c * r) % 3)) % 5, seed: Math.random() });
  }
  const N = tiles.length;
  const geo = new THREE.ExtrudeGeometry(hexShape(R * 0.97, 0.07), { depth: HEIGHT, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 4, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);                                // extrude upward: base at y=0, top at y=HEIGHT
  const aHeat = new THREE.InstancedBufferAttribute(new Float32Array(N), 1); aHeat.setUsage(THREE.DynamicDrawUsage);
  const aTint = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); aTint.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aHeat", aHeat); geo.setAttribute("aTint", aTint);

  const mat = new THREE.MeshPhysicalMaterial({ color: "#0f1015", roughness: 0.34, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.28, sheen: 0.2, sheenColor: new THREE.Color("#3a3d52") });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aHeat; attribute vec3 aTint; varying float vHeat; varying vec3 vTint; varying float vY; varying float vTop;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHeat = aHeat; vTint = aTint; vY = position.y / " + HEIGHT.toFixed(3) + "; vTop = step(0.8, normal.y);");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vHeat; varying vec3 vTint; varying float vY; varying float vTop;")
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( mix( diffuse, vTint * 0.76, smoothstep(0.0, 0.85, vHeat) ), opacity );")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.2, vHeat);")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        float glowSide = mix(1.25, 0.55, clamp(vY, 0.0, 1.0));   // lit tiles glow brighter toward their base, like the reference
        totalEmissiveRadiance += vTint * vHeat * mix(glowSide * 0.46, 0.13, vTop);
        // frosted glass: a soft inner light rising from the base of a lit tile
        totalEmissiveRadiance += vec3(0.85, 0.82, 1.0) * vHeat * pow(1.0 - clamp(vY, 0.0, 1.0), 3.0) * 0.35 * (1.0 - vTop);`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  // ---------- glyph decals on the top faces ----------
  const atlas = glyphAtlas();
  const pg = new THREE.PlaneGeometry(0.92, 0.92); pg.rotateX(-Math.PI / 2);
  const gHeat = new THREE.InstancedBufferAttribute(new Float32Array(N), 1); gHeat.setUsage(THREE.DynamicDrawUsage);
  const gIcon = new THREE.InstancedBufferAttribute(new Float32Array(tiles.map((t) => t.icon)), 1);
  pg.setAttribute("gHeat", gHeat); pg.setAttribute("gIcon", gIcon);
  const gmat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { atlas: { value: atlas } },
    vertexShader: `attribute float gHeat; attribute float gIcon; varying vec2 vUv; varying float vH; varying float vI;
      void main(){ vUv = uv; vH = gHeat; vI = gIcon; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D atlas; varying vec2 vUv; varying float vH; varying float vI;
      void main(){ vec4 t = texture2D(atlas, vec2((vI + vUv.x) / 5.0, vUv.y));
        vec3 col = mix(vec3(0.075, 0.078, 0.09), vec3(1.55, 1.52, 1.5), smoothstep(0.05, 0.9, vH));
        gl_FragColor = vec4(col, t.a * mix(0.85, 1.0, vH)); }`,
  });
  const glyphs = new THREE.InstancedMesh(pg, gmat, N); glyphs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(glyphs);

  // ---------- glow floor: light leaking up through the gaps around lit tiles ----------
  const hotPos = new Float32Array(HOT_N * 3), hotCol = new Float32Array(HOT_N * 3);
  const floorMat = new THREE.ShaderMaterial({
    uniforms: { hp: { value: hotPos }, hc: { value: hotCol } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 hp[${HOT_N}]; uniform vec3 hc[${HOT_N}]; varying vec3 vW;
      void main(){ vec3 c = vec3(0.012, 0.012, 0.02);
        for (int i = 0; i < ${HOT_N}; i++) { float d = distance(vW.xz, hp[i].xz); c += hc[i] * hp[i].y * exp(-d * d * 0.7) * 2.6; }
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.02; scene.add(floor);

  // ---------- light ----------
  scene.add(new THREE.HemisphereLight("#8a90b8", "#08080c", 0.35));
  const key = new THREE.DirectionalLight("#ffffff", 1.25); key.position.set(-6, 14, 9); scene.add(key);
  const rim = new THREE.DirectionalLight("#9fb0ff", 0.55); rim.position.set(8, 6, -10); scene.add(rim);
  const cursorLight = new THREE.PointLight("#ffd9c7", 0, 6, 2); scene.add(cursorLight);

  // ---------- post ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.38, 0.45, 0.86); composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- interaction ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HEIGHT), hit = new THREE.Vector3();
  const pointer = { x: 0, z: 0, active: false, last: 0 };
  const toWorld = (cx, cy) => {
    const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); return ray.ray.intersectPlane(plane, hit) ? hit : null;
  };
  const onMove = (e) => { const p = toWorld(e.clientX, e.clientY); if (p) { pointer.x = p.x; pointer.z = p.z; pointer.active = true; pointer.last = performance.now(); } };
  const onLeave = () => (pointer.active = false);
  (opts.eventTarget || canvas).addEventListener("pointermove", onMove);
  (opts.eventTarget || canvas).addEventListener("pointerleave", onLeave);

  let W = 1, H = 1, scrollTilt = 0;
  const resize = () => {
    W = canvas.clientWidth; H = canvas.clientHeight;
    renderer.setSize(W, H, false); composer.setSize(W, H); bloom.resolution.set(W, H);
    camera.aspect = W / H;
    camera.fov = W / H < 0.9 ? 52 : 34;                    // phones: wider view
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize); ro.observe(canvas);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  let raf = 0, visible = true, last = performance.now(), t = 0;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(frame); }); io.observe(canvas);

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    // idle: a ghost cursor wanders so the field is alive before anyone touches it
    let px = pointer.x, pz = pointer.z, live = pointer.active && now - pointer.last < 2500;
    if (!live) { const k = W / H < 0.9 ? 0.45 : 1; px = (Math.sin(t * 0.33) * 4.4 + Math.sin(t * 0.71) * 1.4) * k; pz = Math.cos(t * 0.27) * 2 + Math.sin(t * 0.53) * 0.9 - (k < 1 ? 1.6 : 0.8); }
    // camera: a slow breath, plus tilt from the scroll
    camera.position.set(CAM.x + Math.sin(t * 0.15) * 0.25, CAM.y - scrollTilt * 3.5, CAM.z + Math.cos(t * 0.12) * 0.2 - scrollTilt * 2);
    camera.lookAt(LOOK.x, LOOK.y, LOOK.z + scrollTilt * 2);
    cursorLight.position.set(px, HEIGHT + 1.4, pz); cursorLight.intensity += ((live ? 1.6 : 1) - cursorLight.intensity) * 0.05;

    // heat: fast rise near the cursor, slow fade (the trail)
    const hot = [];
    for (let i = 0; i < N; i++) {
      const tl = tiles[i], d = Math.hypot(tl.x - px, tl.z - pz);
      const target = d < 1.05 ? 1 : d < 2.2 ? 0.55 * (1 - (d - 1.05) / 1.15) : 0;
      if (target > tl.heat) { if (tl.heat < 0.02) tl.tint.copy(PASTEL[Math.floor(Math.random() * PASTEL.length)]); tl.heat += (target - tl.heat) * Math.min(1, dt * 9); }
      else tl.heat = Math.max(0, tl.heat - dt * 0.55);
      const h = tl.heat, e = h * h * (3 - 2 * h);
      const rise = e * 0.38 + Math.sin(t * 1.3 + tl.seed * 9) * 0.006;
      pos.set(tl.x, rise, tl.z); m4.compose(pos, q, sc); mesh.setMatrixAt(i, m4);
      pos.set(tl.x, rise + HEIGHT + 0.075, tl.z); m4.compose(pos, q, sc); glyphs.setMatrixAt(i, m4);
      aHeat.array[i] = e; aTint.array[i * 3] = tl.tint.r; aTint.array[i * 3 + 1] = tl.tint.g; aTint.array[i * 3 + 2] = tl.tint.b; gHeat.array[i] = e;
      if (e > 0.04) hot.push(i);
    }
    hot.sort((a, b) => tiles[b].heat - tiles[a].heat);
    for (let k = 0; k < HOT_N; k++) {
      const i = hot[k];
      if (i === undefined) { hotPos[k * 3 + 1] = 0; continue; }
      const tl = tiles[i], e = aHeat.array[i];
      hotPos[k * 3] = tl.x; hotPos[k * 3 + 1] = e; hotPos[k * 3 + 2] = tl.z;
      // the gap light is a cooler, lavender version of the tile colour
      hotCol[k * 3] = (tl.tint.r * 0.5 + 0.42) * 1.6; hotCol[k * 3 + 1] = (tl.tint.g * 0.5 + 0.4) * 1.6; hotCol[k * 3 + 2] = (tl.tint.b * 0.4 + 0.75) * 1.8;
    }
    mesh.instanceMatrix.needsUpdate = true; glyphs.instanceMatrix.needsUpdate = true; aHeat.needsUpdate = true; aTint.needsUpdate = true; gHeat.needsUpdate = true;
    composer.render();
    if (visible) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    setScroll(p) { scrollTilt = p; },
    destroy() {
      cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
      (opts.eventTarget || canvas).removeEventListener("pointermove", onMove); (opts.eventTarget || canvas).removeEventListener("pointerleave", onLeave);
      composer.dispose?.(); renderer.dispose(); geo.dispose(); pg.dispose(); mat.dispose(); gmat.dispose(); atlas.dispose(); pmrem.dispose();
    },
  };
}
