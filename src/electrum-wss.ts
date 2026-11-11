import { ElectrumCore, type ElectrumConnection, type ElectrumOptions, type ElectrumRequest } from './electrum-core.js';

/** Electrum WSS frames contain one JSON object, without TCP's newline terminator. */
export class WssConnection implements ElectrumConnection {
  private socket?: WebSocket;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(readonly endpoint: string, readonly timeout: number) {}
  async connect() {
    const url = new URL(this.endpoint);
    if (url.protocol !== 'wss:' || url.username || url.password || url.hash || url.search) throw Error('Browser Electrum endpoint must be a credential-free WSS URL');
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url); this.socket = socket;
      const timer = setTimeout(() => { this.close(); reject(Error('Electrum WSS connect timeout')); }, this.timeout);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = () => { clearTimeout(timer); const error=Error('Electrum WSS connection failed'); reject(error); this.close(error); };
      socket.onclose = () => { clearTimeout(timer); const error=Error('Electrum WSS disconnected'); reject(error); this.close(error); };
      socket.onmessage = event => {
        try {
          if (typeof event.data !== 'string' || event.data.length > 16*1024*1024) throw Error('Invalid or oversized Electrum WSS frame');
          const response = JSON.parse(event.data);
          if (!response || Array.isArray(response) || typeof response !== 'object') throw Error('Malformed Electrum WSS response');
          const pending = this.pending.get(response.id);
          if (!pending) return; // Header notifications and late responses do not change state.
          clearTimeout(pending.timer); this.pending.delete(response.id);
          if (response.error) pending.reject(Error(`Electrum ${JSON.stringify(response.error)}`)); else pending.resolve(response.result);
        } catch (error) { this.close(error instanceof Error ? error : Error(String(error))); }
      };
    });
  }
  request: ElectrumRequest = (method, ...params) => new Promise((resolve, reject) => {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) { reject(Error('Electrum WSS is disconnected')); return; }
    const id = ++this.sequence;
    const timer = setTimeout(() => this.close(Error(`Electrum WSS timeout: ${method}`)), this.timeout);
    this.pending.set(id, {resolve, reject, timer});
    try { this.socket.send(JSON.stringify({jsonrpc:'2.0',id,method,params})); }
    catch (error) { this.close(error instanceof Error ? error : Error(String(error))); }
  });
  close(error = Error('Electrum WSS session closed')) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}
export class BrowserElectrumProvider extends ElectrumCore {
  constructor(options: ElectrumOptions = {}) {
    super((endpoint,timeout) => new WssConnection(endpoint,timeout), options);
  }
}
