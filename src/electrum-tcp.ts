import { connect as tlsConnect } from 'node:tls';
import { connect as tcpConnect, type Socket } from 'node:net';
import type { ElectrumRequest } from './electrum-core.js';
/** Bounded JSON-lines transport. A failed session is discarded, never continued on another server. */
export class TcpConnection {
  socket?: Socket;
  sequence = 0;
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  constructor(readonly endpoint: string, readonly timeout: number) {}
  async connect() {
    const url = new URL(this.endpoint);
    if (!['ssl:', 'tcp:'].includes(url.protocol) || url.username || url.password || !url.port) throw Error('Electrum endpoint must be ssl://host:port or tcp://host:port');
    await new Promise<void>((resolve, reject) => {
      const socket = url.protocol === 'ssl:' ? tlsConnect({ host: url.hostname, port: Number(url.port), servername: url.hostname }) : tcpConnect({ host: url.hostname, port: Number(url.port) });
      this.socket = socket;
      const timer = setTimeout(() => { socket.destroy(); reject(Error('Electrum connect timeout')); }, this.timeout);
      socket.once(url.protocol === 'ssl:' ? 'secureConnect' : 'connect', () => { clearTimeout(timer); resolve(); });
      socket.on('error', e => { clearTimeout(timer); reject(e); this.close(e); });
      socket.on('close', () => this.close(Error('Electrum disconnected')));
      let buffer = '';
      socket.on('data', data => {
        buffer += data.toString();
        if (buffer.length > 16 * 1024 * 1024) { this.close(Error('Electrum response too large')); return; }
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const response = JSON.parse(line), pending = this.pending.get(response.id);
            if (!pending) continue;
            clearTimeout(pending.timer); this.pending.delete(response.id);
            if (response.error) pending.reject(Error(`Electrum ${JSON.stringify(response.error)}`)); else pending.resolve(response.result);
          } catch { this.close(Error('Malformed Electrum JSON')); }
        }
      });
    });
  }
  request: ElectrumRequest = async (method, ...params) => new Promise((resolve, reject) => {
    const id = ++this.sequence;
    const timer = setTimeout(() => this.close(Error(`Electrum timeout: ${method}`)), this.timeout);
    this.pending.set(id, { resolve, reject, timer });
    this.socket!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  close(error = Error('Electrum session closed')) {
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.socket?.destroy();
  }
}

