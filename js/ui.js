// VILDMARK — HUD & panels (DOM)
import { RES, RECIPES, SWORD, TOOL, TIER_NAME, PLACE } from './blocks.js';
import { SEASON_NAMES } from './env.js';

const $ = (id) => document.getElementById(id);
const icon = (name) => `assets/icons/${name}.png`;

export const PLAYER_COLORS = ['#e24a4a', '#4a90e2', '#4ac26b', '#e2b84a', '#b04ae2', '#e2854a'];

export class UI {
  constructor() {
    this.els = {};
    this._hbBuilt = false;
    this._lastHearts = -1;
    this.onCraft = null;
    this.onHotbarTap = null;
    this._buildHearts();
  }

  show(id) { $(id).classList.remove('hidden'); }
  hide(id) { $(id).classList.add('hidden'); }

  _buildHearts() {
    const box = $('hearts');
    box.innerHTML = '';
    this.heartImgs = [];
    for (let i = 0; i < 10; i++) {
      const im = document.createElement('img');
      im.src = icon('hp');
      im.className = 'pix';
      box.appendChild(im);
      this.heartImgs.push(im);
    }
  }

  setHearts(hp) {
    if (hp === this._lastHearts) return;
    this._lastHearts = hp;
    for (let i = 0; i < 10; i++) {
      const v = hp - i * 2;
      const im = this.heartImgs[i];
      if (v >= 2) { im.style.filter = ''; im.style.opacity = '1'; }
      else if (v === 1) { im.style.filter = 'saturate(1)'; im.style.opacity = '0.55'; }
      else { im.style.filter = 'grayscale(1)'; im.style.opacity = '0.25'; }
    }
  }

  buildHotbar(slotCount = 13) {
    const bar = $('hotbar');
    bar.innerHTML = '';
    this.slotEls = [];
    for (let i = 0; i < slotCount; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.dataset.idx = i;
      el.innerHTML = `<span class="kb">${i < 9 ? i + 1 : i === 9 ? '0' : ''}</span><span class="fist hidden">✊</span><img class="pix" draggable="false"><span class="cnt"></span>`;
      this._dragSource(el, () => this._hb && this._hb[i] && (this._hb[i].sword || this._hb[i].res) ? { fromIdx: i, ...this._hb[i] } : null, () => this.onSelect && this.onSelect(i));
      bar.appendChild(el);
      this.slotEls.push(el);
    }
    this._hbBuilt = true;
  }

  setHotbar(hotbar, inv, sel, sword) {
    if (!this._hbBuilt) this.buildHotbar(hotbar.length);
    this._hb = hotbar;
    hotbar.forEach((slot, i) => {
      const el = this.slotEls[i];
      const img = el.querySelector('img');
      const cnt = el.querySelector('.cnt');
      const fist = el.querySelector('.fist');
      el.classList.toggle('sel', i === sel);
      fist.classList.add('hidden');
      img.classList.remove('hidden');
      if (slot.sword) {
        if (sword > 0) {
          img.src = icon(SWORD[sword].icon);
          img.style.opacity = ''; img.style.filter = '';
          cnt.textContent = TIER_NAME[sword];
          el.title = SWORD[sword].name;
        } else {
          img.classList.add('hidden');
          fist.classList.remove('hidden');
          cnt.textContent = '';
          el.title = 'Näve — crafta ett svärd (E)!';
        }
        el.classList.remove('empty');
      } else if (slot.res) {
        const n = inv[slot.res] || 0;
        img.src = icon(RES[slot.res].icon);
        img.style.opacity = ''; img.style.filter = '';
        cnt.textContent = n > 0 ? n : '';
        el.classList.toggle('empty', n === 0);
        el.title = RES[slot.res].name;
      } else {
        img.classList.add('hidden');
        cnt.textContent = '';
        el.classList.remove('empty');
        el.title = 'Tom ruta — dra hit något från inventariet (I)';
      }
    });
  }

  // ---------- inventory panel + drag & drop ----------
  updateInventory(inv, sword, axe, pick) {
    const grid = $('invGrid');
    grid.innerHTML = '';
    for (const [key, def] of Object.entries(RES)) {
      const n = inv[key] || 0;
      const el = document.createElement('div');
      el.className = 'invItem' + (n === 0 ? ' dim' : '') + (PLACE[key] ? ' placeable' : '');
      el.innerHTML = `<img class="pix" src="${icon(def.icon)}"><span>${def.name}</span><span class="n">${n}</span>`;
      el.title = PLACE[key] ? def.name + ' — dra till baren för att kunna bygga!' : def.name;
      if (PLACE[key]) this._dragSource(el, () => ({ res: key }), null);
      grid.appendChild(el);
    }
    const eq = $('eqRow');
    eq.innerHTML = '';
    const items = [
      { label: 'Svärd', cur: sword, icons: SWORD.map((s) => s.icon), names: SWORD.map((s) => s.name), drag: { sword: true } },
      { label: 'Yxa', cur: axe, icons: TOOL.axe.icons, names: TIER_NAME.map((t) => t ? t + 'yxa' : 'Ingen yxa') },
      { label: 'Hacka', cur: pick, icons: TOOL.pick.icons, names: TIER_NAME.map((t) => t ? t + 'hacka' : 'Ingen hacka') },
    ];
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'invItem eq' + (it.cur === 0 ? ' dim' : '');
      el.innerHTML = it.cur > 0
        ? `<img class="pix" src="${icon(it.icons[it.cur])}"><span>${it.names[it.cur]}</span><span class="n">✔</span>`
        : `<span style="font-size:20px">${it.label === 'Svärd' ? '✊' : '✖'}</span><span>${it.names[0]}</span><span class="n" style="color:#8fa0c8">crafta!</span>`;
      el.title = it.label + (it.cur > 0 ? ': ' + it.names[it.cur] : ' saknas — öppna Tillverka (E)');
      if (it.drag && it.cur > 0) this._dragSource(el, () => it.drag, null);
      eq.appendChild(el);
    }
  }

  _dragSource(el, getPayload, onTap) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const payload = getPayload();
      const sx = e.clientX, sy = e.clientY;
      let dragging = false;
      const move = (ev) => {
        if (!dragging && payload && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
          dragging = true;
          this._ghostStart(payload, ev);
        }
        if (dragging) this._ghostMove(ev);
      };
      const up = (ev) => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        if (dragging) {
          this._ghostEnd();
          const t = document.elementFromPoint(ev.clientX, ev.clientY);
          const slot = t && t.closest && t.closest('.slot');
          if (slot && this.onAssign) this.onAssign(Number(slot.dataset.idx), payload);
        } else if (onTap) onTap();
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
  }

  _ghostStart(payload, e) {
    const g = document.createElement('img');
    g.className = 'dragGhost pix';
    g.src = payload.sword !== undefined && !payload.res
      ? icon('svard_tra')
      : icon(RES[payload.res]?.icon || 'planka');
    document.body.appendChild(g);
    this._ghost = g;
    this._ghostMove(e);
  }
  _ghostMove(e) {
    if (this._ghost) {
      this._ghost.style.left = (e.clientX - 20) + 'px';
      this._ghost.style.top = (e.clientY - 20) + 'px';
    }
  }
  _ghostEnd() {
    this._ghost?.remove();
    this._ghost = null;
  }

  setClock(day, season, isNight) {
    $('dayNum').textContent = day + 1;
    $('seasonName').textContent = SEASON_NAMES[season];
    $('clockIcon').textContent = isNight ? '🌙' : '☀️';
  }

  setHeartBar(heart) {
    if (!heart) { this.hide('heartBar'); return; }
    this.show('heartBar');
    $('heartFill').style.width = Math.max(0, (heart.hp / heart.max) * 100) + '%';
    $('heartTxt').textContent = `Hjärtsten ${Math.max(0, Math.ceil(heart.hp))}/${heart.max}`;
  }

  setPlayers(list) {
    const box = $('playersBox');
    box.innerHTML = '';
    for (const p of list) {
      const el = document.createElement('span');
      el.className = 'ptag';
      el.style.borderColor = p.color;
      el.textContent = `${p.name} ${'❤'.repeat(Math.max(0, Math.ceil(p.hp / 7)))}`;
      box.appendChild(el);
    }
  }

  toast(msg) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => el.remove(), 3100);
  }

  bigMsg(msg, color = '#ff6a6a') {
    const old = document.getElementById('bigMsg');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'bigMsg';
    el.style.color = color;
    el.textContent = msg;
    $('hud').appendChild(el);
    setTimeout(() => el.remove(), 4100);
  }

  damageFlash() {
    const f = $('dmgFlash');
    f.style.opacity = '1';
    setTimeout(() => { f.style.opacity = '0'; }, 130);
  }

  buildCraft(getInv, craftCb) {
    const list = $('recipeList');
    list.innerHTML = '';
    this._recipeEls = [];
    let lastCat = null;
    for (const r of RECIPES) {
      if (r.cat !== lastCat) {
        lastCat = r.cat;
        const h = document.createElement('div');
        h.style.cssText = 'font-weight:800;color:#ffd34d;margin:12px 0 2px;font-size:14px;letter-spacing:1px';
        h.textContent = '— ' + r.cat.toUpperCase() + ' —';
        list.appendChild(h);
      }
      const el = document.createElement('div');
      el.className = 'recipe';
      const costs = Object.entries(r.cost)
        .map(([res, n]) => `<span class="cost" data-res="${res}" data-n="${n}"><img class="pix" src="${icon(RES[res].icon)}">${n}</span>`)
        .join('');
      el.innerHTML = `<img class="out pix" src="${icon(r.icon)}"><div class="rinfo"><div class="rname">${r.name}</div><div class="rdesc">${r.desc}</div><div class="costs">${costs}</div></div><button class="craft">Gör</button>`;
      el.querySelector('button').addEventListener('click', () => craftCb(r));
      list.appendChild(el);
      this._recipeEls.push({ r, el });
    }
    this.updateCraft(getInv());
  }

  updateCraft(inv, sword = 0, axe = 0, pick = 0) {
    if (!this._recipeEls) return;
    const owned = { sword, axe, pick };
    for (const { r, el } of this._recipeEls) {
      let ok = true;
      el.querySelectorAll('.cost').forEach((c) => {
        const has = (inv[c.dataset.res] || 0) >= Number(c.dataset.n);
        c.classList.toggle('miss', !has);
        if (!has) ok = false;
      });
      if (r.out.sword && sword >= r.out.sword) ok = false;            // already owned
      if (r.out.tool && owned[r.out.tool] >= r.out.tier) ok = false;  // already owned
      el.querySelector('button').disabled = !ok;
    }
  }

  setCoins(n) {
    $('coinCnt').textContent = n;
  }

  interactHint(text) {
    const el = $('interactHint');
    if (!text) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (el.textContent !== text) el.textContent = text;
  }

  showDialog(menu, onPick) {
    $('villTitle').textContent = menu.title;
    $('villLines').innerHTML = menu.lines.map((l) => '<p>' + l + '</p>').join('');
    const box = $('villOpts');
    box.innerHTML = '';
    for (const o of menu.opts) {
      const b = document.createElement('button');
      b.className = 'mbtn';
      b.textContent = o.label;
      if (o.disabled) { b.disabled = true; b.style.opacity = '0.45'; }
      else b.addEventListener('click', () => { this.hideDialog(); onPick(o.k); });
      box.appendChild(b);
    }
    this.show('villPanel');
  }

  hideDialog() {
    this.hide('villPanel');
  }

  buildColorRow(rowId, onPick) {
    const row = $(rowId);
    row.innerHTML = '';
    let sel = localStorage.getItem('vildmark_color') || PLAYER_COLORS[0];
    PLAYER_COLORS.forEach((c) => {
      const el = document.createElement('div');
      el.className = 'sw' + (c === sel ? ' sel' : '');
      el.style.background = c;
      el.addEventListener('click', () => {
        row.querySelectorAll('.sw').forEach((s) => s.classList.remove('sel'));
        el.classList.add('sel');
        localStorage.setItem('vildmark_color', c);
        onPick(c);
      });
      row.appendChild(el);
    });
    onPick(sel);
  }
}
