// VILDMARK — enemies: vätte (fast), troll (tank, breaks walls), skytt (ranged)
// Host simulates; clients render from broadcast state.
import * as THREE from 'three';
import { B, DEF } from './blocks.js';

export const MOBT = {
  vatte: { hp: 10, dmg: 3, speed: 3.0, w: 0.7, h: 0.95, blockDmg: 3, atkCd: 1.1, hop: true,  face: 27, body: 0x58a83c, drops: { klump: [1, 2] } },
  troll: { hp: 34, dmg: 6, speed: 1.7, w: 1.1, h: 1.85, blockDmg: 8, atkCd: 1.4, hop: false, face: 28, body: 0x7a8696, drops: { klump: [2, 3], sten: [1, 2] } },
  skytt: { hp: 12, dmg: 3, speed: 2.3, w: 0.7, h: 1.15, blockDmg: 2, atkCd: 2.2, hop: false, face: 29, body: 0x3f7c38, drops: { klump: [1, 2], kol: [0, 1] }, ranged: true },
};

export class Mobs {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.projs = [];
    this.nextId = 1;
    this.blockHp = new Map(); // "x,y,z" -> remaining hp
  }

  spawn(type, x, y, z, nightMob = false) {
    const t = MOBT[type];
    this.list.push({
      id: this.nextId++, type, x, y, z, vy: 0, heading: Math.random() * Math.PI * 2,
      hp: t.hp, atk: 0, hopT: Math.random() * 0.5, ph: Math.random() * 6,
      nightMob, sunT: 0, wanderT: 0, stuck: 0,
    });
  }

  hit(id, dmg, kx, kz) {
    const m = this.list.find((m) => m.id === id);
    if (!m) return null;
    m.hp -= dmg;
    m.x += (kx || 0) * 0.6; m.z += (kz || 0) * 0.6;
    m.vy = Math.max(m.vy, 3.5);
    return m;
  }

  update(dt, ctx) {
    // ctx: { players:[{peer,x,y,z,hp,dead}], heart:{x,y,z,hp}|null, isNight, day, cb }
    const w = this.world;
    const dead = [];
    for (const m of this.list) {
      const t = MOBT[m.type];
      if (m.hp <= 0) { dead.push({ m, killed: true }); continue; }
      // daylight poof for night mobs
      if (!ctx.isNight && m.nightMob) {
        m.sunT += dt;
        if (m.sunT > 6 + (m.id % 10)) { dead.push({ m, killed: false }); continue; }
      }
      m.ph += dt * 6;
      m.atk = Math.max(0, m.atk - dt);

      // pick target
      let target = null, tDist = Infinity, tPlayer = null;
      for (const p of ctx.players) {
        if (p.dead) continue;
        const d = Math.hypot(p.x - m.x, p.z - m.z);
        const aggro = ctx.isNight ? 20 : 11;
        if (d < aggro && d < tDist) { tDist = d; target = p; tPlayer = p; }
      }
      if (!target && ctx.isNight && ctx.heart) {
        target = ctx.heart;
        tDist = Math.hypot(ctx.heart.x - m.x, ctx.heart.z - m.z);
      }

      let mx = 0, mz = 0;
      if (target) {
        const dx = target.x - m.x, dz = target.z - m.z;
        const l = Math.hypot(dx, dz) || 1;
        m.heading = Math.atan2(dx, dz);
        const isRangedHold = t.ranged && tPlayer && tDist < 11 && tDist > 4.5;
        if (!isRangedHold && tDist > (target === ctx.heart ? 1.4 : 1.25)) {
          mx = dx / l * t.speed; mz = dz / l * t.speed;
        }
        // ranged attack
        if (t.ranged && tPlayer && tDist < 12 && m.atk <= 0) {
          m.atk = t.atkCd;
          const py = tPlayer.y + 1.2, oy = m.y + t.h * 0.7;
          const l3 = Math.hypot(dx, py - oy, dz) || 1;
          this.projs.push({
            x: m.x, y: oy, z: m.z,
            vx: dx / l3 * 13, vy: (py - oy) / l3 * 13 + l / 22, vz: dz / l3 * 13,
            ttl: 3, dmg: t.dmg,
          });
          ctx.cb.sfx('spit', m.x, m.y, m.z);
        }
        // melee player
        if (!t.ranged && tPlayer && tDist < 1.5 && Math.abs(tPlayer.y - m.y) < 2 && m.atk <= 0) {
          m.atk = t.atkCd;
          ctx.cb.damagePlayer(tPlayer.peer, t.dmg, m);
        }
        // attack heart
        if (target === ctx.heart && tDist < 1.7 && m.atk <= 0) {
          m.atk = t.atkCd;
          ctx.cb.heartDamage(t.dmg, m);
        }
      } else {
        // wander
        m.wanderT -= dt;
        if (m.wanderT <= 0) { m.wanderT = 2 + Math.random() * 3; m.heading = Math.random() * Math.PI * 2; }
        mx = Math.sin(m.heading) * t.speed * 0.4;
        mz = Math.cos(m.heading) * t.speed * 0.4;
      }

      // hop movement for vättar
      if (t.hop && (mx || mz)) {
        m.hopT -= dt;
        if (m.hopT <= 0 && this._grounded(m, t)) { m.vy = 5.2; m.hopT = 0.55; }
      }

      // physics
      const inWater = w.getBlock(m.x, m.y + 0.3, m.z) === B.WATER && !w.isIceAt(Math.floor(m.x), Math.floor(m.y + 0.3), Math.floor(m.z));
      m.vy -= (inWater ? 6 : 22) * dt;
      if (inWater) m.vy = Math.max(m.vy, -1.5) + 14 * dt; // buoyant
      const sc = inWater ? 0.55 : 1;
      const movedX = this._tryMove(m, t, mx * sc * dt, 0);
      const movedZ = this._tryMove(m, t, 0, mz * sc * dt);
      this._vertMove(m, t, m.vy * dt);

      // blocked -> jump or gnaw through blocks
      if ((mx || mz) && (!movedX && Math.abs(mx) > 0.1 || !movedZ && Math.abs(mz) > 0.1)) {
        m.stuck += dt;
        const fx = Math.floor(m.x + Math.sign(mx || 0) * (t.w / 2 + 0.4));
        const fz = Math.floor(m.z + Math.sign(mz || 0) * (t.w / 2 + 0.4));
        const fy = Math.floor(m.y + 0.2);
        const headClear = !w.isSolid(Math.floor(m.x), fy + Math.ceil(t.h), Math.floor(m.z));
        if (this._grounded(m, t) && headClear && !w.isSolid(fx, fy + Math.ceil(t.h), fz) && !w.isSolid(fx, fy + 1, fz)) {
          m.vy = t.hop ? 6.4 : 7.2; // jump up one block
          m.stuck = 0;
        } else if (m.stuck > 0.7 && m.atk <= 0 && target) {
          // chew the block in the way (feet level first, then head)
          for (const by of [fy, fy + 1]) {
            const id = w.getBlock(fx, by, fz);
            if (id !== B.AIR && id !== B.WATER && id !== B.BEDROCK && id !== B.HEART) {
              m.atk = t.atkCd;
              this._damageBlock(fx, by, fz, id, t.blockDmg, ctx);
              break;
            }
          }
        }
      } else {
        m.stuck = Math.max(0, m.stuck - dt);
      }

      if (m.y < -10) dead.push({ m, killed: false });
    }

    for (const { m, killed } of dead) {
      this.list.splice(this.list.indexOf(m), 1);
      ctx.cb.mobGone(m, killed);
    }

    // projectiles
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      p.ttl -= dt;
      p.vy -= 10 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      let gone = p.ttl <= 0 || w.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      if (!gone) {
        for (const pl of ctx.players) {
          if (pl.dead) continue;
          if (Math.abs(pl.x - p.x) < 0.55 && Math.abs(pl.z - p.z) < 0.55 && p.y > pl.y - 0.2 && p.y < pl.y + 1.9) {
            ctx.cb.damagePlayer(pl.peer, p.dmg, null);
            gone = true;
            break;
          }
        }
      }
      if (gone) this.projs.splice(i, 1);
    }
  }

  _damageBlock(x, y, z, id, dmg, ctx) {
    const k = x + ',' + y + ',' + z;
    let hp = this.blockHp.get(k);
    if (hp === undefined) hp = DEF[id].hp;
    hp -= dmg;
    if (hp <= 0) {
      this.blockHp.delete(k);
      ctx.cb.editBlock(x, y, z, B.AIR);
      ctx.cb.sfx('break', x, y, z);
    } else {
      this.blockHp.set(k, hp);
      ctx.cb.sfx('gnaw', x, y, z);
    }
  }

  _grounded(m, t) {
    const w = this.world;
    return w.isSolid(Math.floor(m.x), Math.floor(m.y - 0.15), Math.floor(m.z)) ||
           w.isSolid(Math.floor(m.x + t.w * 0.4), Math.floor(m.y - 0.15), Math.floor(m.z)) ||
           w.isSolid(Math.floor(m.x - t.w * 0.4), Math.floor(m.y - 0.15), Math.floor(m.z));
  }

  _free(m, t, x, y, z) {
    const w = this.world;
    const hw = t.w / 2;
    for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) {
      for (let yy = 0; yy < Math.ceil(t.h); yy++) {
        if (w.isSolid(Math.floor(x + ox), Math.floor(y + yy + 0.05), Math.floor(z + oz))) return false;
      }
    }
    return true;
  }

  _tryMove(m, t, dx, dz) {
    if (this._free(m, t, m.x + dx, m.y, m.z + dz)) { m.x += dx; m.z += dz; return true; }
    return false;
  }

  _vertMove(m, t, dy) {
    if (this._free(m, t, m.x, m.y + dy, m.z)) { m.y += dy; }
    else if (dy < 0) m.vy = 0;
    else m.vy = Math.min(m.vy, 0);
  }

  state() {
    return {
      m: this.list.map((m) => [m.id, m.type, +m.x.toFixed(2), +m.y.toFixed(2), +m.z.toFixed(2), m.hp, +m.heading.toFixed(2)]),
      p: this.projs.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]),
    };
  }
}

// ---------- rendering ----------
export class MobView {
  constructor(scene, atlasTex) {
    this.scene = scene;
    this.views = new Map(); // id -> {group, tx, ty, tz, heading, type, hp}
    this.projMeshes = [];
    this.faceMats = {};
    this.atlasTex = atlasTex;
    this.projGeo = new THREE.IcosahedronGeometry(0.22, 0);
    this.projMat = new THREE.MeshLambertMaterial({ color: 0x6bd44e });
  }

  _faceMat(type) {
    if (!this.faceMats[type]) {
      const tex = this.atlasTex.clone();
      const tile = MOBT[type].face;
      tex.repeat.set(1 / 8, 1 / 4);
      tex.offset.set((tile % 8) / 8, 1 - (Math.floor(tile / 8) + 1) / 4);
      tex.needsUpdate = true;
      this.faceMats[type] = new THREE.MeshLambertMaterial({ map: tex });
    }
    return this.faceMats[type];
  }

  _build(type) {
    const t = MOBT[type];
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: t.body });
    const face = this._faceMat(type);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(t.w, t.h * 0.72, t.w * 0.8),
      [bodyMat, bodyMat, bodyMat, bodyMat, face, bodyMat]
    );
    body.position.y = t.h * 0.62;
    g.add(body);
    const darker = new THREE.MeshLambertMaterial({ color: new THREE.Color(t.body).multiplyScalar(0.7) });
    for (const s of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.34, t.h * 0.26, t.w * 0.4), darker);
      foot.position.set(s * t.w * 0.28, t.h * 0.13, 0);
      g.add(foot);
      const ear = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.16, t.h * 0.22, t.w * 0.1), darker);
      ear.position.set(s * t.w * 0.36, t.h * 1.04, 0);
      g.add(ear);
    }
    g.userData.body = body;
    return g;
  }

  sync(state, dt) {
    const seen = new Set();
    for (const [id, type, x, y, z, hp, heading] of state.m) {
      seen.add(id);
      let v = this.views.get(id);
      if (!v) {
        const group = this._build(type);
        group.position.set(x, y, z);
        this.scene.add(group);
        v = { group, tx: x, ty: y, tz: z, heading, type, hp, ph: Math.random() * 6 };
        this.views.set(id, v);
      }
      v.tx = x; v.ty = y; v.tz = z; v.heading = heading; v.hp = hp;
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.scene.remove(v.group);
        this.views.delete(id);
        continue;
      }
      const g = v.group;
      const k = Math.min(1, dt * 12);
      g.position.x += (v.tx - g.position.x) * k;
      g.position.y += (v.ty - g.position.y) * k;
      g.position.z += (v.tz - g.position.z) * k;
      let dh = v.heading - g.rotation.y;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      g.rotation.y += dh * Math.min(1, dt * 10);
      v.ph += dt * 7;
      const squash = 1 + Math.sin(v.ph) * 0.07;
      g.scale.set(1, squash, 1);
    }
    // projectiles
    while (this.projMeshes.length < state.p.length) {
      const mm = new THREE.Mesh(this.projGeo, this.projMat);
      this.scene.add(mm);
      this.projMeshes.push(mm);
    }
    for (let i = 0; i < this.projMeshes.length; i++) {
      const mm = this.projMeshes[i];
      if (i < state.p.length) {
        mm.visible = true;
        mm.position.set(state.p[i][0], state.p[i][1], state.p[i][2]);
      } else mm.visible = false;
    }
  }

  clear() {
    for (const [, v] of this.views) this.scene.remove(v.group);
    this.views.clear();
    for (const mm of this.projMeshes) this.scene.remove(mm);
    this.projMeshes = [];
  }
}
