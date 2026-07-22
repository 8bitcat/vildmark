// VILDMARK — unified input: keyboard+mouse (pointer lock) and touch (joystick + drag look)
export class Input {
  constructor(canvas, cb) {
    this.canvas = canvas;
    this.cb = cb; // { onHotbar(i), onHotbarDelta(d), onToggleCraft, onPauseRequest, onEat }
    this.isTouch = 'ontouchstart' in window && navigator.maxTouchPoints > 0;
    this.keys = {};
    this.move = { x: 0, z: 0 };
    this.jump = false;
    this.mine = false;
    this._placeEdge = false;
    this.lookDX = 0; this.lookDY = 0;
    this.locked = false;
    this.enabled = false;

    this._joy = null;   // {id, ox, oy}
    this._look = null;  // {id, lx, ly}

    this._bindKeyboard();
    this._bindMouse();
    if (this.isTouch) this._bindTouch();
  }

  consumeLook() {
    const r = [this.lookDX, this.lookDY];
    this.lookDX = 0; this.lookDY = 0;
    return r;
  }
  placePressed() {
    const r = this._placeEdge;
    this._placeEdge = false;
    return r;
  }

  requestLock() {
    if (document.querySelector('.overlay:not(.hidden)')) return; // a panel is open — stay unlocked
    if (!this.isTouch && this.enabled && document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock?.();
    }
  }

  _bindKeyboard() {
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'Space') { this.jump = true; e.preventDefault(); }
      if (e.code >= 'Digit1' && e.code <= 'Digit9') this.cb.onHotbar(Number(e.code.slice(5)) - 1);
      if (e.code === 'Digit0') this.cb.onHotbar(9);
      if (e.code === 'KeyE') this.cb.onToggleCraft();
      if (e.code === 'KeyQ') this.cb.onEat();
      if (e.code === 'KeyF') this.cb.onInteract();
      if (e.code === 'KeyH') this.cb.onManual();
      if (e.code === 'KeyI' || e.code === 'Tab') { this.cb.onInventory(); e.preventDefault(); }
      this._updMove();
    });
    addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'Space') this.jump = false;
      this._updMove();
    });
    addEventListener('blur', () => { this.keys = {}; this.jump = false; this.mine = false; this._updMove(); });
  }

  _updMove() {
    const k = this.keys;
    let x = 0, z = 0;
    if (k['KeyW'] || k['ArrowUp']) z -= 1;
    if (k['KeyS'] || k['ArrowDown']) z += 1;
    if (k['KeyA'] || k['ArrowLeft']) x -= 1;
    if (k['KeyD'] || k['ArrowRight']) x += 1;
    const l = Math.hypot(x, z) || 1;
    this.move.x = x / l; this.move.z = z / l;
  }

  _bindMouse() {
    if (this.isTouch) return;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.enabled) {
        this.mine = false;
        this.cb.onPauseRequest();
      }
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.locked) { this.lookDX += e.movementX; this.lookDY += e.movementY; }
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this.requestLock(); return; }
      if (e.button === 0) this.mine = true;
      if (e.button === 2) this._placeEdge = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mine = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => {
      if (this.enabled && this.locked) this.cb.onHotbarDelta(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
  }

  _bindTouch() {
    const joyZone = document.getElementById('joyZone');
    const knob = document.getElementById('joyKnob');
    const lookZone = document.getElementById('lookZone');

    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    joyZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this._joy = { id: t.identifier, ox: t.clientX, oy: t.clientY };
    }, { passive: false });

    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this._look = { id: t.identifier, lx: t.clientX, ly: t.clientY };
    }, { passive: false });

    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (this._joy && t.identifier === this._joy.id) {
          let dx = t.clientX - this._joy.ox, dy = t.clientY - this._joy.oy;
          const len = Math.hypot(dx, dy);
          const max = 48;
          if (len > max) { dx = dx / len * max; dy = dy / len * max; }
          setKnob(dx, dy);
          this.move.x = dx / max; this.move.z = dy / max;
        }
        if (this._look && t.identifier === this._look.id) {
          this.lookDX += (t.clientX - this._look.lx) * 2.4;
          this.lookDY += (t.clientY - this._look.ly) * 2.4;
          this._look.lx = t.clientX; this._look.ly = t.clientY;
        }
      }
      e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (this._joy && t.identifier === this._joy.id) {
          this._joy = null; this.move.x = 0; this.move.z = 0; setKnob(0, 0);
        }
        if (this._look && t.identifier === this._look.id) this._look = null;
      }
    };
    addEventListener('touchmove', onMove, { passive: false });
    addEventListener('touchend', onEnd);
    addEventListener('touchcancel', onEnd);

    const hold = (id, on, off) => {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); on(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); off && off(); }, { passive: false });
    };
    hold('btnMine', () => { this.mine = true; }, () => { this.mine = false; });
    hold('btnPlace', () => { this._placeEdge = true; });
    hold('btnTalk', () => this.cb.onInteract());
    hold('btnBookT', () => this.cb.onManual());
    hold('btnInvT', () => this.cb.onInventory());
    hold('btnJump', () => { this.jump = true; }, () => { this.jump = false; });
    hold('btnCraftT', () => this.cb.onToggleCraft());
    hold('btnEatT', () => this.cb.onEat());
    hold('btnPauseT', () => this.cb.onPauseRequest());
  }
}
