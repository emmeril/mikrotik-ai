import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePlan } from '../lib/plan.js';

test('rencana manual tanpa aksi tetap bisa ditampilkan', () => {
  const plan = compilePlan({ summary: 'Butuh alamat IP tujuan', manual: 'Masukkan IP tujuan sebelum membuat aturan.', actions: [] });
  assert.equal(plan.actions.length, 0);
  assert.match(plan.script, /Masukkan IP tujuan/);
});

test('aksi firewall menolak port tanpa protokol TCP atau UDP', () => {
  assert.throws(() => compilePlan({ summary: 'Aturan', actions: [{ type: 'add_firewall_filter', chain: 'input', action: 'drop', dstPort: '22' }] }), /Port firewall tidak valid/);
});

test('perintah CLI mengutip nilai agar tetap satu argumen', () => {
  const plan = compilePlan({ summary: 'Nama router', actions: [{ type: 'set_identity', name: 'Router Kantor' }] });
  assert.equal(plan.script, '/system identity set name="Router Kantor"');
  assert.deepEqual(plan.actions[0].sentence, ['/system/identity/set', '=name=Router Kantor']);
});

test('monitor traffic menghasilkan aksi read-only dengan parameter once', () => {
  const plan = compilePlan({ summary: 'Cek traffic', actions: [{ type: 'monitor_interface_traffic', interface: 'ether1' }] });
  assert.equal(plan.actions[0].kind, 'read');
  assert.deepEqual(plan.actions[0].sentence, ['/interface/monitor-traffic', '=interface=ether1', '=once=']);
  assert.equal(plan.script, '/interface monitor-traffic "ether1" once');
});

test('perintah RouterOS umum mendukung konfigurasi DHCP', () => {
  const plan = compilePlan({ summary: 'DHCP', actions: [{ type: 'routeros_command', title: 'Tambah DHCP network', path: '/ip/dhcp-server/network/add', arguments: [{ name: 'address', value: '192.168.20.0/24' }, { name: 'gateway', value: '192.168.20.1' }] }] });
  assert.deepEqual(plan.actions[0].sentence, ['/ip/dhcp-server/network/add', '=address=192.168.20.0/24', '=gateway=192.168.20.1']);
  assert.match(plan.script, /^\/ip dhcp-server network add/);
});

test('singleton RouterOS dapat diubah tanpa ID item', () => {
  const plan = compilePlan({ summary: 'Identity', actions: [{ type: 'routeros_command', title: 'Ubah identity', path: '/system/identity/set', params: [{ name: 'name', value: 'Router Cabang' }] }] });
  assert.deepEqual(plan.actions[0].sentence, ['/system/identity/set', '=name=Router Cabang']);
});

test('perintah umum memerlukan ID untuk mengubah item existing', () => {
  assert.throws(() => compilePlan({ summary: 'Ubah', actions: [{ type: 'routeros_command', title: 'Ubah item', path: '/ip/address/set', arguments: [{ name: 'address', value: '10.0.0.1/24' }] }] }), /harus memakai ID/);
});

test('perintah sistem berbahaya diblokir', () => {
  assert.throws(() => compilePlan({ summary: 'Reset', actions: [{ type: 'routeros_command', title: 'Reset router', path: '/system/reset-configuration', arguments: [] }] }), /diblokir/);
});
