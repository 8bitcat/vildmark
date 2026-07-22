// VILDMARK — chunk meshing (culled faces, vertex tints, seasonal re-skin)
import * as THREE from 'three';
import { B, DEF, uvRect, SNOW_TILE, SNOWSIDE_TILE, ICE_TILE, isSolidId } from './blocks.js';
import { CH, H } from './worldgen.js';

// face layout: [-X, +X, -Y, +Y, -Z, +Z]
const FACES = [
  { dir: [-1, 0, 0], shade: 0.72, corners: [[[0, 1, 0], [0, 1]], [[0, 0, 0], [0, 0]], [[0, 1, 1], [1, 1]], [[0, 0, 1], [1, 0]]] },
  { dir: [1, 0, 0],  shade: 0.72, corners: [[[1, 1, 1], [0, 1]], [[1, 0, 1], [0, 0]], [[1, 1, 0], [1, 1]], [[1, 0, 0], [1, 0]]] },
  { dir: [0, -1, 0], shade: 0.55, corners: [[[1, 0, 1], [1, 0]], [[0, 0, 1], [0, 0]], [[1, 0, 0], [1, 1]], [[0, 0, 0], [0, 1]]] },
  { dir: [0, 1, 0],  shade: 1.0,  corners: [[[0, 1, 1], [1, 1]], [[1, 1, 1], [0, 1]], [[0, 1, 0], [1, 0]], [[1, 1, 0], [0, 0]]] },
  { dir: [0, 0, -1], shade: 0.84, corners: [[[1, 0, 0], [0, 0]], [[0, 0, 0], [1, 0]], [[1, 1, 0], [0, 1]], [[0, 1, 0], [1, 1]]] },
  { dir: [0, 0, 1],  shade: 0.84, corners: [[[0, 0, 1], [0, 0]], [[1, 0, 1], [1, 0]], [[0, 1, 1], [0, 1]], [[1, 1, 1], [1, 1]]] },
];

class GeoBuf {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = []; }
  quad(corners, normal, tile, tint, shade, yTopOffset = 0) {
    const [u0, v0, u1, v1] = uvRect(tile);
    const base = this.pos.length / 3;
    for (const [p, uv] of corners) {
      let py = p[1];
      if (yTopOffset && py === 1) py += yTopOffset;
      this.pos.push(p[0] + this._x, py + this._y, p[2] + this._z);
      this.nrm.push(normal[0], normal[1], normal[2]);
      this.uv.push(u0 + (u1 - u0) * uv[0], v0 + (v1 - v0) * uv[1]);
      this.col.push(tint[0] * shade, tint[1] * shade, tint[2] * shade);
    }
    this.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  at(x, y, z) { this._x = x; this._y = y; this._z = z; return this; }
  build() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const WHITE = [1, 1, 1];

export function buildChunkGeo(world, cx, cz, view) {
  // view: { winter: bool, grass:[r,g,b], leaves:[r,g,b] }
  const solid = new GeoBuf(), water = new GeoBuf();
  const bx = cx * CH, bz = cz * CH;
  for (let lx = 0; lx < CH; lx++) {
    for (let lz = 0; lz < CH; lz++) {
      const x = bx + lx, z = bz + lz;
      for (let y = 0; y < H; y++) {
        const id = world.getBlock(x, y, z);
        if (id === B.AIR) continue;

        if (id === B.TORCH) {
          emitTorch(solid, x, y, z);
          continue;
        }

        if (id === B.WATER) {
          if (world.isIceAt(x, y, z)) {
            emitCube(solid, world, x, y, z, ICE_TILE, ICE_TILE, ICE_TILE, WHITE, WHITE);
          } else {
            const above = world.getBlock(x, y + 1, z);
            if (above === B.AIR || (view.winter && above !== B.WATER)) {
              water.at(x, y, z).quad(FACES[3].corners, FACES[3].dir, DEF[B.WATER].tiles[0], WHITE, 1.0, -0.14);
            }
            for (const f of [0, 1, 4, 5]) {
              const F = FACES[f];
              const n = world.getBlock(x + F.dir[0], y, z + F.dir[2]);
              if (n === B.AIR || n === B.TORCH) {
                water.at(x, y, z).quad(F.corners, F.dir, DEF[B.WATER].tiles[0], WHITE, F.shade);
              }
            }
          }
          continue;
        }

        // solid cube blocks
        let tTop = DEF[id].tiles[0], tSide = DEF[id].tiles[1], tBot = DEF[id].tiles[2];
        let tintTop = WHITE, tintAll = WHITE;
        if (id === B.GRASS) {
          if (view.winter) { tTop = SNOW_TILE; tSide = SNOWSIDE_TILE; }
          else tintTop = view.grass;
        } else if (id === B.LEAVES) {
          tintAll = view.leaves;
        }
        emitCube(solid, world, x, y, z, tTop, tSide, tBot, tintTop, tintAll, id);
      }
    }
  }
  return { solid: solid.build(), water: water.build() };
}

function faceVisible(world, x, y, z, id) {
  const n = world.getBlock(x, y, z);
  if (n === B.AIR || n === B.TORCH) return true;
  if (n === B.WATER) return !world.isIceAt(x, y, z); // ice culls like a solid
  return false;
}

function emitCube(buf, world, x, y, z, tTop, tSide, tBot, tintTop, tintAll, id) {
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    if (!faceVisible(world, x + F.dir[0], y + F.dir[1], z + F.dir[2], id)) continue;
    let tile = tSide, tint = tintAll;
    if (f === 3) { tile = tTop; tint = tintTop === WHITE ? tintAll : tintTop; }
    if (f === 2) { tile = tBot; }
    buf.at(x, y, z).quad(F.corners, F.dir, tile, tint, F.shade);
  }
}

function emitTorch(buf, x, y, z) {
  const t = DEF[B.TORCH].tiles[0];
  const a = 0.16, b = 0.84;
  const quads = [
    [[[a, 0, a], [0, 0]], [[b, 0, b], [1, 0]], [[a, 1, a], [0, 1]], [[b, 1, b], [1, 1]]],
    [[[b, 0, b], [0, 0]], [[a, 0, a], [1, 0]], [[b, 1, b], [0, 1]], [[a, 1, a], [1, 1]]],
    [[[a, 0, b], [0, 0]], [[b, 0, a], [1, 0]], [[a, 1, b], [0, 1]], [[b, 1, a], [1, 1]]],
    [[[b, 0, a], [0, 0]], [[a, 0, b], [1, 0]], [[b, 1, a], [0, 1]], [[a, 1, b], [1, 1]]],
  ];
  for (const q of quads) buf.at(x, y, z).quad(q, [0, 1, 0], t, WHITE, 1.0);
}

export function makeMaterials(tex) {
  const solid = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, alphaTest: 0.45 });
  const water = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false });
  return { solid, water };
}
