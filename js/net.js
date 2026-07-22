// VILDMARK — co-op networking over PeerJS (host-authoritative)
const PREFIX = 'vildmark-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const PEER_OPTS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    ],
  },
};

export function randomCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

export class Net {
  constructor() {
    this.mode = null;      // 'host' | 'client'
    this.peer = null;
    this.conns = new Map(); // peerId -> conn (host)
    this.hostConn = null;   // (client)
    this.handlers = {};
    this.code = null;
    this.myId = 'local';
  }

  on(h) { this.handlers = { ...this.handlers, ...h }; }
  _emit(name, ...a) { this.handlers[name]?.(...a); }

  host(onReady) {
    this.mode = 'host';
    const tryCode = () => {
      const code = randomCode();
      const peer = new Peer(PREFIX + code, PEER_OPTS);
      peer.on('open', () => {
        this.peer = peer;
        this.code = code;
        peer.on('connection', (conn) => this._setupHostConn(conn));
        onReady(code);
      });
      peer.on('error', (err) => {
        if (err.type === 'unavailable-id') { peer.destroy(); tryCode(); }
        else {
          console.warn('peer error', err.type);
          this._emit('netError', err.type);
        }
      });
    };
    tryCode();
  }

  _setupHostConn(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      conn.on('data', (msg) => {
        try { this._emit('msg', conn.peer, msg.t, msg.d); } catch (e) { console.error(e); }
      });
      conn.on('close', () => {
        this.conns.delete(conn.peer);
        this._emit('peerLeave', conn.peer);
      });
      this._emit('peerOpen', conn.peer);
    });
  }

  join(code, onReady, onFail) {
    this.mode = 'client';
    const peer = new Peer(PEER_OPTS);
    let opened = false;
    peer.on('open', () => {
      this.peer = peer;
      this.myId = peer.id;
      const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
      const failT = setTimeout(() => { if (!opened) onFail('timeout'); }, 12000);
      conn.on('open', () => {
        opened = true;
        clearTimeout(failT);
        this.hostConn = conn;
        conn.on('data', (msg) => {
          try { this._emit('msg', 'host', msg.t, msg.d); } catch (e) { console.error(e); }
        });
        conn.on('close', () => this._emit('hostLost'));
        onReady();
      });
      conn.on('error', () => { if (!opened) { clearTimeout(failT); onFail('connect'); } });
    });
    peer.on('error', (err) => {
      if (!opened && (err.type === 'peer-unavailable' || err.type === 'network' || err.type === 'server-error')) {
        onFail(err.type);
      }
    });
  }

  // client -> host
  send(t, d) {
    if (this.hostConn?.open) this.hostConn.send({ t, d });
  }
  // host -> all clients (optionally excluding one)
  broadcast(t, d, except) {
    for (const [id, c] of this.conns) {
      if (id !== except && c.open) c.send({ t, d });
    }
  }
  // host -> one client
  sendTo(peerId, t, d) {
    const c = this.conns.get(peerId);
    if (c?.open) c.send({ t, d });
  }

  destroy() {
    try { this.peer?.destroy(); } catch {}
    this.peer = null;
    this.conns.clear();
    this.hostConn = null;
  }
}
