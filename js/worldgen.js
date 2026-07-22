// VILDMARK — seeded infinite voxel world (chunk data + edits)
import { B, isSolidId } from './blocks.js';

export const CH = 16;   // chunk side
export const H = 48;    // world height
export const SEA = 13;  // water level

function hash2(seed, x, z) {
  let h = seed ^ (x * 374761393) ^ (z * 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash3(seed, x, y, z) {
  let h = seed ^ (x * 374761393) ^ (y * 2246822519) ^ (z * 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(seed, x, z, freq) {
  const fx = x * freq, fz = z * freq;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = smooth(fx - x0), tz = smooth(fz - z0);
  const a = hash2(seed, x0, z0), b = hash2(seed, x0 + 1, z0);
  const c = hash2(seed, x0, z0 + 1), d = hash2(seed, x0 + 1, z0 + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
function fbm(seed, x, z, freq) {
  return valueNoise(seed, x, z, freq) * 0.55
    + valueNoise(seed + 101, x, z, freq * 2.13) * 0.3
    + valueNoise(seed + 202, x, z, freq * 4.31) * 0.15;
}

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.chunks = new Map();     // "cx,cz" -> Uint8Array(CH*H*CH)
    this.edits = new Map();      // "x,y,z" -> id
    this.dirty = new Set();      // chunk keys needing remesh
    this.torches = new Set();    // "x,y,z" of torch blocks
    this.winterIce = false;
    this._findVillage();
    for (const [k, id] of this._villageBlocks()) {
      if (id === B.TORCH) this.torches.add(k);
    }
  }

  rawHeight(x, z) {
    const s = this.seed;
    let h = 13 + fbm(s, x, z, 1 / 42) * 14;
    const m = fbm(s + 999, x, z, 1 / 90);
    h += Math.pow(Math.max(0, m - 0.52) * 2.1, 2.6) * 30; // mountains
    const lake = fbm(s + 555, x, z, 1 / 70);
    if (lake > 0.62) h -= (lake - 0.62) * 34;             // lake basins
    return Math.max(2, Math.min(H - 10, Math.floor(h)));
  }

  height(x, z) {
    const raw = this.rawHeight(x, z);
    const v = this.village;
    if (!v) return raw;
    const d = Math.hypot(x - v.x, z - v.z);
    if (d < 9) return v.y;
    if (d < 16) {
      const t = (d - 9) / 7;
      return Math.round(v.y * (1 - t) + raw * t);
    }
    return raw;
  }

  _findVillage() {
    // deterministic: first lowland spot on a spiral from origin
    for (let r = 0; r < 30; r++) {
      for (let i = 0; i < Math.max(1, r * 6); i++) {
        const a = (i / Math.max(1, r * 6)) * Math.PI * 2;
        const x = Math.round(Math.sin(a) * r * 4), z = Math.round(Math.cos(a) * r * 4);
        const h = this.rawHeight(x, z);
        if (h >= SEA + 2 && h <= SEA + 7) {
          this.village = { x, z, y: h };
          return;
        }
      }
    }
    this.village = { x: 0, z: 0, y: Math.max(SEA + 2, this.rawHeight(0, 0)) };
  }

  // starter house: planks walls + log corners, roof, door, heart, chest, torches
  _villageBlocks() {
    if (this._vb) return this._vb;
    const m = new Map();
    const { x: vx, z: vz, y: vy } = this.village;
    const put = (x, y, z, id) => m.set(x + ',' + y + ',' + z, id);
    for (let x = vx - 3; x <= vx + 3; x++) {
      for (let z = vz - 3; z <= vz + 2; z++) {
        const wall = x === vx - 3 || x === vx + 3 || z === vz - 3 || z === vz + 2;
        put(x, vy, z, B.PLANKS);              // floor
        for (let y = vy + 1; y <= vy + 3; y++) {
          if (wall) {
            const corner = (x === vx - 3 || x === vx + 3) && (z === vz - 3 || z === vz + 2);
            put(x, y, z, corner ? B.LOG : B.PLANKS);
          } else {
            put(x, y, z, B.AIR);              // clear interior
          }
        }
        put(x, vy + 4, z, B.PLANKS);          // roof
      }
    }
    put(vx, vy + 1, vz + 2, B.AIR);           // door (south)
    put(vx, vy + 2, vz + 2, B.AIR);
    put(vx, vy + 1, vz - 2, B.HEART);         // heart inside, north wall
    put(vx + 2, vy + 1, vz - 2, B.CHEST);     // storage chest
    put(vx - 2, vy + 1, vz - 2, B.TORCH);     // torch inside
    put(vx - 1, vy + 1, vz + 3, B.TORCH);     // torches flanking door
    put(vx + 1, vy + 1, vz + 3, B.TORCH);
    this._vb = m;
    this.heartPos = { x: vx, y: vy + 1, z: vz - 2 };
    this.chestPos = { x: vx + 2, y: vy + 1, z: vz - 2 };
    this.elderPos = { x: vx - 1 + 0.5, y: vy + 1, z: vz + 0.5 };
    this.spawnPos = { x: vx + 0.5, y: vy + 1, z: vz + 4.5 };
    return m;
  }

  // one tree candidate per 7x7 cell
  treeAt(x, z) {
    const cellX = Math.floor(x / 7), cellZ = Math.floor(z / 7);
    const r = hash2(this.seed + 777, cellX, cellZ);
    if (r < 0.45) return null;
    const tx = cellX * 7 + Math.floor(hash2(this.seed + 778, cellX, cellZ) * 5) + 1;
    const tz = cellZ * 7 + Math.floor(hash2(this.seed + 779, cellX, cellZ) * 5) + 1;
    if (tx !== x || tz !== z) return null;
    if (this.village && Math.hypot(x - this.village.x, z - this.village.z) < 13) return null;
    const h = this.height(x, z);
    if (h <= SEA + 1) return null; // no trees on beach/under water
    return { x, z, y: h, trunk: 4 + Math.floor(hash2(this.seed + 780, x, z) * 3) };
  }

  genBlockAt(x, y, z, h) {
    if (y === 0) return B.BEDROCK;
    if (y < h - 3) {
      const o = hash3(this.seed, x, y, z);
      if (o < 0.045 && y < h - 4) return B.COAL;
      if (o > 0.985 && y < 11) return B.IRON;
      return B.STONE;
    }
    if (y < h) return B.DIRT;
    if (y === h) {
      if (h < SEA + 2) return B.SAND;
      return B.GRASS;
    }
    if (y <= SEA) return B.WATER;
    return B.AIR;
  }

  genChunk(cx, cz) {
    const key = cx + ',' + cz;
    let data = this.chunks.get(key);
    if (data) return data;
    data = new Uint8Array(CH * H * CH);
    const bx = cx * CH, bz = cz * CH;
    for (let lx = 0; lx < CH; lx++) {
      for (let lz = 0; lz < CH; lz++) {
        const x = bx + lx, z = bz + lz;
        const h = this.height(x, z);
        for (let y = 0; y < H; y++) {
          data[(lx * H + y) * CH + lz] = this.genBlockAt(x, y, z, h);
        }
      }
    }
    // trees whose leaves may reach into this chunk
    for (let x = bx - 3; x < bx + CH + 3; x++) {
      for (let z = bz - 3; z < bz + CH + 3; z++) {
        const t = this.treeAt(x, z);
        if (!t) continue;
        const top = t.y + t.trunk;
        for (let y = t.y + 1; y <= top; y++) this.stamp(data, bx, bz, x, y, z, B.LOG);
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            for (let dy = 0; dy <= 1; dy++) {
              if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && dy === 1) continue;
              if (dx === 0 && dz === 0 && dy === 0) continue;
              if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && hash3(this.seed, x + dx, top + dy, z + dz) < 0.4) continue;
              this.stampSoft(data, bx, bz, x + dx, top + dy, z + dz, B.LEAVES);
            }
          }
        }
        this.stampSoft(data, bx, bz, x, top + 1, z, B.LEAVES);
        this.stampSoft(data, bx, bz, x + 1, top + 1, z, B.LEAVES);
        this.stampSoft(data, bx, bz, x - 1, top + 1, z, B.LEAVES);
        this.stampSoft(data, bx, bz, x, top + 1, z + 1, B.LEAVES);
        this.stampSoft(data, bx, bz, x, top + 1, z - 1, B.LEAVES);
        this.stampSoft(data, bx, bz, x, top + 2, z, B.LEAVES);
      }
    }
    // village starter house (stamps over terrain/trees)
    const v = this.village;
    if (v && v.x + 6 >= bx - 3 && v.x - 6 <= bx + CH + 3 && v.z + 6 >= bz - 3 && v.z - 6 <= bz + CH + 3) {
      for (const [k, id] of this._villageBlocks()) {
        const [ex, ey, ez] = k.split(',').map(Number);
        if (ex >= bx && ex < bx + CH && ez >= bz && ez < bz + CH && ey >= 0 && ey < H) {
          data[((ex - bx) * H + ey) * CH + (ez - bz)] = id;
        }
      }
    }
    // apply saved edits inside this chunk
    for (const [k, id] of this.edits) {
      const [ex, ey, ez] = k.split(',').map(Number);
      if (ex >= bx && ex < bx + CH && ez >= bz && ez < bz + CH && ey >= 0 && ey < H) {
        data[((ex - bx) * H + ey) * CH + (ez - bz)] = id;
      }
    }
    this.chunks.set(key, data);
    return data;
  }

  stamp(data, bx, bz, x, y, z, id) {
    if (x < bx || x >= bx + CH || z < bz || z >= bz + CH || y < 0 || y >= H) return;
    data[((x - bx) * H + y) * CH + (z - bz)] = id;
  }
  stampSoft(data, bx, bz, x, y, z, id) {
    if (x < bx || x >= bx + CH || z < bz || z >= bz + CH || y < 0 || y >= H) return;
    const i = ((x - bx) * H + y) * CH + (z - bz);
    if (data[i] === B.AIR) data[i] = id;
  }

  getBlock(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return B.BEDROCK;
    if (y >= H) return B.AIR;
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    const data = this.genChunk(cx, cz);
    return data[((x - cx * CH) * H + y) * CH + (z - cz * CH)];
  }

  setBlock(x, y, z, id, recordEdit = true) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 1 || y >= H) return;
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
    const data = this.genChunk(cx, cz);
    const lx = x - cx * CH, lz = z - cz * CH;
    const old = data[(lx * H + y) * CH + lz];
    data[(lx * H + y) * CH + lz] = id;
    if (recordEdit) this.edits.set(x + ',' + y + ',' + z, id);
    const tk = x + ',' + y + ',' + z;
    if (id === B.TORCH) this.torches.add(tk);
    else if (old === B.TORCH) this.torches.delete(tk);
    this.dirty.add(cx + ',' + cz);
    if (lx === 0) this.dirty.add((cx - 1) + ',' + cz);
    if (lx === CH - 1) this.dirty.add((cx + 1) + ',' + cz);
    if (lz === 0) this.dirty.add(cx + ',' + (cz - 1));
    if (lz === CH - 1) this.dirty.add(cx + ',' + (cz + 1));
  }

  applyEdits(list) {
    for (const [x, y, z, id] of list) this.setBlock(x, y, z, id, true);
  }
  editsArray() {
    const out = [];
    for (const [k, id] of this.edits) {
      const [x, y, z] = k.split(',').map(Number);
      out.push([x, y, z, id]);
    }
    return out;
  }

  isIceAt(x, y, z) {
    if (!this.winterIce) return false;
    if (this.getBlock(x, y, z) !== B.WATER) return false;
    return this.getBlock(x, y + 1, z) !== B.WATER; // only the surface layer freezes
  }

  isSolid(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id === B.WATER) return this.isIceAt(Math.floor(x), Math.floor(y), Math.floor(z));
    return isSolidId(id);
  }

  surfaceY(x, z) {
    for (let y = H - 1; y > 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && id !== B.LEAVES) return y + 1;
    }
    return SEA + 2;
  }
}
