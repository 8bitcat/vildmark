// VILDMARK — villagers: professions bound to built (roofed) work stations,
// orders via dialog, guards that fight, production into the village storage.
import * as THREE from 'three';
import { B, tileOffset } from './blocks.js';
import { MOBT } from './mobs.js';

export const VILLAGER_COST = 20;
export const MAX_VILLAGERS = 8;
const NAMES = ['Olle', 'Märta', 'Sven', 'Greta', 'Nils', 'Astrid', 'Erik', 'Saga', 'Björn', 'Elsa', 'Rut', 'Gösta', 'Tyra', 'Folke', 'Signe', 'Arvid'];

export const PROFS = {
  ledig:   { name: 'Sysslolös',    body: 0x8a8f98, face: 39 },
  huggare: { name: 'Skogshuggare', body: 0x7a5a30, face: 39, station: B.HUGG,   prod: { every: 26, out: { stock: 2 }, snd: 'dig' } },
  bonde:   { name: 'Bonde',        body: 0x8aa03a, face: 39, station: B.ODLING, prod: { every: 28, out: { apple: 2 }, snd: 'eat' } },
  gruvare: { name: 'Gruvarbetare', body: 0x5a6a7a, face: 39, station: B.GRUV,   prod: { every: 32, out: { sten: 2 }, bonus: [['kol', 0.35], ['jarn', 0.12]], snd: 'gnaw' } },
  vakt:    { name: 'Vakt',         body: 0xa04040, face: 39, station: B.VAKTPOST, combat: { dmg: 6, cd: 1.0, aggro: 11 } },
  aldste:  { name: 'Byäldste',     body: 0x6a4a8a, face: 40, elder: true },
};

export const STATION_PROF = { [B.HUGG]: 'huggare', [B.ODLING]: 'bonde', [B.GRUV]: 'gruvare', [B.VAKTPOST]: 'vakt' };

export function roofed(world, x, y, z) {
  for (let dy = 1; dy <= 7; dy++) {
    if (world.isSolid(x, y + dy, z)) return true;
  }
  return false;
}

// ---------- host simulation ----------
export class Villagers {
  constructor(world) {
    this.world = world;
    this.list = [];
    this.nextId = 1;
    this.stations = new Map(); // "x,y,z" -> { type, vid|null }
    this.nameIdx = Math.floor(Math.random() * NAMES.length);
  }

  spawn(x, y, z, prof = 'ledig', name = null) {
    if (!name) { name = NAMES[this.nameIdx % NAMES.length]; this.nameIdx++; }
    const v = {
      id: this.nextId++, name, prof, mode: prof === 'vakt' ? 'work' : (PROFS[prof].prod ? 'work' : 'home'),
      job: null, followPeer: null, stayPos: null,
      x, y, z, vy: 0, heading: Math.random() * Math.PI * 2,
      hp: 24, maxHp: 24, workT: 10 + Math.random() * 10, wanderT: 0, atk: 0, stuck: 0, hintT: 0,
    };
    this.list.push(v);
    return v;
  }

  get(id) { return this.list.find((v) => v.id === id); }
  elder() { return this.list.find((v) => v.prof === 'aldste'); }

  registerStation(x, y, z, type) {
    this.stations.set(x + ',' + y + ',' + z, { type, vid: null });
  }
  unregisterStation(x, y, z) {
    const k = x + ',' + y + ',' + z;
    const s = this.stations.get(k);
    if (s && s.vid) {
      const v = this.get(s.vid);
      if (v) { v.prof = 'ledig'; v.job = null; v.mode = 'home'; }
    }
    this.stations.delete(k);
    return s;
  }
  freeStations() {
    const out = [];
    for (const [k, s] of this.stations) {
      if (s.vid) continue;
      const [x, y, z] = k.split(',').map(Number);
      out.push({ key: k, x, y, z, type: s.type, roofed: roofed(this.world, x, y, z) });
    }
    return out;
  }

  // dialog menu for a villager, host-side truth
  menu(vid) {
    const v = this.get(vid);
    if (!v) return null;
    const p = PROFS[v.prof];
    const title = `${v.name} — ${p.name}`;
    const opts = [];
    let lines = [];
    if (p.elder) {
      lines = ['Välkommen till byn! Döda monster för mynt.', 'Bygg arbetsbänkar i hus med tak, så kan bybor börja jobba.'];
      opts.push({ k: 'buy', label: `🪙 Köp en bybo — ${VILLAGER_COST} mynt` });
    } else if (v.prof === 'ledig') {
      const free = this.freeStations();
      if (!free.length) {
        lines = ['Jag har inget att göra…', 'Bygg ett hus med en arbetsbänk i (tillverka: Skogshuggarbänk, Odlingslåda, Gruvstation eller Vaktpost) innan du kan ge mig ett jobb!'];
      } else {
        lines = ['Vad ska jag jobba med?'];
        for (const s of free) {
          const prof = STATION_PROF[s.type];
          opts.push({
            k: 'job:' + s.key,
            label: `Bli ${PROFS[prof].name.toLowerCase()} (${Math.round(Math.hypot(s.x - v.x, s.z - v.z))}m bort)` + (s.roofed ? '' : ' — ⚠️ saknar tak!'),
            disabled: !s.roofed,
          });
        }
      }
      opts.push({ k: 'follow', label: '🚶 Följ med mig' });
      opts.push({ k: 'home', label: '🏠 Gå hem till byn' });
    } else if (v.prof === 'vakt') {
      lines = ['Jag skyddar byn mot monstren!'];
      opts.push({ k: 'work', label: '🛡️ Vakta din post' });
      opts.push({ k: 'follow', label: '⚔️ Följ med mig (livvakt)' });
      opts.push({ k: 'stay', label: '📍 Stå vakt här' });
      opts.push({ k: 'quit', label: '❌ Sluta som vakt' });
    } else {
      lines = [PROFS[v.prof].name + ' till er tjänst! Det jag samlar läggs i förrådskistan i starthuset.'];
      opts.push({ k: 'work', label: '💪 Jobba vid din station' });
      opts.push({ k: 'follow', label: '🚶 Följ med mig' });
      opts.push({ k: 'stay', label: '📍 Stanna här' });
      opts.push({ k: 'home', label: '🏠 Gå hem till byn' });
      opts.push({ k: 'quit', label: '❌ Sluta jobbet' });
    }
    return { vid, title, lines, opts };
  }

  // apply an order; returns a toast string or null
  order(vid, k, peer) {
    const v = this.get(vid);
    if (!v) return null;
    if (k.startsWith('job:')) {
      const key = k.slice(4);
      const s = this.stations.get(key);
      if (!s || s.vid) return 'Stationen är upptagen!';
      const [x, y, z] = key.split(',').map(Number);
      if (!roofed(this.world, x, y, z)) return 'Stationen behöver ett tak — bygg ett hus runt den!';
      s.vid = v.id;
      v.prof = STATION_PROF[s.type];
      v.job = key;
      v.mode = 'work';
      v.workT = PROFS[v.prof].prod ? PROFS[v.prof].prod.every : 0;
      return `${v.name} blev ${PROFS[v.prof].name.toLowerCase()}!`;
    }
    switch (k) {
      case 'follow': v.mode = 'follow'; v.followPeer = peer; return `${v.name} följer med dig`;
      case 'stay': v.mode = 'stay'; v.stayPos = { x: v.x, y: v.y, z: v.z }; return `${v.name} stannar här`;
      case 'home': v.mode = 'home'; return `${v.name} går hem till byn`;
      case 'work': v.mode = 'work'; return v.job ? `${v.name} återgår till jobbet` : null;
      case 'quit': {
        if (v.job) { const s = this.stations.get(v.job); if (s) s.vid = null; }
        v.prof = 'ledig'; v.job = null; v.mode = 'home';
        return `${v.name} är nu sysslolös`;
      }
    }
    return null;
  }

  update(dt, ctx) {
    // ctx: { players, mobs (Mobs instance), village, isNight, cb: { store(res,n,byName), toast, sfx(name,x,y,z), villagerDied(v) } }
    const w = this.world;
    const dead = [];
    for (const v of this.list) {
      if (v.hp <= 0) { dead.push(v); continue; }
      v.atk = Math.max(0, v.atk - dt);
      v.hintT = Math.max(0, v.hintT - dt);
      const p = PROFS[v.prof];

      // pick a movement goal
      let goal = null, speed = 2.2;
      const home = ctx.village;
      if (v.mode === 'follow' && v.followPeer != null) {
        const pl = ctx.players.find((q) => q.peer === v.followPeer && !q.dead);
        if (pl) {
          const d = Math.hypot(pl.x - v.x, pl.z - v.z);
          if (d > 2.6) { goal = pl; speed = 3.2; }
        } else v.mode = 'home';
      } else if (v.mode === 'stay' && v.stayPos) {
        if (Math.hypot(v.stayPos.x - v.x, v.stayPos.z - v.z) > 1.5) goal = v.stayPos;
      } else if (v.mode === 'work' && v.job) {
        const [jx, jy, jz] = v.job.split(',').map(Number);
        // station gone? -> unemployed
        if (w.getBlock(jx, jy, jz) !== (PROFS[v.prof].station ?? -1)) {
          this.unregisterStation(jx, jy, jz);
          ctx.cb.toast(`${v.name} har ingen station längre och är sysslolös`);
          continue;
        }
        const d = Math.hypot(jx + 0.5 - v.x, jz + 0.5 - v.z);
        if (d > 5) goal = { x: jx + 0.5, z: jz + 0.5 };
        else {
          v.wanderT -= dt;
          if (v.wanderT <= 0) {
            v.wanderT = 2 + Math.random() * 3;
            v.heading = Math.random() * Math.PI * 2;
          }
          // production (needs roof)
          if (p.prod) {
            v.workT -= dt;
            if (v.workT <= 0) {
              v.workT = p.prod.every;
              if (roofed(w, jx, jy, jz)) {
                for (const [res, n] of Object.entries(p.prod.out)) ctx.cb.store(res, n, v.name);
                if (p.prod.bonus) {
                  for (const [res, ch] of p.prod.bonus) if (Math.random() < ch) ctx.cb.store(res, 1, v.name);
                }
                ctx.cb.sfx(p.prod.snd || 'dig', v.x, v.y, v.z);
              } else if (v.hintT <= 0) {
                v.hintT = 40;
                ctx.cb.toast(`⚠️ ${v.name}s station saknar tak — bygg ett hus!`);
              }
            }
          }
        }
      } else { // home / idle wander near village
        const d = Math.hypot(home.x - v.x, home.z - v.z);
        if (d > 8) goal = { x: home.x, z: home.z };
        else {
          v.wanderT -= dt;
          if (v.wanderT <= 0) {
            v.wanderT = 2.5 + Math.random() * 4;
            v.heading = Math.random() * Math.PI * 2;
          }
        }
      }

      // guard combat
      if (p.combat && v.atk <= 0) {
        let tgt = null, td = p.combat.aggro;
        for (const m of ctx.mobs.list) {
          const d = Math.hypot(m.x - v.x, m.z - v.z);
          if (d < td) { td = d; tgt = m; }
        }
        if (tgt) {
          if (td > 1.7) { goal = tgt; speed = 3.4; }
          else {
            v.atk = p.combat.cd;
            const l = Math.hypot(tgt.x - v.x, tgt.z - v.z) || 1;
            ctx.mobs.hit(tgt.id, p.combat.dmg, (tgt.x - v.x) / l, (tgt.z - v.z) / l);
            const mm = ctx.mobs.list.find((q) => q.id === tgt.id);
            if (mm) mm.lastHit = mm.lastHit || null; // guard kills give no player loot
            ctx.cb.sfx('mobhit', v.x, v.y, v.z);
          }
        }
      }
      // civilians flee nearby mobs
      if (!p.combat && !p.elder) {
        for (const m of ctx.mobs.list) {
          const d = Math.hypot(m.x - v.x, m.z - v.z);
          if (d < 5) { goal = { x: v.x + (v.x - m.x), z: v.z + (v.z - m.z) }; speed = 3.6; break; }
        }
      }

      // movement + physics
      let mx = 0, mz = 0;
      if (goal) {
        const dx = goal.x - v.x, dz = goal.z - v.z;
        const l = Math.hypot(dx, dz) || 1;
        v.heading = Math.atan2(dx, dz);
        mx = dx / l * speed; mz = dz / l * speed;
      } else if (v.mode !== 'stay') {
        mx = Math.sin(v.heading) * 0.7;
        mz = Math.cos(v.heading) * 0.7;
      }
      const inWater = w.getBlock(v.x, v.y + 0.3, v.z) === B.WATER && !w.isIceAt(Math.floor(v.x), Math.floor(v.y + 0.3), Math.floor(v.z));
      v.vy -= (inWater ? 5 : 22) * dt;
      if (inWater) v.vy = Math.max(v.vy, -1.2) + 13 * dt;
      const movedX = tryMove(w, v, mx * dt, 0);
      const movedZ = tryMove(w, v, 0, mz * dt);
      vertMove(w, v, v.vy * dt);
      if ((mx || mz) && (!movedX || !movedZ)) {
        if (grounded(w, v)) v.vy = 7.2; // hop up a block
      }
      if (v.y < -10) dead.push(v);
    }

    for (const v of dead) {
      this.list.splice(this.list.indexOf(v), 1);
      if (v.job) { const s = this.stations.get(v.job); if (s) s.vid = null; }
      ctx.cb.villagerDied(v);
    }
  }

  hit(id, dmg) {
    const v = this.get(id);
    if (v) v.hp -= dmg;
    return v;
  }

  state() {
    return this.list.map((v) => [v.id, v.name, v.prof, +v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2), +v.heading.toFixed(2), v.hp]);
  }

  serialize() {
    return this.list.map((v) => ({ name: v.name, prof: v.prof, mode: v.mode, job: v.job, x: v.x, y: v.y, z: v.z, hp: v.hp }));
  }
  restore(arr, stations) {
    for (const s of stations || []) this.stations.set(s.key, { type: s.type, vid: null });
    for (const d of arr || []) {
      const v = this.spawn(d.x, d.y, d.z, d.prof, d.name);
      v.mode = d.mode || 'home';
      v.hp = d.hp ?? 24;
      if (d.job && this.stations.has(d.job)) {
        v.job = d.job;
        this.stations.get(d.job).vid = v.id;
      } else if (!PROFS[v.prof].elder && v.prof !== 'ledig' && !d.job) {
        v.prof = 'ledig';
      }
    }
  }
}

// --- simple villager voxel physics (same style as mobs) ---
const VW = 0.6, VH = 1.7;
function free(w, x, y, z) {
  const hw = VW / 2;
  for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) {
    for (let yy = 0; yy < 2; yy++) {
      if (w.isSolid(Math.floor(x + ox), Math.floor(y + yy + 0.05), Math.floor(z + oz))) return false;
    }
  }
  return true;
}
function tryMove(w, v, dx, dz) {
  if (free(w, v.x + dx, v.y, v.z + dz)) { v.x += dx; v.z += dz; return true; }
  return false;
}
function vertMove(w, v, dy) {
  if (free(w, v.x, v.y + dy, v.z)) v.y += dy;
  else if (dy < 0) v.vy = 0;
  else v.vy = Math.min(v.vy, 0);
}
function grounded(w, v) {
  return w.isSolid(Math.floor(v.x), Math.floor(v.y - 0.15), Math.floor(v.z));
}

// ---------- rendering ----------
function tagSprite(name, profName, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 80;
  const g = cv.getContext('2d');
  g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath(); g.roundRect(28, 4, 200, 72, 12); g.fill();
  g.font = 'bold 30px sans-serif';
  g.fillStyle = '#ffffff';
  g.fillText(name, 128, 34);
  g.font = '22px sans-serif';
  g.fillStyle = color;
  g.fillText(profName, 128, 64);
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  spr.scale.set(1.9, 0.6, 1);
  return spr;
}

export class VillView {
  constructor(scene, atlasTex) {
    this.scene = scene;
    this.atlasTex = atlasTex;
    this.views = new Map();
    this.faceMats = {};
  }

  _faceMat(tile) {
    if (!this.faceMats[tile]) {
      const tex = this.atlasTex.clone();
      const o = tileOffset(tile);
      tex.repeat.set(o.ru, o.rv);
      tex.offset.set(o.u, o.v);
      tex.needsUpdate = true;
      this.faceMats[tile] = new THREE.MeshLambertMaterial({ map: tex });
    }
    return this.faceMats[tile];
  }

  _build(prof, name) {
    const p = PROFS[prof] || PROFS.ledig;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: p.body });
    const legMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(p.body).multiplyScalar(0.55) });
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.28), legMat);
    legs.position.y = 0.3;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.62, 0.32), bodyMat);
    body.position.y = 0.91;
    const skin = new THREE.MeshLambertMaterial({ color: 0xe2ba94 });
    const face = this._faceMat(p.face);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), [skin, skin, skin, skin, face, skin]);
    head.position.y = 1.45;
    const tag = tagSprite(name, p.name, '#ffd34d');
    tag.position.y = 2.15;
    g.add(legs, body, head, tag);
    return g;
  }

  sync(state, dt) {
    const seen = new Set();
    for (const [id, name, prof, x, y, z, heading, hp] of state) {
      seen.add(id);
      let v = this.views.get(id);
      if (v && v.prof !== prof) { this.scene.remove(v.group); this.views.delete(id); v = null; }
      if (!v) {
        const group = this._build(prof, name);
        group.position.set(x, y, z);
        this.scene.add(group);
        v = { group, prof, name, tx: x, ty: y, tz: z, heading, ph: Math.random() * 6 };
        this.views.set(id, v);
      }
      v.tx = x; v.ty = y; v.tz = z; v.heading = heading; v.hp = hp;
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) { this.scene.remove(v.group); this.views.delete(id); continue; }
      const g = v.group;
      const k = Math.min(1, dt * 10);
      const moving = Math.abs(v.tx - g.position.x) + Math.abs(v.tz - g.position.z) > 0.01;
      g.position.x += (v.tx - g.position.x) * k;
      g.position.y += (v.ty - g.position.y) * k;
      g.position.z += (v.tz - g.position.z) * k;
      let dh = v.heading - g.rotation.y;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      g.rotation.y += dh * Math.min(1, dt * 8);
      if (moving) {
        v.ph += dt * 9;
        g.scale.y = 1 + Math.sin(v.ph) * 0.04;
      }
    }
  }

  nearest(pos, maxDist = 3.5) {
    let best = null, bd = maxDist;
    for (const [id, v] of this.views) {
      const d = Math.hypot(v.group.position.x - pos.x, v.group.position.y - pos.y, v.group.position.z - pos.z);
      if (d < bd) { bd = d; best = { id, prof: v.prof, name: v.name, pos: v.group.position }; }
    }
    return best;
  }

  clear() {
    for (const [, v] of this.views) this.scene.remove(v.group);
    this.views.clear();
  }
}
