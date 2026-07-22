// VILDMARK — time model, seasons, sky/sun/moon, weather particles, torch lights
import * as THREE from 'three';

export const CYCLE = 480;            // seconds per in-game day
export const DAYS_PER_SEASON = 3;
export const SEASON_NAMES = ['Vår', 'Sommar', 'Höst', 'Vinter'];
const DAY_FRAC = [0.62, 0.68, 0.52, 0.45]; // share of the cycle that is daylight

export function phaseOf(wt) {
  const day = Math.floor(wt / CYCLE);
  const tin = (wt % CYCLE) / CYCLE;
  const season = Math.floor(day / DAYS_PER_SEASON) % 4;
  const df = DAY_FRAC[season];
  return { day, tin, season, dayFrac: df, isNight: tin >= df };
}

export const SEASON_TINT = [
  { grass: [0.62, 0.88, 0.48], leaves: [0.62, 0.86, 0.5] },
  { grass: [0.42, 0.78, 0.34], leaves: [0.34, 0.68, 0.28] },
  { grass: [0.78, 0.68, 0.34], leaves: [0.88, 0.48, 0.18] },
  { grass: [1, 1, 1], leaves: [0.8, 0.85, 0.83] },
];

const SKY_DAY = [0x79c0f8, 0x6fb8ff, 0x8fb2d8, 0xa8c4d8].map((c) => new THREE.Color(c));
const SKY_NIGHT = new THREE.Color(0x0b1226);
const SKY_SET = new THREE.Color(0xf2a35c);

function discTexture(inner, outer, spots) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.75, outer);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  if (spots) {
    g.fillStyle = 'rgba(160,170,190,0.5)';
    for (const [x, y, r] of [[24, 26, 5], [38, 38, 4], [36, 20, 3]]) {
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  }
  return new THREE.CanvasTexture(cv);
}

export class Env {
  constructor(scene) {
    this.scene = scene;
    this.amb = new THREE.AmbientLight(0xffffff, 0.7);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sun.position.set(40, 80, 20);
    scene.add(this.amb, this.sun, this.sun.target);

    scene.background = new THREE.Color(0x79c0f8);
    scene.fog = new THREE.Fog(0x79c0f8, 34, 100);

    this.sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture('#fff8d8', '#ffd34d'), fog: false, depthWrite: false }));
    this.sunSpr.scale.set(26, 26, 1);
    this.moonSpr = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture('#f0f4ff', '#b8c4de', true), fog: false, depthWrite: false }));
    this.moonSpr.scale.set(18, 18, 1);
    scene.add(this.sunSpr, this.moonSpr);

    // stars
    const sp = [];
    for (let i = 0; i < 340; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.5;
      sp.push(Math.cos(a) * Math.cos(e) * 190, Math.sin(e) * 190 + 5, Math.sin(a) * Math.cos(e) * 190);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xdde6ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    scene.add(this.stars);

    // weather particles
    this.weather = this._makeWeather();
    scene.add(this.weather.points);

    // torch light pool
    this.lights = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffa855, 0, 9, 1.8);
      scene.add(l);
      this.lights.push(l);
    }
    this.heartLight = new THREE.PointLight(0xff5577, 0, 12, 1.6);
    scene.add(this.heartLight);
    this._t = 0;
  }

  _makeWeather() {
    const N = 500;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 44;
      pos[i * 3 + 1] = Math.random() * 26;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 44;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false, depthWrite: false });
    return { points: new THREE.Points(g, m), pos, N, mode: 'off' };
  }

  update(wt, camera, dt) {
    const ph = phaseOf(wt);
    this._t += dt;
    const camP = camera.position;

    let sunEl, dayLight;
    if (!ph.isNight) {
      const t = ph.tin / ph.dayFrac;
      sunEl = Math.sin(Math.PI * t);
      dayLight = Math.min(1, sunEl * 1.6);
      const az = Math.PI * t;
      const dir = new THREE.Vector3(-Math.cos(az), Math.max(0.06, sunEl), -0.35).normalize();
      this.sun.position.copy(dir.clone().multiplyScalar(120)).add(camP);
      this.sun.target.position.copy(camP);
      this.sunSpr.visible = true;
      this.sunSpr.position.copy(camP).add(dir.clone().multiplyScalar(170));
      this.moonSpr.visible = false;
    } else {
      const t = (ph.tin - ph.dayFrac) / (1 - ph.dayFrac);
      sunEl = 0; dayLight = 0;
      const az = Math.PI * t;
      const dir = new THREE.Vector3(-Math.cos(az), Math.max(0.1, Math.sin(Math.PI * t)), -0.35).normalize();
      this.moonSpr.visible = true;
      this.moonSpr.position.copy(camP).add(dir.clone().multiplyScalar(170));
      this.sunSpr.visible = false;
      this.sun.position.copy(dir.clone().multiplyScalar(120)).add(camP);
      this.sun.target.position.copy(camP);
    }

    this.sun.intensity = 0.12 + dayLight * 0.95;
    this.sun.color.setHSL(0.12, dayLight < 0.35 ? 0.7 : 0.25, dayLight < 0.35 ? 0.6 : 0.95);
    this.amb.intensity = 0.26 + dayLight * 0.5;

    // sky color
    const skyDay = SKY_DAY[ph.season];
    const col = new THREE.Color();
    if (!ph.isNight) {
      const t = ph.tin / ph.dayFrac;
      const edge = Math.min(t, 1 - t) * ph.dayFrac * CYCLE / 60; // minutes from day edge
      col.copy(skyDay);
      if (edge < 0.9) col.lerp(SKY_SET, 1 - edge / 0.9);
      this.starMat.opacity = Math.max(0, 1 - edge * 2) * 0.4;
    } else {
      const t = (ph.tin - ph.dayFrac) / (1 - ph.dayFrac);
      const edge = Math.min(t, 1 - t) * (1 - ph.dayFrac) * CYCLE / 60;
      col.copy(SKY_NIGHT);
      if (edge < 0.5) col.lerp(SKY_SET, (1 - edge / 0.5) * 0.55);
      this.starMat.opacity = Math.min(1, t * 4, (1 - t) * 4);
    }
    this.scene.background.copy(col);
    this.scene.fog.color.copy(col);
    this.stars.position.copy(camP);

    // weather
    const w = this.weather;
    let mode = 'off';
    if (ph.season === 3) mode = 'snow';
    else if (ph.season === 2) mode = 'leaves';
    else if (ph.season === 0 && Math.sin(wt / 37) > 0.55) mode = 'rain';
    if (mode !== w.mode) {
      w.mode = mode;
      const m = w.points.material;
      if (mode === 'snow') { m.color.set(0xffffff); m.size = 2.4; m.opacity = 0.85; }
      if (mode === 'leaves') { m.color.set(0xd8742a); m.size = 3.0; m.opacity = 0.9; }
      if (mode === 'rain') { m.color.set(0x9ec8ee); m.size = 1.6; m.opacity = 0.6; }
    }
    w.points.visible = mode !== 'off';
    if (w.points.visible) {
      const speed = mode === 'rain' ? 22 : mode === 'snow' ? 2.6 : 1.5;
      const sway = mode === 'snow' ? 0.7 : mode === 'leaves' ? 1.4 : 0;
      const arr = w.pos;
      for (let i = 0; i < w.N; i++) {
        arr[i * 3 + 1] -= speed * dt * (0.7 + (i % 7) * 0.08);
        if (sway) arr[i * 3] += Math.sin(this._t * 1.3 + i) * sway * dt;
        if (arr[i * 3 + 1] < 0) {
          arr[i * 3 + 1] = 26;
          arr[i * 3] = (Math.random() - 0.5) * 44;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 44;
        }
      }
      w.points.position.set(camP.x, camP.y - 10, camP.z);
      w.points.geometry.attributes.position.needsUpdate = true;
    }
    return ph;
  }

  syncTorches(torchSet, camP, heart, dayLight01) {
    const arr = [];
    for (const k of torchSet) {
      const [x, y, z] = k.split(',').map(Number);
      const d = (x - camP.x) ** 2 + (y - camP.y) ** 2 + (z - camP.z) ** 2;
      if (d < 2500) arr.push([d, x, y, z]);
    }
    arr.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      if (i < arr.length) {
        l.position.set(arr[i][1] + 0.5, arr[i][2] + 0.6, arr[i][3] + 0.5);
        l.intensity = 1.6 + Math.sin(this._t * 9 + i * 2) * 0.25;
      } else l.intensity = 0;
    }
    if (heart) {
      this.heartLight.position.set(heart.x + 0.5, heart.y + 1.2, heart.z + 0.5);
      this.heartLight.intensity = 1.2 + Math.sin(this._t * 2.2) * 0.5;
    } else this.heartLight.intensity = 0;
  }
}
