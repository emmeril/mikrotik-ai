import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { connectRouter } from '../lib/routeros.js';

function sentence(words) {
  return Buffer.concat([...words.flatMap(word => [Buffer.from([Buffer.byteLength(word)]), Buffer.from(word)]), Buffer.from([0])]);
}

test('login dan pembacaan respons API yang terpotong antar paket', async () => {
  const received = [];
  const server = net.createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.includes(0)) {
        const words = [];
        let offset = 0;
        while (offset < buffer.length) {
          const length = buffer[offset++];
          if (length === 0) break;
          if (offset + length > buffer.length) return;
          words.push(buffer.subarray(offset, offset + length).toString());
          offset += length;
        }
        buffer = buffer.subarray(offset);
        received.push(words);
        const response = words[0] === '/login' ? sentence(['!done']) : Buffer.concat([sentence(['!re', '=version=7.20']), sentence(['!done'])]);
        socket.write(response.subarray(0, 3));
        setTimeout(() => socket.write(response.subarray(3)), 5);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = await connectRouter({ host: '127.0.0.1', port: server.address().port, username: 'admin', password: 'secret', secure: false });
    const result = await client.command(['/system/resource/print']);
    assert.equal(result.rows[0].version, '7.20');
    assert.equal(received[0][0], '/login');
    client.close();
  } finally { server.close(); }
});
