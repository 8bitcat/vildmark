# VILDMARK — texture atlas generator (original pixel art, designed in code)
# Output: assets/atlas.png (8x4 tiles of 16x16 = 128x64, RGBA)
#         assets/icons/*.png (64x64 nearest-upscaled HUD icons)
import os, random
from PIL import Image

T = 16
COLS, ROWS = 8, 4
rng = random.Random(4711)

atlas = Image.new("RGBA", (COLS * T, ROWS * T), (0, 0, 0, 0))

def tile(idx):
    img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    return img, idx

def put(img, idx):
    x = (idx % COLS) * T
    y = (idx // COLS) * T
    atlas.paste(img, (x, y))

def fill(img, c):
    for x in range(T):
        for y in range(T):
            img.putpixel((x, y), c)

def speckle(img, colors, n, r=None):
    r = r or rng
    for _ in range(n):
        x, y = r.randrange(T), r.randrange(T)
        img.putpixel((x, y), r.choice(colors))

def px(img, x, y, c):
    if 0 <= x < T and 0 <= y < T:
        img.putpixel((x, y), c)

# ---- 0 grass_top (near-grayscale green, tinted per season in-game) ----
img, i = tile(0)
fill(img, (168, 178, 160, 255))
speckle(img, [(148, 158, 140, 255), (186, 196, 178, 255), (158, 170, 150, 255)], 90)
for _ in range(14):  # small blade strokes
    x, y = rng.randrange(T), rng.randrange(T)
    px(img, x, y, (196, 206, 186, 255))
    px(img, x, y + 1, (140, 152, 132, 255))
put(img, 0)

# ---- 2 dirt (drawn before grass_side which reuses it) ----
dirt = Image.new("RGBA", (T, T))
fill(dirt, (121, 85, 58, 255))
speckle(dirt, [(101, 68, 44, 255), (140, 102, 70, 255), (91, 60, 38, 255), (150, 112, 80, 255)], 110)
put(dirt, 2)

# ---- 1 grass_side (dirt + fixed-green top fringe) ----
img = dirt.copy()
greens = [(88, 160, 66, 255), (72, 140, 54, 255), (104, 176, 80, 255)]
for x in range(T):
    depth = 3 + (rng.randrange(3) if x % 2 else rng.randrange(2))
    for y in range(depth):
        img.putpixel((x, y), greens[(x + y) % 3])
put(img, 1)

# ---- 3 stone ----
stone = Image.new("RGBA", (T, T))
fill(stone, (125, 127, 133, 255))
speckle(stone, [(108, 110, 116, 255), (140, 142, 148, 255), (98, 100, 106, 255)], 90)
for _ in range(4):  # crack strokes
    x, y = rng.randrange(T - 4), rng.randrange(T - 3)
    for k in range(3 + rng.randrange(3)):
        px(stone, x + k, y + (k // 2), (92, 94, 100, 255))
put(stone, 3)

# ---- 4 cobblestone ----
img, _ = tile(4)
fill(img, (72, 74, 80, 255))  # mortar
stones = [(1, 1, 6, 5), (8, 1, 14, 6), (1, 7, 5, 13), (7, 8, 13, 14), (12, 8, 15, 12), (0, 8, 0, 13), (8, 15, 13, 15), (1, 15, 5, 15), (15, 1, 15, 5)]
for (x0, y0, x1, y1) in stones:
    base = rng.choice([(128, 130, 138), (116, 118, 126), (138, 140, 148)])
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            c = base
            if x == x0 or y == y0:
                c = (min(base[0] + 18, 255), min(base[1] + 18, 255), min(base[2] + 18, 255))
            if x == x1 or y == y1:
                c = (base[0] - 16, base[1] - 16, base[2] - 16)
            px(img, x, y, (*c, 255))
put(img, 4)

# ---- 5 sand ----
img, _ = tile(5)
fill(img, (216, 197, 138, 255))
speckle(img, [(200, 180, 118, 255), (230, 212, 156, 255), (190, 170, 108, 255)], 100)
put(img, 5)

# ---- 6 log_side (vertical bark) ----
img, _ = tile(6)
cols = [(96, 66, 40), (82, 55, 32), (110, 78, 48), (88, 60, 36), (74, 49, 28), (104, 72, 44), (92, 62, 38), (80, 53, 31)]
for x in range(T):
    base = cols[x % 8]
    for y in range(T):
        c = base
        if rng.random() < 0.12:
            c = (base[0] - 12, base[1] - 10, base[2] - 8)
        img.putpixel((x, y), (*c, 255))
put(img, 6)

# ---- 7 log_top (rings) ----
img, _ = tile(7)
fill(img, (176, 141, 87, 255))
ring_cols = [(150, 117, 68, 255), (196, 160, 104, 255), (150, 117, 68, 255), (196, 160, 104, 255), (130, 99, 56, 255)]
for ring, rc in enumerate(ring_cols):
    r0 = 2 + ring * 1.4
    for x in range(T):
        for y in range(T):
            d = max(abs(x - 7.5), abs(y - 7.5))
            if abs(d - r0) < 0.55:
                img.putpixel((x, y), rc)
for x in range(T):  # bark rim
    for y in range(T):
        if x in (0, 15) or y in (0, 15):
            img.putpixel((x, y), (96, 66, 40, 255))
put(img, 7)

# ---- 8 planks (horizontal boards) ----
img, _ = tile(8)
board = [(191, 151, 90), (178, 139, 80), (200, 160, 98), (170, 132, 76)]
for y in range(T):
    b = board[(y // 4) % 4]
    for x in range(T):
        c = b
        if y % 4 == 3:
            c = (120, 90, 52)
        elif rng.random() < 0.08:
            c = (b[0] - 14, b[1] - 12, b[2] - 8)
        img.putpixel((x, y), (*c, 255))
for (nx, ny) in [(2, 1), (13, 5), (3, 9), (12, 13)]:  # nails
    px(img, nx, ny, (110, 84, 50, 255))
put(img, 8)

# ---- 9 leaves (near-grayscale, tinted per season) ----
img, _ = tile(9)
fill(img, (150, 162, 144, 255))
speckle(img, [(122, 136, 116, 255), (172, 184, 164, 255), (104, 118, 100, 255), (188, 200, 180, 255)], 150)
put(img, 9)

# ---- 10 water ----
img, _ = tile(10)
fill(img, (56, 108, 190, 255))
for _ in range(8):
    x, y = rng.randrange(T - 5), rng.randrange(T)
    for k in range(3 + rng.randrange(3)):
        px(img, x + k, y, (92, 146, 220, 255))
speckle(img, [(46, 94, 172, 255)], 20)
put(img, 10)

# ---- 11 snow ----
img, _ = tile(11)
fill(img, (240, 246, 252, 255))
speckle(img, [(222, 232, 244, 255), (250, 253, 255, 255), (210, 224, 240, 255)], 60)
put(img, 11)

# ---- 12 snow_side (dirt + snow cap) ----
img = dirt.copy()
for x in range(T):
    depth = 3 + (1 if x % 3 == 0 else 0)
    for y in range(depth):
        img.putpixel((x, y), (240, 246, 252, 255))
    img.putpixel((x, depth), (214, 226, 240, 255))
put(img, 12)

# ---- 13 ice ----
img, _ = tile(13)
fill(img, (168, 208, 238, 255))
speckle(img, [(150, 194, 230, 255), (188, 222, 246, 255)], 50)
for _ in range(4):  # cracks
    x, y = rng.randrange(T - 5), rng.randrange(T - 5)
    for k in range(4 + rng.randrange(3)):
        px(img, x + k, y + k, (216, 238, 252, 255))
put(img, 13)

# ---- 14 coal_ore / 15 iron_ore ----
for idx, (c1, c2) in [(14, ((28, 28, 32), (58, 58, 64))), (15, ((206, 158, 106), (166, 120, 72)))]:
    img = stone.copy()
    for _ in range(4):
        x, y = 2 + rng.randrange(T - 5), 2 + rng.randrange(T - 5)
        for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1), (2, 0), (0, 2)]:
            if rng.random() < 0.8:
                px(img, x + dx, y + dy, (*c1, 255))
        px(img, x, y, (*c2, 255))
    put(img, idx)

# ---- 16 goo block (vätteblock, bouncy) ----
img, _ = tile(16)
fill(img, (87, 196, 67, 255))
for x in range(T):
    for y in range(T):
        if x in (0, 15) or y in (0, 15):
            img.putpixel((x, y), (47, 143, 38, 255))
speckle(img, [(142, 232, 122, 255), (110, 214, 90, 255)], 26)
for (bx, by) in [(4, 4), (10, 8), (6, 11), (11, 3)]:  # bubbles
    px(img, bx, by, (170, 240, 150, 255))
    px(img, bx + 1, by, (142, 232, 122, 255))
put(img, 16)

# ---- 17 torch (cross-quad texture, transparent bg) ----
img, _ = tile(17)
for y in range(6, 16):
    for x in (7, 8):
        img.putpixel((x, y), (120, 88, 52, 255) if x == 7 else (96, 68, 40, 255))
flame = [(7, 2, (255, 232, 120)), (8, 2, (255, 214, 84)), (6, 3, (255, 196, 60)), (7, 3, (255, 240, 160)), (8, 3, (255, 232, 120)), (9, 3, (255, 186, 48)), (6, 4, (250, 160, 40)), (7, 4, (255, 214, 84)), (8, 4, (255, 196, 60)), (9, 4, (244, 148, 32)), (7, 5, (240, 132, 28)), (8, 5, (230, 118, 24)), (7, 1, (255, 246, 190))]
for (x, y, c) in flame:
    img.putpixel((x, y), (*c, 255))
put(img, 17)

# ---- 18 hjärtsten (heart stone / base core) ----
img = stone.copy()
for x in range(T):
    for y in range(T):
        if x in (0, 15) or y in (0, 15):
            img.putpixel((x, y), (88, 90, 96, 255))
heart_px = []
for (x, y) in [(5, 4), (6, 4), (9, 4), (10, 4), (4, 5), (7, 5), (8, 5), (11, 5), (4, 6), (11, 6), (4, 7), (11, 7), (5, 8), (10, 8), (6, 9), (9, 9), (7, 10), (8, 10)]:
    heart_px.append((x, y))
# fill interior
inner = [(x, y) for x in range(4, 12) for y in range(4, 11)]
def inside_heart(x, y):
    return (5 <= x <= 10 and 5 <= y <= 7) or (6 <= x <= 9 and y == 8) or (7 <= x <= 8 and y == 9)
for (x, y) in inner:
    if inside_heart(x, y):
        px(img, x, y, (232, 72, 96, 255))
for (x, y) in heart_px:
    px(img, x, y, (150, 34, 52, 255))
px(img, 6, 5, (255, 150, 168, 255))
px(img, 7, 6, (255, 120, 140, 255))
put(img, 18)

# ---- 19 bedrock ----
img, _ = tile(19)
fill(img, (52, 52, 58, 255))
speckle(img, [(38, 38, 44, 255), (70, 70, 78, 255), (28, 28, 34, 255)], 120)
put(img, 19)

# ---- 20/21/22 crack overlays ----
for stage in range(3):
    img, _ = tile(20 + stage)
    n = 8 + stage * 12
    r2 = random.Random(99 + stage)
    pts = [(7, 7)]
    for _ in range(n):
        bx, by = r2.choice(pts)
        nx, ny = bx + r2.choice([-1, 0, 1]), by + r2.choice([-1, 0, 1])
        if 0 <= nx < T and 0 <= ny < T:
            pts.append((nx, ny))
            px(img, nx, ny, (20, 16, 12, 190))
    put(img, 20 + stage)

# ---- 23 apple ----
img, _ = tile(23)
body = [(x, y) for x in range(5, 11) for y in range(6, 13)]
for (x, y) in body:
    if (x, y) not in [(5, 6), (10, 6), (5, 12), (10, 12)]:
        px(img, x, y, (214, 40, 40, 255))
for (x, y) in [(6, 7), (6, 8), (7, 7)]:
    px(img, x, y, (255, 120, 110, 255))
for (x, y) in [(9, 11), (9, 12), (8, 12)]:
    px(img, x, y, (160, 24, 24, 255))
px(img, 8, 5, (110, 74, 40, 255))
px(img, 8, 4, (110, 74, 40, 255))
for (x, y) in [(9, 3), (10, 3), (10, 4)]:
    px(img, x, y, (92, 168, 60, 255))
put(img, 23)

# ---- 24/25/26 swords (wood/stone/iron), diagonal blade ----
def sword(idx, blade, blade_hi):
    img, _ = tile(idx)
    for k in range(9):
        x, y = 3 + k, 12 - k
        px(img, x, y, (*blade, 255))
        px(img, x + 1, y, (*blade_hi, 255))
    px(img, 12, 3, (*blade_hi, 255))
    # guard
    for (x, y) in [(4, 10), (5, 11), (6, 12), (3, 11), (4, 12)]:
        px(img, x, y, (120, 88, 52, 255))
    # handle
    for (x, y) in [(3, 13), (2, 14), (1, 15), (2, 13)]:
        px(img, x, y, (86, 60, 36, 255))
    put(img, idx)

sword(24, (172, 132, 78), (208, 168, 106))
sword(25, (120, 122, 130), (168, 170, 178))
sword(26, (198, 202, 212), (238, 240, 246))

# ---- 27 vätte face ----
img, _ = tile(27)
fill(img, (96, 178, 74, 255))
for x in range(T):
    for y in range(T):
        if x in (0, 15) or y in (0, 15):
            img.putpixel((x, y), (66, 132, 50, 255))
for (x, y) in [(3, 5), (4, 5), (3, 6), (4, 6), (11, 5), (12, 5), (11, 6), (12, 6)]:  # eyes
    px(img, x, y, (250, 240, 90, 255))
for (x, y) in [(4, 6), (11, 6)]:  # pupils
    px(img, x, y, (30, 30, 30, 255))
for (x, y) in [(2, 4), (13, 4)]:  # brow
    px(img, x, y, (56, 110, 42, 255))
for x in range(5, 11):  # grin
    px(img, x, 10, (40, 80, 32, 255))
for (x, y) in [(5, 9), (7, 11), (9, 11), (10, 9)]:  # teeth/jagged
    px(img, x, y, (240, 240, 230, 255))
put(img, 27)

# ---- 28 troll face ----
img, _ = tile(28)
fill(img, (122, 134, 150, 255))
for x in range(T):
    for y in range(T):
        if x in (0, 15) or y in (0, 15):
            img.putpixel((x, y), (88, 98, 112, 255))
for x in range(2, 14):  # heavy brow
    px(img, x, 4, (74, 84, 98, 255))
    px(img, x, 5, (74, 84, 98, 255))
for (x, y) in [(4, 6), (5, 6), (10, 6), (11, 6)]:  # eyes
    px(img, x, y, (255, 150, 60, 255))
for (x, y) in [(7, 8), (8, 8), (7, 9), (8, 9)]:  # nose
    px(img, x, y, (104, 114, 130, 255))
for x in range(4, 12):  # mouth
    px(img, x, 12, (60, 68, 80, 255))
for (x, y) in [(4, 11), (11, 11)]:  # tusks
    px(img, x, y, (235, 230, 210, 255))
    px(img, x, y - 1, (235, 230, 210, 255))
put(img, 28)

# ---- 29 skytt (goo-thrower) face ----
img, _ = tile(29)
fill(img, (74, 150, 60, 255))
for x in range(T):  # dark hood
    for y in range(T):
        if x in (0, 15) or y in (0, 15) or y < 4 or (y < 6 and (x < 3 or x > 12)):
            img.putpixel((x, y), (42, 74, 40, 255))
for (x, y) in [(4, 7), (5, 7), (10, 7), (11, 7)]:  # glowing eyes
    px(img, x, y, (190, 255, 120, 255))
for x in range(6, 10):  # small mouth
    px(img, x, 11, (36, 64, 34, 255))
put(img, 29)

# ---- 30 goo projectile / klump item ----
img, _ = tile(30)
blob = [(x, y) for x in range(5, 11) for y in range(6, 12)]
for (x, y) in blob:
    if (x, y) not in [(5, 6), (10, 6), (5, 11), (10, 11)]:
        px(img, x, y, (87, 196, 67, 255))
for (x, y) in [(6, 7), (7, 7), (6, 8)]:
    px(img, x, y, (150, 235, 130, 255))
for (x, y) in [(9, 10), (9, 11), (4, 8), (11, 9), (7, 12)]:
    px(img, x, y, (60, 158, 48, 255))
put(img, 30)

# ---- 31 heart (HP icon) ----
img, _ = tile(31)
hp = [(4, 4), (5, 3), (6, 4), (7, 5), (8, 5), (9, 4), (10, 3), (11, 4), (3, 5), (12, 5), (3, 6), (12, 6), (3, 7), (12, 7), (4, 8), (11, 8), (5, 9), (10, 9), (6, 10), (9, 10), (7, 11), (8, 11)]
for (x, y) in hp:
    px(img, x, y, (140, 24, 40, 255))
for x in range(4, 12):
    for y in range(4, 11):
        if inside_heart(x, y - 0):
            pass
# fill heart interior manually
for (x, y) in [(4, 5), (5, 5), (6, 5), (9, 5), (10, 5), (11, 5), (4, 6), (5, 6), (6, 6), (7, 6), (8, 6), (9, 6), (10, 6), (11, 6), (4, 7), (5, 7), (6, 7), (7, 7), (8, 7), (9, 7), (10, 7), (11, 7), (5, 8), (6, 8), (7, 8), (8, 8), (9, 8), (10, 8), (6, 9), (7, 9), (8, 9), (9, 9), (7, 10), (8, 10)]:
    px(img, x, y, (226, 58, 78, 255))
px(img, 5, 5, (255, 150, 168, 255))
px(img, 6, 6, (255, 120, 140, 255))
put(img, 31)

out_dir = os.path.join(os.path.dirname(__file__), "..", "assets")
os.makedirs(out_dir, exist_ok=True)
atlas_path = os.path.join(out_dir, "atlas.png")
atlas.save(atlas_path)
print("atlas ->", os.path.abspath(atlas_path), atlas.size)

# ---- HUD icons: crop tiles, upscale x4 nearest ----
icons = {
    "jord": 2, "sten": 4, "sand": 5, "stock": 6, "planka": 8, "kol": 14, "jarn": 15,
    "fackla": 17, "klump": 30, "gooblock": 16, "hjartsten": 18, "apple": 23,
    "svard_tra": 24, "svard_sten": 25, "svard_jarn": 26, "hp": 31, "vatte": 27, "troll": 28, "skytt": 29,
}
icon_dir = os.path.join(out_dir, "icons")
os.makedirs(icon_dir, exist_ok=True)
for name, idx in icons.items():
    x = (idx % COLS) * T
    y = (idx // COLS) * T
    im = atlas.crop((x, y, x + T, y + T)).resize((64, 64), Image.NEAREST)
    im.save(os.path.join(icon_dir, name + ".png"))
print("icons ->", len(icons))

# ---- favicon (vätte face 32x32) ----
fx = (27 % COLS) * T
fy = (27 // COLS) * T
atlas.crop((fx, fy, fx + T, fy + T)).resize((32, 32), Image.NEAREST).save(os.path.join(out_dir, "favicon.png"))
print("favicon done")
