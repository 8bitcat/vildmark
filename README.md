# VILDMARK

Ett co-op överlevnadsspel i webbläsaren för hela familjen — byggt med three.js.
Ni börjar i en liten by med ett starthus, en **Hjärtsten**, en **förrådskista**
och **Byäldste Ragnar**. Samla resurser, tillverka verktyg (händer → trä → sten
→ järn), bygg hus och försvara byn mot **vättar**, **troll** och **vätteskyttar**
om natten. Årstiderna växlar: på vintern fryser sjön till is som man kan gå på!

## Byn

- Monster släpper ibland **mynt** 🪙 — hos Byäldsten köper du **bybor** (20 mynt)
- Tillverka en arbetsstation (Skogshuggarbänk, Odlingslåda, Gruvstation, Vaktpost)
  och bygg ett **hus med tak** runt den
- Gå fram till en sysslolös bybo (F/💬) och ge hen jobbet — finns inget hus säger
  bybon åt dig att bygga ett först!
- Skogshuggare/bonde/gruvarbetare fyller **förrådskistan** i starthuset; vakten
  slåss mot monstren. Uppdrag: *jobba · följ med mig · stanna här · gå hem*
- Verktygsstege: sten kräver **hacka**, järn kräver **stenhacka**; yxor hugger
  träd snabbare. Allt börjar med att samla trä!

## Spela

- **Ny värld** — du blir värd och får en 4-teckens rumskod
- **Gå med** — övriga i familjen anger koden (eller skannar QR-koden) på sina enheter
- **Fortsätt värld** — världen sparas automatiskt hos värden (localStorage), var 25:e sekund
- **Exportera/Importera** — flytta världen mellan datorer som en JSON-fil

## Kontroller

| | Dator | Mobil/surfplatta |
|---|---|---|
| Gå | WASD / pilar | vänster joystick |
| Titta | mus | dra på högra halvan |
| Bryt block / attackera | vänster musknapp (håll) | ⛏️ (håll) |
| Placera block | höger musknapp | 🧱 |
| Hoppa | mellanslag | ⬆️ |
| Välj i hotbar | 1–9 / scrollhjul | tryck på rutan |
| Tillverka | E | 🛠️ |
| Ät äpple | Q | 🍎 |
| Prata / öppna kista | F | 💬 |

## Teknik

- three.js (voxelvärld, chunk-meshing med face culling, säsongstonade vertexfärger)
- PeerJS/WebRTC för co-op — värdens webbläsare är servern, ingen backend behövs
- Egen pixelart-atlas (`assets/atlas.png`), genererad av `tools/gen_atlas.py`
- Procedurellt ljud via WebAudio — inga ljudfiler
- Sparning: localStorage + export/import av JSON

## Utveckling

```bash
python tools/gen_atlas.py   # regenerera texturatlas + ikoner
node tools/server.js        # dev-server på http://localhost:8323
```

Debug-hookar i konsolen: `__DBG()`, `__SETTIME(sek)`, `__GIVE(res, n)`, `__SPAWN('vatte'|'troll'|'skytt')`, `__TP(x, z)`, `__NET()`.
Tidscykel: 480 s per dygn, 3 dygn per årstid (Vår → Sommar → Höst → Vinter).
