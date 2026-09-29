import net from 'node:net';
import crypto from 'node:crypto';

function lengthBytes(length) {
  if (length < 0x80) return Buffer.from([length]);
  if (length < 0x4000) return Buffer.from([(length >> 8) | 0x80, length & 0xff]);
  if (length < 0x200000) return Buffer.from([(length >> 16) | 0xc0, (length >> 8) & 0xff, length & 0xff]);
  if (length < 0x10000000) return Buffer.from([(length >>> 24) | 0xe0, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff]);
  return Buffer.from([0xf0, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff]);
}

function encode(words) {
  return Buffer.concat([...words.map(word => {
    const data = Buffer.from(word, 'utf8');
    return Buffer.concat([lengthBytes(data.length), data]);
  }), Buffer.from([0])]);
}

function readLength(buffer, offset) {
  if (offset >= buffer.length) return null;
  const a = buffer[offset];
  const count = a < 0x80 ? 1 : a < 0xc0 ? 2 : a < 0xe0 ? 3 : a < 0xf0 ? 4 : a === 0xf0 ? 5 : -1;
  if (count < 0) throw new Error('Respons RouterOS tidak valid.');
  if (buffer.length - offset < count) return null;
  let value = count === 1 ? a : count === 2 ? a & 0x3f : count === 3 ? a & 0x1f : count === 4 ? a & 0x0f : 0;
  for (let i = 1; i < count; i++) value = value * 256 + buffer[offset + i];
  if (value > 1024 * 1024) throw new Error('Respons RouterOS terlalu besar.');
  return [value, offset + count];
}

export class RouterOsClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.words = [];
    this.queue = [];
    this.waiter = null;
    this.error = null;
    socket.on('data', chunk => this.onData(chunk));
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(new Error('Koneksi router terputus.')));
  }

  fail(error) {
    this.error = error;
    if (this.waiter) { this.waiter.reject(error); this.waiter = null; }
  }

  onData(chunk) {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (true) {
        const result = readLength(this.buffer, 0);
        if (!result) break;
        const [length, start] = result;
        if (this.buffer.length < start + length) break;
        const word = this.buffer.subarray(start, start + length).toString('utf8');
        this.buffer = this.buffer.subarray(start + length);
        if (length === 0) {
          if (this.waiter) { this.waiter.resolve(this.words); this.waiter = null; }
          else this.queue.push(this.words);
          this.words = [];
        } else this.words.push(word);
      }
    } catch (error) { this.fail(error); this.socket.destroy(); }
  }

  next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }

  async command(words) {
    this.socket.write(encode(words));
    const rows = [];
    let commandError;
    while (true) {
      const sentence = await this.next();
      const type = sentence[0];
      const values = Object.fromEntries(sentence.slice(1).filter(word => word.startsWith('=')).map(word => {
        const divider = word.indexOf('=', 1);
        return [word.slice(1, divider), word.slice(divider + 1)];
      }));
      if (type === '!trap' || type === '!fatal') commandError = new Error(values.message || 'Router menolak perintah.');
      if (type === '!re') rows.push(values);
      if (type === '!done') {
        if (commandError) throw commandError;
        return { rows, done: values };
      }
    }
  }

  close() { this.socket.end(); }
}

export async function connectRouter({ host, port = 8728, username, password }) {
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.:-]{1,253}$/.test(host)) throw new Error('Host router tidak valid.');
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error('Port router tidak valid.');
  if (!username || typeof username !== 'string' || typeof password !== 'string') throw new Error('Username atau password tidak valid.');
  const socket = await new Promise((resolve, reject) => {
    const options = { host, port: Number(port), timeout: 8000 };
    const connection = net.connect(options, () => resolve(connection));
    connection.once('error', reject);
    connection.once('timeout', () => { connection.destroy(); reject(new Error('Waktu koneksi ke router habis.')); });
  });
  socket.setTimeout(15000, () => socket.destroy(new Error('Router tidak merespons.')));
  const client = new RouterOsClient(socket);
  try {
    let login;
    try { login = await client.command(['/login', `=name=${username}`, `=password=${password}`]); }
    catch { login = await client.command(['/login']); }
    if (login.done.ret) {
      const challenge = Buffer.from(login.done.ret, 'hex');
      if (challenge.length !== 16) throw new Error('Challenge login RouterOS tidak valid.');
      const digest = crypto.createHash('md5').update(Buffer.concat([Buffer.from([0]), Buffer.from(password), challenge])).digest('hex');
      await client.command(['/login', `=name=${username}`, `=response=00${digest}`]);
    }
    return client;
  } catch (error) { client.close(); throw error; }
}
