import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRouterSnapshot, sanitizeRouterRows, snapshotFingerprint, snapshotForAi, validatePlanAgainstSnapshot } from '../lib/router-snapshot.js';

test('snapshot menyaring rahasia dan tetap berjalan jika menu tidak tersedia', async () => {
  const client = {
    async command([path]) {
      if (path === '/routing/rule/print') throw new Error('menu tidak tersedia');
      return { rows: [{ '.id': '*1', name: 'ether1', password: 'jangan-terkirim', 'private-key': 'rahasia' }] };
    }
  };
  const snapshot = await collectRouterSnapshot(client);
  assert.equal(snapshot.sections.interfaces[0].password, undefined);
  assert.equal(snapshot.sections.interfaces[0]['private-key'], undefined);
  assert.ok(snapshot.unavailable.includes('routingRules'));
  assert.equal(snapshotFingerprint(snapshot).length, 64);
  assert.doesNotMatch(snapshotForAi(snapshot), /jangan-terkirim|rahasia/);
});

test('hasil diagnostik tidak mengirim field sensitif ke browser', () => {
  assert.deepEqual(sanitizeRouterRows([{ name: 'peer-1', 'private-key': 'secret', password: 'secret' }]), [{ name: 'peer-1' }]);
});

test('preflight lokal menolak interface hilang dan konfigurasi duplikat', () => {
  const snapshot = { sections: { interfaces: [{ name: 'ether1' }], ipAddresses: [{ address: '192.168.10.1/24' }], routes: [] } };
  const plan = { actions: [{ input: { type: 'routeros_command', path: '/ip/address/add', params: [{ name: 'address', value: '192.168.10.1/24' }, { name: 'interface', value: 'ether9' }] } }] };
  const risks = validatePlanAgainstSnapshot(plan, snapshot);
  assert.ok(risks.some(item => item.includes('ether9')));
  assert.ok(risks.some(item => item.includes('sudah ada')));
});
