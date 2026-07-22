// VILDMARK — HUD & panels (DOM)
import { RES, RECIPES, SWORD } from './blocks.js';
import { HOTBAR } from './player.js';
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

  buildHotbar() {
    const bar = $('hotbar');
    bar.innerHTML = '';
    this.slotEls = [];
    HOTBAR.forEach((slot, i) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<span class="kb">${i + 1}</span><img class="pix" draggable="false"><span class="cnt"></span>`;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onHotbarTap && this.onHotbarTap(i); });
      bar.appendChild(el);
      this.slotEls.push(el);
    });
    this._hbBuilt = true;
  }

  setHotbar(inv, sel, sword) {
    if (!this._hbBuilt) this.buildHotbar();
    HOTBAR.forEach((slot, i) => {
      const el = this.slotEls[i];
      const img = el.querySelector('img');
      const cnt = el.querySelector('.cnt');
      el.classList.toggle('sel', i === sel);
      if (slot.sword) {
        img.src = sword > 0 ? icon(SWORD[sword].icon) : icon('svard_tra');
        img.style.opacity = sword > 0 ? '1' : '0.35';
        img.style.filter = sword > 0 ? '' : 'grayscale(1)';
        cnt.textContent = '';
        el.classList.remove('empty');
        el.title = SWORD[sword].name;
      } else {
        const n = inv[slot.res] || 0;
        img.src = icon(RES[slot.res].icon);
        img.style.opacity = ''; img.style.filter = '';
        cnt.textContent = n > 0 ? n : '';
        el.classList.toggle('empty', n === 0);
        el.title = RES[slot.res].name;
      }
    });
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

  buildCraft(getInv, canAfford, craftCb) {
    const list = $('recipeList');
    list.innerHTML = '';
    this._recipeEls = [];
    for (const r of RECIPES) {
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

  updateCraft(inv, sword = 0) {
    if (!this._recipeEls) return;
    for (const { r, el } of this._recipeEls) {
      let ok = true;
      el.querySelectorAll('.cost').forEach((c) => {
        const has = (inv[c.dataset.res] || 0) >= Number(c.dataset.n);
        c.classList.toggle('miss', !has);
        if (!has) ok = false;
      });
      if (r.out.sword && sword >= r.out.sword) ok = false; // already owned
      el.querySelector('button').disabled = !ok;
    }
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
