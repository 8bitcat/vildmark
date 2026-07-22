// VILDMARK — block & resource registry + atlas UV helpers

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, LOG: 6, LEAVES: 7,
  PLANKS: 8, WATER: 9, COAL: 10, IRON: 11, GOO: 12, TORCH: 13, HEART: 14, BEDROCK: 15,
};

// tiles: [top, side, bottom] atlas indices
export const DEF = {
  [B.GRASS]:   { name: 'Gräs',      tiles: [0, 1, 2],    hard: 0.55, hp: 8,   drop: { res: 'jord', n: 1 } },
  [B.DIRT]:    { name: 'Jord',      tiles: [2, 2, 2],    hard: 0.5,  hp: 8,   drop: { res: 'jord', n: 1 } },
  [B.STONE]:   { name: 'Sten',      tiles: [3, 3, 3],    hard: 1.7,  hp: 40,  drop: { res: 'sten', n: 1 } },
  [B.COBBLE]:  { name: 'Stenmur',   tiles: [4, 4, 4],    hard: 1.5,  hp: 40,  drop: { res: 'sten', n: 1 } },
  [B.SAND]:    { name: 'Sand',      tiles: [5, 5, 5],    hard: 0.45, hp: 6,   drop: { res: 'sand', n: 1 } },
  [B.LOG]:     { name: 'Stock',     tiles: [7, 6, 7],    hard: 1.0,  hp: 16,  drop: { res: 'stock', n: 1 } },
  [B.LEAVES]:  { name: 'Löv',       tiles: [9, 9, 9],    hard: 0.25, hp: 4,   drop: { res: 'apple', n: 1, chance: 0.12 } },
  [B.PLANKS]:  { name: 'Plankor',   tiles: [8, 8, 8],    hard: 0.9,  hp: 20,  drop: { res: 'planka', n: 1 } },
  [B.WATER]:   { name: 'Vatten',    tiles: [10, 10, 10], hard: 99,   hp: 999, drop: null },
  [B.COAL]:    { name: 'Kolådra',   tiles: [14, 14, 14], hard: 2.1,  hp: 50,  drop: { res: 'kol', n: 2 } },
  [B.IRON]:    { name: 'Järnådra',  tiles: [15, 15, 15], hard: 2.6,  hp: 60,  drop: { res: 'jarn', n: 1 } },
  [B.GOO]:     { name: 'Vätteblock', tiles: [16, 16, 16], hard: 0.5, hp: 10,  drop: { res: 'gooblock', n: 1 } },
  [B.TORCH]:   { name: 'Fackla',    tiles: [17, 17, 17], hard: 0.1,  hp: 2,   drop: { res: 'fackla', n: 1 }, cross: true },
  [B.HEART]:   { name: 'Hjärtsten', tiles: [18, 18, 18], hard: 1.2,  hp: 999, drop: { res: 'hjartsten', n: 1 } },
  [B.BEDROCK]: { name: 'Urberg',    tiles: [19, 19, 19], hard: -1,   hp: 9999, drop: null },
};

export const SNOW_TILE = 11, SNOWSIDE_TILE = 12, ICE_TILE = 13;
export const CRACK_TILES = [20, 21, 22];

export function isSolidId(id) {
  return id !== B.AIR && id !== B.WATER && id !== B.TORCH;
}

// resources (inventory keys)
export const RES = {
  jord:      { name: 'Jord',       icon: 'jord' },
  sten:      { name: 'Sten',       icon: 'sten' },
  sand:      { name: 'Sand',       icon: 'sand' },
  stock:     { name: 'Stock',      icon: 'stock' },
  planka:    { name: 'Planka',     icon: 'planka' },
  kol:       { name: 'Kol',        icon: 'kol' },
  jarn:      { name: 'Järn',       icon: 'jarn' },
  klump:     { name: 'Vätteslem',  icon: 'klump' },
  fackla:    { name: 'Fackla',     icon: 'fackla' },
  gooblock:  { name: 'Vätteblock', icon: 'gooblock' },
  hjartsten: { name: 'Hjärtsten',  icon: 'hjartsten' },
  apple:     { name: 'Äpple',      icon: 'apple' },
};

// what each placeable resource places
export const PLACE = {
  jord: B.DIRT, sten: B.COBBLE, sand: B.SAND, planka: B.PLANKS, stock: B.LOG,
  fackla: B.TORCH, gooblock: B.GOO, hjartsten: B.HEART,
};

export const SWORD = [
  { name: 'Näve',     dmg: 2,  icon: null },
  { name: 'Träsvärd', dmg: 5,  icon: 'svard_tra' },
  { name: 'Stensvärd', dmg: 8, icon: 'svard_sten' },
  { name: 'Järnsvärd', dmg: 13, icon: 'svard_jarn' },
];

export const RECIPES = [
  { id: 'planka',  name: '4 Plankor',   icon: 'planka',    out: { res: 'planka', n: 4 }, cost: { stock: 1 },            desc: 'Byggmaterial av trä' },
  { id: 'fackla',  name: '4 Facklor',   icon: 'fackla',    out: { res: 'fackla', n: 4 }, cost: { planka: 1, kol: 1 },   desc: 'Ljus i mörkret' },
  { id: 'svard1',  name: 'Träsvärd',    icon: 'svard_tra', out: { sword: 1 },            cost: { planka: 4 },           desc: 'Skada 5' },
  { id: 'svard2',  name: 'Stensvärd',   icon: 'svard_sten', out: { sword: 2 },           cost: { sten: 4, planka: 2 },  desc: 'Skada 8' },
  { id: 'svard3',  name: 'Järnsvärd',   icon: 'svard_jarn', out: { sword: 3 },           cost: { jarn: 4, planka: 2 },  desc: 'Skada 13' },
  { id: 'goob',    name: 'Vätteblock',  icon: 'gooblock',  out: { res: 'gooblock', n: 1 }, cost: { klump: 4 },          desc: 'Studsigt! Hoppa högt' },
  { id: 'hjarta',  name: 'Hjärtsten',   icon: 'hjartsten', out: { res: 'hjartsten', n: 1 }, cost: { planka: 6, sten: 6, klump: 2 }, desc: 'Basens hjärta — försvara den!' },
];

// ---- atlas UVs ----
const ACOLS = 8, AROWS = 4, AW = 128, AH = 64;
const EPS_U = 0.5 / AW, EPS_V = 0.5 / AH;

export function uvRect(tileIdx) {
  const c = tileIdx % ACOLS, r = Math.floor(tileIdx / ACOLS);
  return [
    c / ACOLS + EPS_U,            // u0
    1 - (r + 1) / AROWS + EPS_V,  // v0 (bottom)
    (c + 1) / ACOLS - EPS_U,      // u1
    1 - r / AROWS - EPS_V,        // v1 (top)
  ];
}
