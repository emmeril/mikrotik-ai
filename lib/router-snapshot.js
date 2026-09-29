import crypto from 'node:crypto';

const sections = [
  ['identity', '/system/identity/print'],
  ['interfaces', '/interface/print'],
  ['bridges', '/interface/bridge/print'],
  ['bridgePorts', '/interface/bridge/port/print'],
  ['vlans', '/interface/vlan/print'],
  ['ipAddresses', '/ip/address/print'],
  ['routes', '/ip/route/print'],
  ['dns', '/ip/dns/print'],
  ['firewallFilter', '/ip/firewall/filter/print'],
  ['firewallNat', '/ip/firewall/nat/print'],
  ['firewallMangle', '/ip/firewall/mangle/print'],
  ['firewallRaw', '/ip/firewall/raw/print'],
  ['addressLists', '/ip/firewall/address-list/print'],
  ['ipPools', '/ip/pool/print'],
  ['dhcpServers', '/ip/dhcp-server/print'],
  ['dhcpNetworks', '/ip/dhcp-server/network/print'],
  ['simpleQueues', '/queue/simple/print'],
  ['queueTrees', '/queue/tree/print'],
  ['interfaceLists', '/interface/list/print'],
  ['interfaceListMembers', '/interface/list/member/print'],
  ['ipv6Addresses', '/ipv6/address/print'],
  ['ipv6Routes', '/ipv6/route/print'],
  ['ipv6FirewallFilter', '/ipv6/firewall/filter/print'],
  ['routingRules', '/routing/rule/print'],
  ['ospfInstances', '/routing/ospf/instance/print'],
  ['ospfAreas', '/routing/ospf/area/print'],
  ['bgpConnections', '/routing/bgp/connection/print'],
  ['pppProfiles', '/ppp/profile/print'],
  ['netwatch', '/tool/netwatch/print'],
  ['wireguard', '/interface/wireguard/print'],
  ['wireguardPeers', '/interface/wireguard/peers/print']
];

const sensitiveKey = /password|passwd|secret|private.?key|preshared.?key|token/i;

function sanitizeRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !sensitiveKey.test(key)).map(([key, value]) => [key, String(value).slice(0, 500)]));
}

export function sanitizeRouterRows(rows) {
  return rows.map(sanitizeRow);
}

export async function collectRouterSnapshot(client) {
  const snapshot = {};
  const unavailable = [];
  for (const [name, command] of sections) {
    try { snapshot[name] = sanitizeRouterRows((await client.command([command])).rows.slice(0, 100)); }
    catch { unavailable.push(name); }
  }
  return { capturedAt: new Date().toISOString(), sections: snapshot, unavailable };
}

export function snapshotFingerprint(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(snapshot.sections)).digest('hex');
}

export function snapshotForAi(snapshot, maxLength = 60_000) {
  const text = JSON.stringify(snapshot);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}\n[SNAPSHOT DIPOTONG]`;
}

const pathSection = [
  ['/ip/firewall/filter/', 'firewallFilter'], ['/ip/firewall/nat/', 'firewallNat'], ['/ip/firewall/mangle/', 'firewallMangle'], ['/ip/firewall/raw/', 'firewallRaw'],
  ['/ip/address/', 'ipAddresses'], ['/ip/route/', 'routes'], ['/interface/bridge/port/', 'bridgePorts'], ['/interface/bridge/', 'bridges'], ['/interface/vlan/', 'vlans'],
  ['/ip/dhcp-server/network/', 'dhcpNetworks'], ['/ip/dhcp-server/', 'dhcpServers'], ['/ip/pool/', 'ipPools'], ['/queue/simple/', 'simpleQueues'], ['/queue/tree/', 'queueTrees']
];

export function validatePlanAgainstSnapshot(plan, snapshot) {
  const risks = [];
  const interfaces = new Set((snapshot.sections.interfaces || []).map(row => row.name));
  for (const action of plan.actions) {
    const input = action.input;
    const params = Object.fromEntries((input.params || input.arguments || []).map(item => [item.name, item.value]));
    const requestedInterface = input.interface || input.inInterface || params.interface || params['in-interface'] || params['out-interface'];
    if (requestedInterface && interfaces.size && !interfaces.has(requestedInterface)) risks.push(`Interface ${requestedInterface} tidak ditemukan pada router.`);
    if (input.type === 'add_ip_address' && (snapshot.sections.ipAddresses || []).some(row => row.address === input.address)) risks.push(`Alamat IP ${input.address} sudah ada pada router.`);
    if (input.type === 'add_static_route' && (snapshot.sections.routes || []).some(row => row['dst-address'] === input.dstAddress && row.gateway === input.gateway)) risks.push(`Static route ${input.dstAddress} melalui ${input.gateway} sudah ada.`);
    if (input.path === '/ip/address/add' && (snapshot.sections.ipAddresses || []).some(row => row.address === params.address)) risks.push(`Alamat IP ${params.address} sudah ada pada router.`);
    if (input.path === '/ip/route/add' && (snapshot.sections.routes || []).some(row => row['dst-address'] === params['dst-address'] && row.gateway === params.gateway)) risks.push(`Static route ${params['dst-address']} melalui ${params.gateway} sudah ada.`);
    if (input.type === 'routeros_command' && /\/(set|remove|enable|disable)$/.test(input.path)) {
      const id = params['.id'] || params.numbers;
      const mapping = pathSection.find(([prefix]) => input.path.startsWith(prefix));
      if (mapping && id && !(snapshot.sections[mapping[1]] || []).some(row => row['.id'] === id)) risks.push(`ID ${id} untuk ${input.path} tidak ditemukan pada konfigurasi existing.`);
    }
  }
  return [...new Set(risks)];
}
