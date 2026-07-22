// VILDMARK — first-person player: voxel physics, raycast, inventory/hotbar
import * as THREE from 'three';
import { B } from './blocks.js';

const HALF_W = 0.3, HEIGHT = 1.8, EYE = 1.62;

export const HOTBAR = [
  { sword: true },
  { res: 'jord' }, { res: 'sten' }, { res: 'sand' }, { res: 'planka' },
  { res: 'stock' }, { res: 'fackla' }, { res: 'gooblock' }, { res: 'hjartsten' },
  { res: 'huggbank' }, { res: 'odling' }, { res: 'gruvstation' }, { res: 'vaktpost' },
];

export function loadHotbar() {
  try {
    const raw = JSON.parse(localStorage.getItem('vildmark_hotbar_v1'));
    if (!Array.isArray(raw) || raw.length !== HOTBAR.length) return HOTBAR.map((s) => ({ ...s }));
    return raw.map((s) => (s && (s.sword || s.tool === 'axe' || s.tool === 'pick' || typeof s.res === 'string')) ? { ...s } : {});
  } catch { return HOTBAR.map((s) => ({ ...s })); }
}

export function saveHotbar(hotbar) {
  try { localStorage.setItem('vildmark_hotbar_v1', JSON.stringify(hotbar)); } catch {}
}

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3(0.5, 30, 0.5);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.grounded = false;
    this.inWater = false;
    this.hp = 20; this.maxHp = 20;
    this.sword = 0;
    this.axe = 0;
    this.pick = 0;
    this.inv = { jord: 0, sten: 0, sand: 0, stock: 0, planka: 0, kol: 0, jarn: 0, klump: 0, fackla: 0, gooblock: 0, hjartsten: 0, apple: 0, mynt: 0, huggbank: 0, odling: 0, gruvstation: 0, vaktpost: 0 };
    this.hotbar = loadHotbar();
    this.sel = 0;
    this.dead = false;
    this.bounceCd = 0;
  }

  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z); }

  applyLook(dx, dy, sens = 0.0024) {
    // sanitize: pointer-lock can emit NaN/huge spikes — without this the view
    // gets stuck forever (NaN propagates through every later frame)
    if (!Number.isFinite(dx)) dx = 0;
    if (!Number.isFinite(dy)) dy = 0;
    dx = Math.max(-400, Math.min(400, dx));
    dy = Math.max(-400, Math.min(400, dy));
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    if (!Number.isFinite(this.yaw)) this.yaw = 0;
    if (!Number.isFinite(this.pitch)) this.pitch = 0;
    this.pitch = Math.max(-1.53, Math.min(1.53, this.pitch));
  }

  dir() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  update(dt, input, sfx) {
    if (this.dead) return;
    // self-heal if physics ever produced invalid numbers
    if (!Number.isFinite(this.pos.x) || !Number.isFinite(this.pos.y) || !Number.isFinite(this.pos.z)) {
      console.warn('VILDMARK: ogiltig position — återställer');
      this.pos.set(0.5, this.world.surfaceY(0, 0) + 0.5, 0.5);
      this.vel.set(0, 0, 0);
    }
    if (!Number.isFinite(this.vel.x) || !Number.isFinite(this.vel.y) || !Number.isFinite(this.vel.z)) this.vel.set(0, 0, 0);
    if (!Number.isFinite(this.pitch)) this.pitch = 0;
    if (!Number.isFinite(this.yaw)) this.yaw = 0;
    const w = this.world;
    dt = Math.min(dt, 0.05);
    this.bounceCd = Math.max(0, this.bounceCd - dt);

    const feetId = w.getBlock(this.pos.x, this.pos.y + 0.2, this.pos.z);
    const headId = w.getBlock(this.pos.x, this.pos.y + EYE, this.pos.z);
    const feetIce = w.isIceAt(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.2), Math.floor(this.pos.z));
    this.inWater = (feetId === B.WATER && !feetIce) || headId === B.WATER;

    // wish direction
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const fx = -s, fz = -c, rx = c, rz = -s;
    let wx = rx * input.move.x + fx * (-input.move.z);
    let wz = rz * input.move.x + fz * (-input.move.z);

    const onIce = this.grounded && w.isIceAt(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z));
    const maxSp = this.inWater ? 3.4 : 5.2;
    const accel = this.inWater ? 18 : (this.grounded ? (onIce ? 14 : 60) : 14);
    const fric = this.inWater ? 4 : (this.grounded ? (onIce ? 0.6 : 12) : 0.4);

    this.vel.x += wx * accel * dt;
    this.vel.z += wz * accel * dt;
    const hv = Math.hypot(this.vel.x, this.vel.z);
    if (hv > maxSp) { this.vel.x *= maxSp / hv; this.vel.z *= maxSp / hv; }
    if (!input.move.x && !input.move.z) {
      const f = Math.max(0, 1 - fric * dt);
      this.vel.x *= f; this.vel.z *= f;
    }

    if (this.inWater) {
      this.vel.y -= 6 * dt;
      if (input.jump) this.vel.y = Math.min(this.vel.y + 24 * dt, 3.2);
      this.vel.y = Math.max(this.vel.y, -3.2);
    } else {
      this.vel.y -= 24 * dt;
      this.vel.y = Math.max(this.vel.y, -42);
      if (input.jump && this.grounded) {
        this.vel.y = 8.2;
        this.grounded = false;
      }
    }

    this._moveAxis(this.vel.x * dt, 0, sfx);
    this._moveAxis(this.vel.z * dt, 2, sfx);
    this._moveAxis(this.vel.y * dt, 1, sfx);

    if (this.pos.y < -12) { this.hp = 0; } // fell out of world
  }

  _collides(px, py, pz) {
    const w = this.world;
    const x0 = Math.floor(px - HALF_W), x1 = Math.floor(px + HALF_W);
    const y0 = Math.floor(py), y1 = Math.floor(py + HEIGHT - 0.01);
    const z0 = Math.floor(pz - HALF_W), z1 = Math.floor(pz + HALF_W);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          if (w.isSolid(x, y, z)) return true;
    return false;
  }

  _moveAxis(d, axis, sfx) {
    if (d === 0) return;
    const p = this.pos;
    const step = Math.sign(d) * Math.min(Math.abs(d), 0.45);
    let rem = d;
    while (rem !== 0) {
      const mv = Math.abs(rem) > 0.45 ? step : rem;
      rem = Math.abs(rem) > 0.45 ? rem - step : 0;
      const nx = p.x + (axis === 0 ? mv : 0);
      const ny = p.y + (axis === 1 ? mv : 0);
      const nz = p.z + (axis === 2 ? mv : 0);
      if (!this._collides(nx, ny, nz)) {
        p.set(nx, ny, nz);
        if (axis === 1) this.grounded = false;
      } else {
        if (axis === 1) {
          if (mv < 0) {
            this.grounded = true;
            // bouncy goo block under feet
            const under = this.world.getBlock(p.x, p.y - 0.55, p.z);
            if (under === B.GOO && this.vel.y < -7 && this.bounceCd <= 0) {
              this.vel.y = Math.min(15, -this.vel.y * 0.85);
              this.bounceCd = 0.1;
              sfx && sfx.play('bounce');
              this.grounded = false;
              return;
            }
            if (this.vel.y < -16) {
              const dmg = Math.floor((-this.vel.y - 15) * 0.7);
              if (dmg > 0) { this.hp -= dmg; sfx && sfx.play('hurt'); }
            }
          }
          this.vel.y = 0;
        } else if (axis === 0) this.vel.x = 0;
        else this.vel.z = 0;
        return;
      }
    }
  }

  // DDA voxel raycast from the eye; skips water
  raycast(maxDist = 5.5) {
    const w = this.world;
    const o = this.eye(), d = this.dir();
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const stepX = Math.sign(d.x), stepY = Math.sign(d.y), stepZ = Math.sign(d.z);
    const tDX = stepX ? Math.abs(1 / d.x) : Infinity;
    const tDY = stepY ? Math.abs(1 / d.y) : Infinity;
    const tDZ = stepZ ? Math.abs(1 / d.z) : Infinity;
    let tX = stepX > 0 ? (x + 1 - o.x) * tDX : stepX < 0 ? (o.x - x) * tDX : Infinity;
    let tY = stepY > 0 ? (y + 1 - o.y) * tDY : stepY < 0 ? (o.y - y) * tDY : Infinity;
    let tZ = stepZ > 0 ? (z + 1 - o.z) * tDZ : stepZ < 0 ? (o.z - z) * tDZ : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 40; i++) {
      if (tX < tY && tX < tZ) { x += stepX; t = tX; tX += tDX; nx = -stepX; ny = 0; nz = 0; }
      else if (tY < tZ) { y += stepY; t = tY; tY += tDY; nx = 0; ny = -stepY; nz = 0; }
      else { z += stepZ; t = tZ; tZ += tDZ; nx = 0; ny = 0; nz = -stepZ; }
      if (t > maxDist) return null;
      const id = w.getBlock(x, y, z);
      if (id !== B.AIR && id !== B.WATER) {
        return { x, y, z, nx, ny, nz, dist: t, id };
      }
    }
    return null;
  }

  intersectsCell(x, y, z) {
    return x + 1 > this.pos.x - HALF_W && x < this.pos.x + HALF_W &&
           y + 1 > this.pos.y && y < this.pos.y + HEIGHT &&
           z + 1 > this.pos.z - HALF_W && z < this.pos.z + HALF_W;
  }
}
