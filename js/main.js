// VILDMARK — main: boot, menus, game loop, host logic, protocol
import * as THREE from 'three';
import { B, DEF, RES, SWORD, TOOL, PLACE, RECIPES, CRACK_TILES, tileOffset } from './blocks.js';
import { World, CH, H, SEA } from './worldgen.js';
import { buildChunkGeo, makeMaterials } from './mesher.js';
import { Player, HOTBAR } from './player.js';
import { Input } from './input.js';
import { Mobs, MOBT, MobView } from './mobs.js';
import { Villagers, VillView, PROFS, STATION_PROF, VILLAGER_COST, MAX_VILLAGERS } from './villagers.js';
import { Env, phaseOf, SEASON_TINT, SEASON_NAMES, CYCLE } from './env.js';
import { Net } from './net.js';
import * as SAVE from './save.js';
import { UI } from './ui.js';
import { Sfx } from './audio.js';

const $ = (id) => document.getElementById(id);
const RD = 3;            // render distance in chunks
const AUTOSAVE_S = 25;
const HEART_MAX = 100;

// ---------- three.js setup ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 420);
camera.rotation.order = 'YXZ';
scene.add(camera); // so the held-item group (child of camera) renders
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- globals ----------
const ui = new UI();
const sfx = new Sfx();
let net = null;
let world = null, player = null, env = null, mobs = null, mobView = null;
let mats = null, atlasTex = null;
let running = false;
let isHost = false;
let worldName = null;
let wt = CYCLE * 0.1; // world time (start morning)
let heart = null;     // {x,y,z,hp,max}
let myName = '', myColor = '#e24a4a';
let savedPlayers = {}; // name(lower) -> {inv,sword,hp,pos}
let remotes = new Map(); // peerId -> {name,color,view:{group,nameSpr},tx,ty,tz,yaw,hp,inv,sword,dead}
let chunkMeshes = new Map(); // "cx,cz" -> {solid,water}
let remeshQueue = [];
let lastSeason = -1, lastNight = null;
let mineTarget = null, mineProgress = 0, mineTick = 0;
let attackCd = 0, autosaveT = 0, posSendT = 0, mobSendT = 0, playersSendT = 0, timeSendT = 0;
let waveQueue = 0, waveTimer = 0, roamTimer = 10;
let uiOpen = false, paused = false, craftOpen = false;
let deathT = 0;
let crackMesh = null;
let villagers = null, villView = null;
let storage = {};           // village storage (host)
let villSendT = 0, hintT = 0, mineHintT = 0;
let heldGroup = null, heldKey = null, heldSwing = 0, heldT = 0;
const heldCache = new Map();

const input = new Input(canvas, {
  onHotbar: (i) => { if (player) { player.sel = i; refreshHud(); } },
  onHotbarDelta: (d) => { if (player) { player.sel = (player.sel + d + HOTBAR.length) % HOTBAR.length; refreshHud(); } },
  onToggleCraft: () => toggleCraft(),
  onPauseRequest: () => { if (running && !uiOpen) showPause(); },
  onEat: () => eatApple(),
  onInteract: () => tryInteract(),
  onManual: () => toggleManual(),
});
ui.onHotbarTap = (i) => { if (player) { player.sel = i; refreshHud(); } };

// ---------- helpers ----------
function seasonView(season) {
  const t = SEASON_TINT[season];
  return { winter: season === 3, grass: t.grass, leaves: t.leaves };
}

function chunkKey(cx, cz) { return cx + ',' + cz; }

function disposeChunk(key) {
  const m = chunkMeshes.get(key);
  if (!m) return;
  for (const k of ['solid', 'water']) {
    if (m[k]) { scene.remove(m[k]); m[k].geometry.dispose(); }
  }
  chunkMeshes.delete(key);
}

function remeshChunk(key) {
  const [cx, cz] = key.split(',').map(Number);
  const view = seasonView(phaseOf(wt).season);
  const geo = buildChunkGeo(world, cx, cz, view);
  disposeChunk(key);
  const entry = {};
  if (geo.solid) {
    entry.solid = new THREE.Mesh(geo.solid, mats.solid);
    scene.add(entry.solid);
  }
  if (geo.water) {
    entry.water = new THREE.Mesh(geo.water, mats.water);
    entry.water.renderOrder = 2;
    scene.add(entry.water);
  }
  chunkMeshes.set(key, entry);
}

function queueRemesh(key, front = false) {
  if (!remeshQueue.includes(key)) front ? remeshQueue.unshift(key) : remeshQueue.push(key);
}

function updateChunks() {
  const pcx = Math.floor(player.pos.x / CH), pcz = Math.floor(player.pos.z / CH);
  for (let dx = -RD; dx <= RD; dx++) {
    for (let dz = -RD; dz <= RD; dz++) {
      const key = chunkKey(pcx + dx, pcz + dz);
      if (!chunkMeshes.has(key) && !remeshQueue.includes(key)) remeshQueue.push(key);
    }
  }
  for (const key of chunkMeshes.keys()) {
    const [cx, cz] = key.split(',').map(Number);
    if (Math.abs(cx - pcx) > RD + 2 || Math.abs(cz - pcz) > RD + 2) disposeChunk(key);
  }
  for (const key of world.dirty) queueRemesh(key, true);
  world.dirty.clear();
  // nearest-first
  remeshQueue.sort((a, b) => {
    const [ax, az] = a.split(',').map(Number), [bx, bz] = b.split(',').map(Number);
    return (Math.abs(ax - pcx) + Math.abs(az - pcz)) - (Math.abs(bx - pcx) + Math.abs(bz - pcz));
  });
  let budget = 2;
  while (budget-- > 0 && remeshQueue.length) remeshChunk(remeshQueue.shift());
}

function findSpawn() {
  const s = world.spawnPos;
  return new THREE.Vector3(s.x, s.y + 0.2, s.z);
}

function respawnPoint() {
  if (heart) return new THREE.Vector3(heart.x + 0.5, heart.y + 1.2, heart.z + 0.5);
  return findSpawn();
}

// ---------- remote player avatars ----------
function nameSprite(name, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d');
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,0.45)';
  const w = Math.min(240, g.measureText(name).width + 26);
  g.beginPath(); g.roundRect(128 - w / 2, 8, w, 48, 12); g.fill();
  g.fillStyle = color;
  g.fillText(name, 128, 43);
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  spr.scale.set(2.2, 0.55, 1);
  return spr;
}

function buildAvatar(name, color) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const bodyMat = new THREE.MeshLambertMaterial({ color: c });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xe8c8a2 });
  const legMat = new THREE.MeshLambertMaterial({ color: c.clone().multiplyScalar(0.55) });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), legMat);
  legs.position.y = 0.35;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.7, 0.34), bodyMat);
  body.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), skinMat);
  head.position.y = 1.62;
  const spr = nameSprite(name, '#ffffff');
  spr.position.y = 2.25;
  g.add(legs, body, head, spr);
  return g;
}

function ensureRemote(id, name, color) {
  let r = remotes.get(id);
  if (!r) {
    const view = buildAvatar(name, color);
    scene.add(view);
    r = { name, color, view, tx: 0, ty: 0, tz: 0, yaw: 0, hp: 20, inv: {}, sword: 0, dead: false };
    remotes.set(id, r);
  }
  return r;
}

function dropRemote(id) {
  const r = remotes.get(id);
  if (r) { scene.remove(r.view); remotes.delete(id); }
}

// ---------- HUD ----------
function refreshHud() {
  ui.setHotbar(player.inv, player.sel, player.sword);
  ui.setHearts(Math.max(0, player.hp));
  ui.updateCraft(player.inv, player.sword, player.axe, player.pick);
  ui.setCoins(player.inv.mynt || 0);
}

function playersList() {
  const list = [{ name: myName, color: myColor, hp: player ? player.hp : 20 }];
  for (const [, r] of remotes) list.push({ name: r.name, color: r.color, hp: r.hp });
  return list;
}

// ---------- crack overlay ----------
function ensureCrack() {
  if (crackMesh) return;
  const geo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
  const tex = atlasTex.clone();
  const o = tileOffset(CRACK_TILES[0]);
  tex.repeat.set(o.ru, o.rv);
  tex.needsUpdate = true;
  crackMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  crackMesh.visible = false;
  scene.add(crackMesh);
}

function setCrack(x, y, z, stage) {
  ensureCrack();
  if (stage < 0) { crackMesh.visible = false; return; }
  const o = tileOffset(CRACK_TILES[Math.min(2, stage)]);
  crackMesh.material.map.offset.set(o.u, o.v);
  crackMesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  crackMesh.visible = true;
}

// ---------- game actions ----------
function tryMine(dt) {
  const hit = player.raycast();
  if (!hit) { mineTarget = null; setCrack(0, 0, 0, -1); return; }
  const def = DEF[hit.id];
  if (!def || def.hard < 0) { mineTarget = null; setCrack(0, 0, 0, -1); return; }
  // tool gate: stone-family needs a pickaxe (iron needs stone pick)
  let speed = 1;
  if (def.tool) {
    const tier = def.tool === 'axe' ? player.axe : player.pick;
    speed = TOOL[def.tool].speed[tier];
    if (speed <= 0) {
      mineTarget = null; setCrack(0, 0, 0, -1);
      mineHintT -= dt;
      if (mineHintT <= 0) {
        mineHintT = 2;
        const need = (def.tier || 1) === 2 ? 'en stenhacka' : 'en hacka';
        ui.toast(`⛏️ Du behöver ${need} för ${def.name}! (Tillverka i menyn — E)`);
      }
      return;
    }
    if (def.tool === 'pick' && player.pick < (def.tier || 1)) {
      mineTarget = null; setCrack(0, 0, 0, -1);
      mineHintT -= dt;
      if (mineHintT <= 0) {
        mineHintT = 2;
        ui.toast(`⛏️ ${def.name} kräver en stenhacka eller bättre!`);
      }
      return;
    }
  }
  const key = hit.x + ',' + hit.y + ',' + hit.z;
  if (mineTarget !== key) { mineTarget = key; mineProgress = 0; }
  mineProgress += dt * speed / def.hard;
  mineTick -= dt;
  if (mineTick <= 0) { mineTick = 0.22; sfx.play('dig'); heldSwing = 1; }
  setCrack(hit.x, hit.y, hit.z, Math.floor(mineProgress * 3));
  if (mineProgress >= 1) {
    mineTarget = null; mineProgress = 0;
    setCrack(0, 0, 0, -1);
    sfx.play('break');
    doMine(hit.x, hit.y, hit.z);
  }
}

// ---------- first-person held item ----------
// held items render ON TOP of the world (no depth test) so the hand never
// disappears inside the block you are hitting
function overlayMat(opts) {
  const m = new THREE.MeshBasicMaterial(opts);
  m.depthTest = false;
  m.depthWrite = false;
  return m;
}

function heldIconMesh(iconName) {
  const tex = new THREE.TextureLoader().load('assets/icons/' + iconName + '.png');
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.44),
    overlayMat({ map: tex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })
  );
  m.rotation.y = -0.5;
  m.renderOrder = 999;
  return m;
}

function heldBlockMesh(res) {
  const id = PLACE[res];
  const tiles = DEF[id].tiles;
  const mats6 = [];
  for (const t of [tiles[1], tiles[1], tiles[0], tiles[2], tiles[1], tiles[1]]) {
    const tex = atlasTex.clone();
    const o = tileOffset(t);
    tex.repeat.set(o.ru, o.rv);
    tex.offset.set(o.u, o.v);
    tex.needsUpdate = true;
    mats6.push(overlayMat({ map: tex }));
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), mats6);
  m.rotation.y = 0.6;
  m.renderOrder = 999;
  return m;
}

function heldFistMesh() {
  const g = new THREE.Group();
  const skin = overlayMat({ color: 0xe2ba94 });
  const sleeve = overlayMat({ color: 0x8a6a4a });
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.34), sleeve);
  arm.position.set(0.05, -0.06, 0.14);
  arm.renderOrder = 999;
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.14, 0.16), skin);
  hand.position.set(0, 0, -0.1);
  hand.renderOrder = 999;
  g.add(arm, hand);
  g.rotation.z = 0.25;
  g.rotation.y = -0.3;
  return g;
}

function updateHeld(dt) {
  if (!heldGroup) {
    heldGroup = new THREE.Group();
    heldGroup.position.set(0.5, -0.46, -0.85);
    camera.add(heldGroup);
  }
  heldT += dt;
  heldSwing = Math.max(0, heldSwing - dt * 5);
  // what to show: tool matching the mined block > selected sword > selected block > fist
  let key = 'fist';
  const slot = HOTBAR[player.sel];
  if (input.mine && mineTarget) {
    const id = world.getBlock(...mineTarget.split(',').map(Number));
    const def = DEF[id];
    if (def?.tool === 'axe' && player.axe > 0) key = 'icon:' + TOOL.axe.icons[player.axe];
    else if (def?.tool === 'pick' && player.pick > 0) key = 'icon:' + TOOL.pick.icons[player.pick];
    else if (slot.sword && player.sword > 0) key = 'icon:' + SWORD[player.sword].icon;
  } else if (slot.sword) {
    key = player.sword > 0 ? 'icon:' + SWORD[player.sword].icon : 'fist';
  } else if ((player.inv[slot.res] || 0) > 0) {
    key = 'block:' + slot.res;
  }
  if (key !== heldKey) {
    heldKey = key;
    heldGroup.clear();
    let mesh = heldCache.get(key);
    if (!mesh) {
      if (key === 'fist') mesh = heldFistMesh();
      else if (key.startsWith('icon:')) mesh = heldIconMesh(key.slice(5));
      else mesh = heldBlockMesh(key.slice(6));
      heldCache.set(key, mesh);
    }
    heldGroup.add(mesh);
  }
  // idle bob + swing
  const walk = Math.hypot(player.vel.x, player.vel.z);
  const bob = Math.sin(heldT * 7) * 0.012 * Math.min(1, walk / 4);
  const sw = Math.sin(heldSwing * Math.PI);
  heldGroup.position.set(0.5 - sw * 0.12, -0.46 + bob - sw * 0.08, -0.85 - sw * 0.08);
  heldGroup.rotation.z = -sw * 0.9;
  heldGroup.rotation.x = -sw * 0.5;
}

function doMine(x, y, z) {
  const id = world.getBlock(x, y, z);
  if (id === B.AIR) return;
  world.setBlock(x, y, z, B.AIR);
  if (isHost) hostMined('local', x, y, z, id);
  else net.send('mine', { x, y, z });
}

function hostMined(peer, x, y, z, id) {
  // drops
  const def = DEF[id];
  if (def?.drop) {
    const d = def.drop;
    if (!d.chance || Math.random() < d.chance) giveLoot(peer, d.res, d.n);
  }
  if (id === B.HEART && heart && heart.x === x && heart.y === y && heart.z === z) {
    heart = null;
    broadcastHeart();
    ui.setHeartBar(null);
  }
  if (STATION_PROF[id]) {
    const s = villagers.unregisterStation(x, y, z);
    if (s?.vid) broadcastToastAll('Arbetsstationen revs — bybon är sysslolös.');
  }
  net.broadcast('edit', { x, y, z, id: B.AIR }, peer === 'local' ? null : peer);
}

function giveLoot(peer, res, spec) {
  let n = Array.isArray(spec) ? spec[0] + Math.floor(Math.random() * (spec[1] - spec[0] + 1)) : spec;
  if (n <= 0) return;
  if (peer === 'local') {
    player.inv[res] = (player.inv[res] || 0) + n;
    ui.toast(`+${n} ${RES[res].name}`);
    sfx.play('loot');
    refreshHud();
  } else {
    net.sendTo(peer, 'loot', { res, n });
  }
}

function tryPlace() {
  const slot = HOTBAR[player.sel];
  if (!slot || slot.sword) return;
  const res = slot.res;
  if ((player.inv[res] || 0) <= 0) { ui.toast('Inget ' + RES[res].name + ' — tillverka eller samla!'); return; }
  const hit = player.raycast();
  if (!hit) return;
  const x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  if (y < 1 || y >= H - 1) return;
  const cur = world.getBlock(x, y, z);
  if (cur !== B.AIR && cur !== B.WATER) return;
  if (player.intersectsCell(x, y, z)) return;
  if (res === 'hjartsten' && heart) { ui.toast('Det finns redan en Hjärtsten!'); return; }
  player.inv[res]--;
  const id = PLACE[res];
  world.setBlock(x, y, z, id);
  sfx.play('place');
  heldSwing = 1;
  refreshHud();
  if (isHost) hostPlaced('local', x, y, z, id, res);
  else net.send('place', { x, y, z, res });
  syncSoon();
}

function hostPlaced(peer, x, y, z, id, res) {
  if (id === B.HEART) {
    if (heart) { // double heart — refund and revert
      world.setBlock(x, y, z, B.AIR);
      giveLoot(peer, 'hjartsten', 1);
      net.broadcast('edit', { x, y, z, id: B.AIR });
      return;
    }
    heart = { x, y, z, hp: HEART_MAX, max: HEART_MAX };
    broadcastHeart();
    ui.setHeartBar(heart);
    ui.toast('Hjärtstenen är placerad — försvara den!');
  }
  if (STATION_PROF[id]) {
    villagers.registerStation(x, y, z, id);
    sendToastTo(peer, `${DEF[id].name} byggd! Se till att den har tak, och prata sen med en sysslolös bybo.`);
  }
  net.broadcast('edit', { x, y, z, id }, peer === 'local' ? null : peer);
}

function tryAttack() {
  if (attackCd > 0) return false;
  // ray vs mob boxes (view positions)
  const o = player.eye(), d = player.dir();
  let best = null, bestT = 4.6;
  for (const [id, v] of mobView.views) {
    const t = MOBT[v.type];
    const cx = v.group.position.x, cy = v.group.position.y + t.h / 2, cz = v.group.position.z;
    // coarse sphere test
    const px = cx - o.x, py = cy - o.y, pz = cz - o.z;
    const proj = px * d.x + py * d.y + pz * d.z;
    if (proj < 0 || proj > bestT) continue;
    const dx = px - d.x * proj, dy = py - d.y * proj, dz = pz - d.z * proj;
    if (dx * dx + dy * dy + dz * dz < (t.w * 0.7 + 0.25) ** 2) { best = id; bestT = proj; }
  }
  if (best === null) return false;
  attackCd = 0.38;
  heldSwing = 1;
  const dmg = SWORD[player.sword].dmg;
  const kx = d.x, kz = d.z;
  sfx.play('mobhit');
  if (isHost) hostHitMob('local', best, dmg, kx, kz);
  else net.send('hitmob', { id: best, dmg, kx, kz });
  return true;
}

function hostHitMob(peer, id, dmg, kx, kz) {
  const m = mobs.hit(id, dmg, kx, kz);
  if (m) m.lastHit = peer;
}

function eatApple() {
  if (!player || player.dead) return;
  if ((player.inv.apple || 0) <= 0) { ui.toast('Inga äpplen — hugg löv från träden!'); return; }
  if (player.hp >= player.maxHp) { ui.toast('Du har full hälsa'); return; }
  player.inv.apple--;
  player.hp = Math.min(player.maxHp, player.hp + 5);
  sfx.play('eat');
  refreshHud();
  syncSoon();
}

// ---------- interaction: villagers, elder shop, storage chest ----------
function interactTarget() {
  const hit = player.raycast(4.5);
  if (hit && hit.id === B.CHEST) return { kind: 'chest' };
  const v = villView && villView.nearest(player.eye(), 3.6);
  if (v) return { kind: 'villager', id: v.id, name: v.name };
  return null;
}

function tryInteract() {
  if (!running || player.dead || uiOpen) return;
  const t = interactTarget();
  if (!t) return;
  if (t.kind === 'chest') {
    if (isHost) collectStorage('local');
    else net.send('collect', {});
    return;
  }
  if (isHost) {
    const menu = villagers.menu(t.id);
    if (menu) openDialog(menu);
  } else {
    net.send('vmenu', { id: t.id });
  }
}

function openDialog(menu) {
  uiOpen = true;
  if (!input.isTouch) document.exitPointerLock?.();
  ui.showDialog(menu, (k) => {
    uiOpen = false;
    input.requestLock();
    if (isHost) hostOrder('local', menu.vid, k);
    else {
      if (k === 'buy' && (player.inv.mynt || 0) < VILLAGER_COST) { ui.toast('För få mynt! Döda monster för att tjäna fler.'); return; }
      net.send('vorder', { id: menu.vid, k });
    }
  });
}

function hostOrder(peer, vid, k) {
  if (k === 'buy') {
    const elder = villagers.get(vid);
    if (!elder || !PROFS[elder.prof].elder) return;
    if (villagers.list.length >= MAX_VILLAGERS + 1) {
      sendToastTo(peer, 'Byn är full — max ' + MAX_VILLAGERS + ' bybor!');
      return;
    }
    if (peer === 'local') {
      if ((player.inv.mynt || 0) < VILLAGER_COST) { ui.toast('För få mynt! Döda monster för att tjäna fler.'); return; }
      player.inv.mynt -= VILLAGER_COST;
      refreshHud();
    } else {
      net.sendTo(peer, 'charge', { res: 'mynt', n: VILLAGER_COST });
    }
    const v = world.village;
    const nv = villagers.spawn(v.x + 0.5 + (Math.random() * 4 - 2), v.y + 1.2, v.z + 4.5 + Math.random() * 2, 'ledig');
    broadcastToastAll(`🧑 En ny bybo har anlänt: ${nv.name}! Prata med hen för att ge ett jobb.`);
    return;
  }
  const msg = villagers.order(vid, k, peer);
  if (msg) sendToastTo(peer, msg);
}

function sendToastTo(peer, msg) {
  if (peer === 'local') ui.toast(msg);
  else net.sendTo(peer, 'toastmsg', { msg });
}
function broadcastToastAll(msg) {
  ui.toast(msg);
  net.broadcast('toastmsg', { msg });
}

function collectStorage(peer) {
  const entries = Object.entries(storage).filter(([, n]) => n > 0);
  if (!entries.length) { sendToastTo(peer, 'Förrådskistan är tom — byborna fyller på när de jobbar.'); return; }
  for (const [res, n] of entries) giveLoot(peer, res, n);
  storage = {};
  sfxAt('craft', world.chestPos.x, world.chestPos.y, world.chestPos.z, 20);
}

let syncT = 0;
function syncSoon() { syncT = 0.2; }

function takeDamage(n) {
  if (player.dead) return;
  player.hp -= n;
  ui.damageFlash();
  sfx.play('hurt');
  refreshHud();
  if (player.hp <= 0) startDeath();
}

function startDeath() {
  player.dead = true;
  deathT = 5;
  sfx.play('death');
  ui.show('deathPanel');
  syncSoon();
}

function finishDeath() {
  player.dead = false;
  player.hp = player.maxHp;
  player.vel.set(0, 0, 0);
  player.pos.copy(respawnPoint());
  ui.hide('deathPanel');
  refreshHud();
  syncSoon();
}

// ---------- crafting ----------
function tryCraft(r) {
  for (const [res, n] of Object.entries(r.cost)) {
    if ((player.inv[res] || 0) < n) return;
  }
  for (const [res, n] of Object.entries(r.cost)) player.inv[res] -= n;
  if (r.out.sword) {
    player.sword = Math.max(player.sword, r.out.sword);
    ui.toast(SWORD[r.out.sword].name + ' tillverkat!');
  } else if (r.out.tool) {
    player[r.out.tool] = Math.max(player[r.out.tool], r.out.tier);
    ui.toast(r.name + ' tillverkad!');
  } else {
    player.inv[r.out.res] = (player.inv[r.out.res] || 0) + r.out.n;
    ui.toast(r.name + ' tillverkat!');
  }
  sfx.play('craft');
  refreshHud();
  syncSoon();
}

function toggleCraft() {
  if (!running) return;
  craftOpen = !craftOpen;
  uiOpen = craftOpen;
  if (craftOpen) {
    ui.show('craftPanel');
    ui.updateCraft(player.inv, player.sword);
    if (!input.isTouch) document.exitPointerLock?.();
  } else {
    ui.hide('craftPanel');
    input.requestLock();
  }
}

let manualOpen = false;
function toggleManual() {
  if (manualOpen) {
    manualOpen = false;
    ui.hide('manualPanel');
    if (running) { uiOpen = false; input.requestLock(); }
  } else {
    manualOpen = true;
    ui.show('manualPanel');
    if (running) { uiOpen = true; if (!input.isTouch) document.exitPointerLock?.(); }
  }
}

function showPause() {
  paused = true; uiOpen = true;
  $('pauseHint').textContent = isHost
    ? 'Du är värd — världen sparas automatiskt var 25:e sekund.'
    : 'Endast värden kan spara världen. Din gubbe sparas hos värden.';
  $('btnSaveNow').style.display = isHost ? '' : 'none';
  $('btnExport').style.display = isHost ? '' : 'none';
  ui.show('pausePanel');
}

function hidePause() {
  paused = false; uiOpen = false;
  ui.hide('pausePanel');
  input.requestLock();
}

// ---------- save ----------
function buildSaveState() {
  const players = { ...savedPlayers };
  players[myName.toLowerCase()] = {
    name: myName, inv: player.inv, sword: player.sword, axe: player.axe, pick: player.pick, hp: player.hp,
    pos: [player.pos.x, player.pos.y, player.pos.z],
  };
  for (const [, r] of remotes) {
    players[r.name.toLowerCase()] = {
      name: r.name, inv: r.inv, sword: r.sword, axe: r.axe || 0, pick: r.pick || 0, hp: r.hp, pos: [r.tx, r.ty, r.tz],
    };
  }
  return {
    v: 2, name: worldName, seed: world.seed, wt, savedAt: Date.now(),
    edits: world.editsArray(), heart, players,
    villagers: villagers.serialize(),
    stations: [...villagers.stations.entries()].map(([key, s]) => ({ key, type: s.type })),
    storage,
  };
}

function doSave(toastIt = false) {
  if (!isHost) return;
  const ok = SAVE.saveWorld(buildSaveState());
  if (toastIt) ui.toast(ok ? '💾 Världen sparad!' : 'Kunde inte spara (lagring full?)');
}

// ---------- host: waves & mobs ----------
function pickWaveType(day) {
  const r = Math.random();
  if (day >= 5 && r < 0.2) return 'skytt';
  if (day >= 2 && r < 0.45) return 'troll';
  return 'vatte';
}

function spawnAttacker(day) {
  if (mobs.list.length > 30) return;
  const center = heart || { x: player.pos.x, z: player.pos.z };
  const a = Math.random() * Math.PI * 2;
  const r = 22 + Math.random() * 12;
  const x = center.x + Math.sin(a) * r, z = center.z + Math.cos(a) * r;
  const y = world.surfaceY(Math.floor(x), Math.floor(z));
  mobs.spawn(pickWaveType(day), x, y + 0.1, z, true);
}

function hostTick(dt, ph) {
  // waves
  if (lastNight === false && ph.isNight) {
    const nPlayers = 1 + remotes.size;
    waveQueue = Math.min(26, 3 + ph.day * 2 + (nPlayers - 1) * 2);
    waveTimer = 2;
  }
  if (ph.isNight && waveQueue > 0) {
    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveTimer = (CYCLE * (1 - ph.dayFrac) * 0.55) / Math.max(1, waveQueue + 2);
      spawnAttacker(ph.day);
      waveQueue--;
    }
  }
  // daytime roamers
  roamTimer -= dt;
  if (!ph.isNight && roamTimer <= 0) {
    roamTimer = 16;
    const roamers = mobs.list.filter((m) => !m.nightMob).length;
    if (roamers < 3) {
      const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 25;
      const x = player.pos.x + Math.sin(a) * r, z = player.pos.z + Math.cos(a) * r;
      mobs.spawn('vatte', x, world.surfaceY(Math.floor(x), Math.floor(z)) + 0.1, z, false);
    }
  }
  // heart regen by day
  if (heart && !ph.isNight && heart.hp < heart.max) {
    heart.hp = Math.min(heart.max, heart.hp + dt * 2);
    if (Math.random() < dt) broadcastHeart();
    ui.setHeartBar(heart);
  }

  // elder returns at dawn if lost
  if (!ph.isNight && !villagers.elder()) {
    const e = world.elderPos;
    villagers.spawn(e.x, e.y + 0.2, e.z, 'aldste', 'Byäldste Ragnar');
    broadcastToastAll('🧙 Byäldste Ragnar är tillbaka i byn!');
  }

  // mob sim — mobs target players AND villagers ("v<id>" peers)
  const players = [{ peer: 'local', x: player.pos.x, y: player.pos.y, z: player.pos.z, hp: player.hp, dead: player.dead }];
  for (const [id, r] of remotes) players.push({ peer: id, x: r.tx, y: r.ty, z: r.tz, hp: r.hp, dead: r.dead });
  const targets = players.slice();
  for (const v of villagers.list) targets.push({ peer: 'vill:' + v.id, x: v.x, y: v.y, z: v.z, hp: v.hp, dead: false });
  mobs.update(dt, {
    players: targets, heart, isNight: ph.isNight, day: ph.day,
    cb: {
      damagePlayer: (peer, n) => {
        if (typeof peer === 'string' && peer.startsWith('vill:')) {
          const v = villagers.hit(Number(peer.slice(5)), n);
          if (v) sfxAt('hurt', v.x, v.y, v.z, 22);
          return;
        }
        if (peer === 'local') takeDamage(n);
        else net.sendTo(peer, 'dmg', { n });
      },
      editBlock: (x, y, z, id) => {
        world.setBlock(x, y, z, id);
        net.broadcast('edit', { x, y, z, id });
      },
      heartDamage: (n, m) => {
        if (!heart) return;
        heart.hp -= n;
        sfxAt('alarm', m.x, m.y, m.z, 40);
        if (heart.hp <= 0) {
          world.setBlock(heart.x, heart.y, heart.z, B.AIR);
          net.broadcast('edit', { x: heart.x, y: heart.y, z: heart.z, id: B.AIR });
          heart = null;
          ui.bigMsg('💔 Hjärtstenen är förstörd!');
          sfx.play('heartlost');
          net.broadcast('bigmsg', { msg: '💔 Hjärtstenen är förstörd!', snd: 'heartlost' });
        }
        broadcastHeart();
        ui.setHeartBar(heart);
      },
      mobGone: (m, killed) => {
        if (killed) {
          const t = MOBT[m.type];
          if (m.lastHit) {
            for (const [res, spec] of Object.entries(t.drops)) giveLoot(m.lastHit, res, spec);
          }
          sfxAt('mobdie', m.x, m.y, m.z, 30);
        }
      },
      sfx: (name, x, y, z) => sfxAt(name, x, y, z, 26),
    },
  });

  // villager sim
  villagers.update(dt, {
    players, mobs, village: world.village, isNight: ph.isNight,
    cb: {
      store: (res, n) => { storage[res] = (storage[res] || 0) + n; },
      toast: (msg) => broadcastToastAll(msg),
      sfx: (name, x, y, z) => sfxAt(name, x, y, z, 22),
      villagerDied: (v) => {
        broadcastToastAll(`💀 ${PROFS[v.prof].name} ${v.name} stupade!` + (PROFS[v.prof].elder ? ' Byäldsten återvänder i gryningen.' : ''));
        sfxAt('death', v.x, v.y, v.z, 30);
      },
    },
  });

  // broadcast state
  mobSendT -= dt;
  if (mobSendT <= 0) {
    mobSendT = 0.11;
    net.broadcast('mobs', mobs.state());
  }
  villSendT -= dt;
  if (villSendT <= 0) {
    villSendT = 0.13;
    net.broadcast('vill', villagers.state());
  }
  timeSendT -= dt;
  if (timeSendT <= 0) {
    timeSendT = 2;
    net.broadcast('time', { wt, heart });
  }
  autosaveT -= dt;
  if (autosaveT <= 0) { autosaveT = AUTOSAVE_S; doSave(false); }
}

function sfxAt(name, x, y, z, radius) {
  const d = Math.hypot(player.pos.x - x, player.pos.z - z);
  if (d < radius) sfx.play(name);
  net.broadcast('sound', { name, x, y, z, r: radius });
}

function broadcastHeart() {
  net.broadcast('heart', heart ? { ...heart, hp: Math.ceil(heart.hp) } : null);
}

function broadcastPlayers() {
  const list = [{ id: 'host', name: myName, color: myColor, p: [player.pos.x, player.pos.y, player.pos.z], yaw: player.yaw, hp: player.hp, dead: player.dead }];
  for (const [id, r] of remotes) list.push({ id, name: r.name, color: r.color, p: [r.tx, r.ty, r.tz], yaw: r.yaw, hp: r.hp, dead: r.dead });
  for (const [id] of net.conns) {
    net.sendTo(id, 'players', list.filter((e) => e.id !== id));
  }
}

// ---------- protocol ----------
function setupHostNet() {
  net.on({
    netError: () => {
      $('roomCode').textContent = 'offline';
      ui.toast('⚠️ Ingen kontakt med nätservern — spelar utan co-op');
    },
    peerOpen: () => { /* wait for hello */ },
    peerLeave: (peer) => {
      const r = remotes.get(peer);
      if (r) {
        savedPlayers[r.name.toLowerCase()] = { name: r.name, inv: r.inv, sword: r.sword, hp: r.hp, pos: [r.tx, r.ty, r.tz] };
        ui.toast(r.name + ' lämnade spelet');
      }
      dropRemote(peer);
      ui.setPlayers(playersList());
    },
    msg: (peer, t, d) => {
      switch (t) {
        case 'hello': {
          const r = ensureRemote(peer, (d.name || 'Spelare').slice(0, 12), d.color || '#4a90e2');
          const saved = savedPlayers[r.name.toLowerCase()] || null;
          const sp = saved?.pos ? saved.pos : (() => { const s = respawnPoint(); return [s.x, s.y, s.z]; })();
          r.tx = sp[0]; r.ty = sp[1]; r.tz = sp[2];
          if (saved) { r.inv = saved.inv || {}; r.sword = saved.sword || 0; r.hp = saved.hp ?? 20; }
          net.sendTo(peer, 'init', {
            seed: world.seed, wt, edits: world.editsArray(), heart,
            you: { pos: sp, inv: saved?.inv || null, sword: saved?.sword || 0, axe: saved?.axe || 0, pick: saved?.pick || 0, hp: saved?.hp ?? 20 },
          });
          ui.toast(r.name + ' gick med i spelet!');
          ui.setPlayers(playersList());
          broadcastPlayers();
          break;
        }
        case 'pos': {
          const r = remotes.get(peer);
          if (r) { r.tx = d.p[0]; r.ty = d.p[1]; r.tz = d.p[2]; r.yaw = d.yaw; r.hp = d.hp; r.dead = !!d.dead; }
          break;
        }
        case 'mine': {
          const id = world.getBlock(d.x, d.y, d.z);
          if (id !== B.AIR) {
            world.setBlock(d.x, d.y, d.z, B.AIR);
            hostMined(peer, d.x, d.y, d.z, id);
          }
          break;
        }
        case 'place': {
          const id = PLACE[d.res];
          if (!id) break;
          const cur = world.getBlock(d.x, d.y, d.z);
          if (cur === B.AIR || cur === B.WATER) {
            world.setBlock(d.x, d.y, d.z, id);
            hostPlaced(peer, d.x, d.y, d.z, id, d.res);
          } else {
            giveLoot(peer, d.res, 1); // refund
            net.sendTo(peer, 'edit', { x: d.x, y: d.y, z: d.z, id: cur });
          }
          break;
        }
        case 'hitmob': hostHitMob(peer, d.id, Math.min(20, d.dmg), d.kx, d.kz); break;
        case 'sync': {
          const r = remotes.get(peer);
          if (r) { r.inv = d.inv; r.sword = d.sword; r.hp = d.hp; if (d.axe !== undefined) { r.axe = d.axe; r.pick = d.pick; } }
          break;
        }
        case 'collect': collectStorage(peer); break;
        case 'vmenu': {
          const menu = villagers.menu(d.id);
          if (menu) net.sendTo(peer, 'vmenu', menu);
          break;
        }
        case 'vorder': hostOrder(peer, d.id, d.k); break;
      }
    },
  });
}

function setupClientNet(onInit) {
  net.on({
    msg: (peer, t, d) => {
      switch (t) {
        case 'init': onInit(d); break;
        case 'edit': world && world.setBlock(d.x, d.y, d.z, d.id); break;
        case 'mobs': mobView && mobView.sync(d, 1 / 9); mobView && (mobView._last = d); break;
        case 'time': {
          if (Math.abs(d.wt - wt) > 2.5) wt = d.wt; else wt += (d.wt - wt) * 0.3;
          heart = d.heart;
          ui.setHeartBar(heart);
          break;
        }
        case 'players': {
          const seen = new Set();
          for (const e of d) {
            seen.add(e.id);
            const r = ensureRemote(e.id, e.name, e.color);
            r.tx = e.p[0]; r.ty = e.p[1]; r.tz = e.p[2]; r.yaw = e.yaw; r.hp = e.hp; r.dead = e.dead;
          }
          for (const id of [...remotes.keys()]) if (!seen.has(id)) dropRemote(id);
          ui.setPlayers(playersList());
          break;
        }
        case 'dmg': takeDamage(d.n); break;
        case 'loot': {
          player.inv[d.res] = (player.inv[d.res] || 0) + d.n;
          ui.toast(`+${d.n} ${RES[d.res].name}`);
          sfx.play('loot');
          refreshHud();
          break;
        }
        case 'heart': {
          heart = d;
          ui.setHeartBar(heart);
          break;
        }
        case 'sound': {
          const dist = Math.hypot(player.pos.x - d.x, player.pos.z - d.z);
          if (dist < d.r) sfx.play(d.name);
          break;
        }
        case 'bigmsg': {
          ui.bigMsg(d.msg);
          if (d.snd) sfx.play(d.snd);
          break;
        }
        case 'toastmsg': ui.toast(d.msg); break;
        case 'vill': villView && (villView._last = d); break;
        case 'vmenu': openDialog(d); break;
        case 'charge': {
          player.inv[d.res] = Math.max(0, (player.inv[d.res] || 0) - d.n);
          refreshHud();
          break;
        }
      }
    },
    hostLost: () => {
      ui.bigMsg('⚠️ Tappade kontakten med värden');
      setTimeout(() => location.reload(), 3500);
    },
  });
}

// ---------- game start ----------
async function loadAtlas() {
  if (atlasTex) return;
  atlasTex = await new THREE.TextureLoader().loadAsync('assets/atlas.png');
  atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.minFilter = THREE.NearestFilter;
  atlasTex.generateMipmaps = false;
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  mats = makeMaterials(atlasTex);
}

function commonStart() {
  env = new Env(scene);
  mobView = new MobView(scene, atlasTex);
  villView = new VillView(scene, atlasTex);
  ui.buildHotbar();
  ui.buildCraft(() => player.inv, tryCraft);
  refreshHud();
  ui.setPlayers(playersList());
  ui.hide('menu'); ui.hide('loading');
  ui.show('hud');
  $('crosshair').classList.remove('hidden');
  if (input.isTouch) ui.show('touchUI');
  input.enabled = true;
  running = true;
  lastSeason = phaseOf(wt).season;
  lastNight = phaseOf(wt).isNight;
  world.winterIce = lastSeason === 3;
  if (!input.isTouch) setTimeout(() => input.requestLock(), 100);
  // first time playing? open the handbook
  if (!localStorage.getItem('vildmark_manual_seen')) {
    localStorage.setItem('vildmark_manual_seen', '1');
    setTimeout(() => { if (!manualOpen) toggleManual(); }, 800);
  }
}

async function startHost(save) {
  isHost = true;
  ui.show('loading');
  await loadAtlas();
  const seed = save ? save.seed : (Math.random() * 0xffffffff) >>> 0;
  world = new World(seed);
  if (save) {
    worldName = save.name;
    wt = save.wt || CYCLE * 0.1;
    world.applyEdits(save.edits || []);
    world.dirty.clear();
    heart = save.heart || null;
    savedPlayers = save.players || {};
  }
  mobs = new Mobs(world);
  villagers = new Villagers(world);
  storage = (save && save.storage) || {};
  if (save) {
    villagers.restore(save.villagers, save.stations);
    // older saves: recover stations from placed blocks
    for (const [k, id] of world.edits) {
      if (STATION_PROF[id] && !villagers.stations.has(k)) {
        const [x, y, z] = k.split(',').map(Number);
        villagers.registerStation(x, y, z, id);
      }
    }
  }
  if (!villagers.elder()) {
    const e = world.elderPos;
    villagers.spawn(e.x, e.y + 0.2, e.z, 'aldste', 'Byäldste Ragnar');
  }
  if (!save) {
    // one free helper to teach the mechanic
    const v = world.village;
    villagers.spawn(v.x - 1.5, v.y + 1.2, v.z + 4.5, 'ledig');
  }
  // heart: default to the village heart block if present and no saved heart
  if (save) heart = save.heart || null;
  if (!heart && world.getBlock(world.heartPos.x, world.heartPos.y, world.heartPos.z) === B.HEART) {
    heart = { ...world.heartPos, hp: HEART_MAX, max: HEART_MAX };
  }
  player = new Player(world);
  const me = savedPlayers[myName.toLowerCase()];
  if (me?.pos) {
    player.pos.set(me.pos[0], me.pos[1] + 0.1, me.pos[2]);
    player.inv = { ...player.inv, ...me.inv };
    player.sword = me.sword || 0;
    player.axe = me.axe || 0;
    player.pick = me.pick || 0;
    player.hp = me.hp ?? 20;
  } else {
    player.pos.copy(findSpawn());
  }
  // starter kit for brand-new worlds
  if (!save) {
    player.inv.planka = 4;
    player.inv.fackla = 2;
  }
  net = new Net();
  setupHostNet();
  net.host((code) => {
    $('roomCode').textContent = code;
    updateQR(code);
  });
  ui.setHeartBar(heart);
  commonStart();
  doSave(false);
}

async function startClient(code) {
  isHost = false;
  ui.show('loading');
  $('loadingTxt').textContent = 'Ansluter till ' + code + '…';
  await loadAtlas();
  net = new Net();
  let inited = false;
  setupClientNet((d) => {
    if (inited) return;
    inited = true;
    world = new World(d.seed);
    world.applyEdits(d.edits || []);
    world.dirty.clear();
    wt = d.wt;
    heart = d.heart;
    player = new Player(world);
    player.pos.set(d.you.pos[0], d.you.pos[1] + 0.1, d.you.pos[2]);
    if (d.you.inv) player.inv = { ...player.inv, ...d.you.inv };
    player.sword = d.you.sword || 0;
    player.axe = d.you.axe || 0;
    player.pick = d.you.pick || 0;
    player.hp = d.you.hp ?? 20;
    $('roomCode').textContent = code;
    updateQR(code);
    ui.setHeartBar(heart);
    commonStart();
  });
  net.join(code, () => {
    net.send('hello', { name: myName, color: myColor });
    $('loadingTxt').textContent = 'Hämtar världen…';
  }, (why) => {
    ui.hide('loading');
    ui.show('panelJoin');
    $('joinStatus').textContent = why === 'timeout' || why === 'peer-unavailable'
      ? 'Hittade inget spel med koden ' + code + '. Kolla att värden är igång.'
      : 'Kunde inte ansluta (' + why + '). Testa igen.';
  });
}

function updateQR(code) {
  const url = location.origin + location.pathname + '?join=' + code;
  $('qrCode').textContent = code;
  $('qrImg').src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(url);
  $('qrLink').textContent = url;
}

// ---------- main loop ----------
let lastT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  let dt = Math.min(0.06, (now - lastT) / 1000);
  lastT = now;
  if (!running) { renderer.render(scene, camera); return; }

  wt += dt;
  const ph = phaseOf(wt);

  // season / night transitions
  if (ph.season !== lastSeason) {
    lastSeason = ph.season;
    world.winterIce = ph.season === 3;
    for (const key of chunkMeshes.keys()) queueRemesh(key);
    const msgs = ['🌸 Våren är här — isen smälter!', '☀️ Sommaren är här!', '🍂 Hösten är här — löven faller', '❄️ Vintern är här — sjön har frusit till is!'];
    ui.bigMsg(msgs[ph.season], '#9fd8ff');
  }
  if (ph.isNight !== lastNight) {
    lastNight = ph.isNight;
    if (ph.isNight) {
      ui.bigMsg('🌙 Natten kommer — vättarna anfaller!');
      sfx.play('night');
    } else {
      ui.bigMsg('☀️ Ni klarade natten! Dag ' + (ph.day + 1), '#ffe08a');
      sfx.play('day');
    }
  }

  // input → player
  if (!player.dead && !uiOpen) {
    const [ldx, ldy] = input.consumeLook();
    player.applyLook(ldx, ldy);
    player.update(dt, input, sfx);
    attackCd = Math.max(0, attackCd - dt);
    if (input.mine) {
      if (!tryAttack()) tryMine(dt);
    } else {
      mineTarget = null;
      if (crackMesh) crackMesh.visible = false;
    }
    if (input.placePressed()) tryPlace();
    if (player.hp <= 0 && !player.dead) startDeath();
  } else {
    input.consumeLook();
    input.placePressed();
    if (player.dead) {
      deathT -= dt;
      $('deathCount').textContent = Math.ceil(deathT);
      if (deathT <= 0) finishDeath();
    }
  }

  camera.position.copy(player.eye());
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  updateChunks();
  env.update(wt, camera, dt);
  env.syncTorches(world.torches, camera.position, heart, 0);
  sfx.ambience(ph.isNight, ph.season, dt);
  ui.setClock(ph.day, ph.season, ph.isNight);

  // remote avatars lerp
  for (const [, r] of remotes) {
    const g = r.view;
    const k = Math.min(1, dt * 12);
    g.position.x += (r.tx - g.position.x) * k;
    g.position.y += (r.ty - g.position.y) * k;
    g.position.z += (r.tz - g.position.z) * k;
    g.rotation.y = r.yaw + Math.PI;
    g.visible = !r.dead;
  }

  // networking ticks
  posSendT -= dt;
  if (posSendT <= 0) {
    posSendT = 0.085;
    const msg = { p: [+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2)], yaw: +player.yaw.toFixed(2), hp: player.hp, dead: player.dead };
    if (isHost) { /* host state goes out via broadcastPlayers */ } else net.send('pos', msg);
  }
  syncT -= dt;
  if (syncT <= 0 && syncT > -999) {
    syncT = -1000;
    if (!isHost && net.hostConn) net.send('sync', { inv: player.inv, sword: player.sword, axe: player.axe, pick: player.pick, hp: player.hp });
  }
  if (isHost) {
    hostTick(dt, ph);
    playersSendT -= dt;
    if (playersSendT <= 0) {
      playersSendT = 0.085;
      broadcastPlayers();
    }
    // host renders mobs/villagers from sim state directly
    mobView.sync(mobs.state(), dt);
    villView.sync(villagers.state(), dt);
  } else {
    if (mobView._last) mobView.sync(mobView._last, dt);
    if (villView._last) villView.sync(villView._last, dt);
  }

  updateHeld(dt);

  // interact hint (F / 💬)
  hintT -= dt;
  if (hintT <= 0) {
    hintT = 0.15;
    if (!uiOpen && !player.dead) {
      const t = interactTarget();
      if (!t) ui.interactHint(null);
      else if (t.kind === 'chest') ui.interactHint((input.isTouch ? '💬' : 'F') + ' · Öppna förrådskistan');
      else ui.interactHint((input.isTouch ? '💬' : 'F') + ' · Prata med ' + (t.name || 'bybon'));
    } else ui.interactHint(null);
  }

  ui.setPlayers(playersList());
  renderer.render(scene, camera);
}
loop();

// ---------- menus ----------
function persistIdentity(nameEl) {
  myName = ($(nameEl).value.trim() || 'Spelare').slice(0, 12);
  localStorage.setItem('vildmark_name', myName);
}
for (const el of ['inpName', 'inpNameJ', 'inpNameC']) {
  $(el).value = localStorage.getItem('vildmark_name') || '';
}
ui.buildColorRow('colorRow', (c) => { myColor = c; });
ui.buildColorRow('colorRowJ', (c) => { myColor = c; });

$('btnNew').addEventListener('click', () => {
  ui.hide('menu'); ui.show('panelNew');
  if (!$('inpWorldName').value) $('inpWorldName').value = 'Vår värld';
});
$('btnBackNew').addEventListener('click', () => { ui.hide('panelNew'); ui.show('menu'); });
$('btnStartNew').addEventListener('click', () => {
  sfx.ensure();
  persistIdentity('inpName');
  worldName = ($('inpWorldName').value.trim() || 'Vår värld').slice(0, 24);
  let n = worldName, i = 2;
  while (SAVE.loadWorld(n)) n = worldName + ' ' + i++;
  worldName = n;
  ui.hide('panelNew');
  startHost(null);
});

$('btnJoinMenu').addEventListener('click', () => { ui.hide('menu'); ui.show('panelJoin'); });
$('btnBackJoin').addEventListener('click', () => { ui.hide('panelJoin'); ui.show('menu'); });
$('btnDoJoin').addEventListener('click', () => {
  sfx.ensure();
  persistIdentity('inpNameJ');
  const code = $('inpCode').value.trim().toUpperCase();
  if (code.length !== 4) { $('joinStatus').textContent = 'Koden är 4 tecken.'; return; }
  ui.hide('panelJoin');
  startClient(code);
});

$('btnContinue').addEventListener('click', () => {
  ui.hide('menu'); ui.show('panelContinue');
  renderWorldList();
});
$('btnBackCont').addEventListener('click', () => { ui.hide('panelContinue'); ui.show('menu'); });

function renderWorldList() {
  const box = $('worldList');
  const worlds = SAVE.listWorlds();
  box.innerHTML = worlds.length ? '' : '<p class="hint">Inga sparade världar ännu.</p>';
  for (const w of worlds) {
    const row = document.createElement('div');
    row.className = 'worldRow';
    const when = w.savedAt ? new Date(w.savedAt).toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    row.innerHTML = `<div class="winfo"><div class="wname">🌍 ${w.name}</div><div class="wmeta">Dag ${w.day + 1} · ${w.edits} ändringar · ${when}</div></div>`;
    const bPlay = document.createElement('button'); bPlay.textContent = '▶ Spela';
    const bExp = document.createElement('button'); bExp.textContent = '📤';
    const bDel = document.createElement('button'); bDel.textContent = '🗑';
    bPlay.addEventListener('click', () => {
      sfx.ensure();
      persistIdentity('inpNameC');
      const save = SAVE.loadWorld(w.name);
      if (!save) return;
      worldName = w.name;
      ui.hide('panelContinue');
      startHost(save);
    });
    bExp.addEventListener('click', () => SAVE.exportWorld(w.name));
    bDel.addEventListener('click', () => {
      if (confirm('Radera världen "' + w.name + '"? Det går inte att ångra.')) {
        SAVE.deleteWorld(w.name);
        renderWorldList();
      }
    });
    row.append(bPlay, bExp, bDel);
    box.appendChild(row);
  }
}

$('btnImport').addEventListener('click', () => $('fileImport').click());
$('fileImport').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const name = await SAVE.importWorld(f);
    ui.hide('menu'); ui.show('panelContinue');
    renderWorldList();
    ui.toast?.('Importerade "' + name + '"');
  } catch {
    alert('Kunde inte läsa filen — är det en VILDMARK-export?');
  }
  e.target.value = '';
});

// pause & misc
$('btnResume').addEventListener('click', hidePause);
$('btnSaveNow').addEventListener('click', () => doSave(true));
$('btnExport').addEventListener('click', () => { doSave(false); SAVE.exportWorld(worldName); });
$('btnMute').addEventListener('click', () => {
  sfx.ensure();
  sfx.setMuted(!sfx.muted);
  $('btnMute').textContent = sfx.muted ? '🔇 Ljud: av' : '🔊 Ljud: på';
});
$('btnLeave').addEventListener('click', () => {
  if (isHost) doSave(false);
  location.reload();
});
$('btnCloseCraft').addEventListener('click', () => toggleCraft());
$('btnCloseVill').addEventListener('click', () => { ui.hideDialog(); uiOpen = false; input.requestLock(); });
$('btnManualMenu').addEventListener('click', () => toggleManual());
$('btnManualHud').addEventListener('click', () => toggleManual());
$('btnCloseManual').addEventListener('click', () => toggleManual());
$('btnQR').addEventListener('click', () => { uiOpen = true; ui.show('qrBox'); if (!input.isTouch) document.exitPointerLock?.(); });
$('btnCloseQR').addEventListener('click', () => { uiOpen = false; ui.hide('qrBox'); input.requestLock(); });
addEventListener('pagehide', () => { if (isHost && running) doSave(false); });
$('btnMute').textContent = sfx.muted ? '🔇 Ljud: av' : '🔊 Ljud: på';

// ?join=CODE deep link
const joinCode = new URLSearchParams(location.search).get('join');
if (joinCode) {
  ui.hide('menu');
  ui.show('panelJoin');
  $('inpCode').value = joinCode.toUpperCase().slice(0, 4);
}

// ---------- debug hooks ----------
window.__DBG = () => ({
  running, isHost, wt, ph: phaseOf(wt), pos: player && player.pos.toArray(), hp: player?.hp,
  axe: player?.axe, pick: player?.pick, sword: player?.sword,
  chunks: chunkMeshes.size, queue: remeshQueue.length, mobs: mobs?.list.length ?? (mobView?._last?.m.length || 0),
  conns: net ? (net.mode === 'host' ? net.conns.size : (net.hostConn?.open ? 1 : 0)) : 0,
  heart, inv: player?.inv,
});
window.__SETTIME = (t) => { wt = t; };
window.__GIVE = (res, n) => { player.inv[res] = (player.inv[res] || 0) + n; refreshHud(); };
window.__SPAWN = (type, d = 6) => {
  if (!isHost) return 'host only';
  const x = player.pos.x + Math.sin(player.yaw) * -d, z = player.pos.z + Math.cos(player.yaw) * -d;
  mobs.spawn(type || 'vatte', x, world.surfaceY(Math.floor(x), Math.floor(z)) + 0.1, z, true);
};
window.__TP = (x, z) => { player.pos.set(x, world.surfaceY(Math.floor(x), Math.floor(z)) + 0.3, z); };
window.__NET = () => net;
window.__W = () => world;
window.__VILL = () => ({ list: villagers?.list, stations: villagers ? [...villagers.stations.entries()] : [], storage, views: villView?.views.size });
window.__ORDER = (vid, k) => hostOrder('local', vid, k);
window.__MENU = (vid) => villagers?.menu(vid);
window.__COLLECT = () => collectStorage('local');
window.__P = () => player;
window.__INPUT = () => input;
window.__CRAFT = (id) => { const r = RECIPES.find((x) => x.id === id); if (r) tryCraft(r); };
window.__PLACE = (x, y, z, res) => {
  if ((player.inv[res] || 0) <= 0) return 'no ' + res;
  player.inv[res]--;
  const id = PLACE[res];
  world.setBlock(x, y, z, id);
  refreshHud();
  if (isHost) hostPlaced('local', x, y, z, id, res);
  else net.send('place', { x, y, z, res });
};
window.__MINE = (x, y, z) => doMine(x, y, z);
