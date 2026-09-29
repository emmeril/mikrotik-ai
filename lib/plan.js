const ipv4 = value => {
  const parts = String(value).split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
};

const address = (value, allowCidr = false) => {
  const [ip, prefix, extra] = String(value).split('/');
  return !extra && ipv4(ip) && (!prefix ? !String(value).includes('/') : allowCidr && /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32);
};

const safeText = (value, max = 80) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\r\n\x00-\x1f;]/.test(value);
const interfaceName = value => safeText(value, 64) && /^[\w .:/-]+$/.test(value);
const quote = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const genericPath = value => typeof value === 'string' && /^\/[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){1,7}$/.test(value);
const genericValue = value => typeof value === 'string' && value.length <= 500 && !/[\r\n\x00-\x1f]/.test(value);
const blockedPaths = [/^\/system\/(reset-configuration|reboot|shutdown)/, /^\/system\/(script|scheduler|package)/, /^\/tool\/fetch/, /^\/user\//, /^\/file\//, /^\/import(?:\/|$)/, /^\/certificate\//];
const singletonSetPaths = new Set(['/system/identity/set', '/system/clock/set', '/system/ntp/client/set', '/ip/dns/set', '/ip/settings/set', '/ip/proxy/set', '/ipv6/settings/set']);

function compileGenericAction(action) {
  if (!safeText(action.title, 100) || !genericPath(action.path)) throw new Error('Judul atau path RouterOS tidak valid.');
  if (blockedPaths.some(pattern => pattern.test(action.path))) throw new Error(`Perintah ${action.path} diblokir oleh kebijakan keamanan.`);
  const operation = action.path.split('/').at(-1);
  const read = operation === 'print' || operation === 'get' || operation.startsWith('monitor');
  if (!["add", "set", "remove", "enable", "disable", "print", "get"].includes(operation) && !operation.startsWith('monitor')) throw new Error('Operasi RouterOS tidak didukung untuk eksekusi otomatis.');
  const suppliedArguments = action.params || action.arguments;
  if (!Array.isArray(suppliedArguments) || suppliedArguments.length > 24) throw new Error('Parameter RouterOS tidak valid.');
  const argumentsList = suppliedArguments.map(argument => {
    if (!argument || typeof argument !== 'object' || !/^(\.?[a-zA-Z0-9][a-zA-Z0-9-]{0,63})$/.test(argument.name) || !genericValue(argument.value)) throw new Error('Parameter RouterOS tidak valid.');
    return { name: argument.name, value: argument.value };
  });
  if (["set", "remove", "enable", "disable"].includes(operation) && !singletonSetPaths.has(action.path) && !argumentsList.some(item => item.name === '.id' || item.name === 'numbers')) throw new Error(`Operasi ${operation} harus memakai ID item existing.`);
  const sentence = [action.path, ...argumentsList.map(item => `=${item.name}=${item.value}`)];
  const cliPath = action.path.split('/').filter(Boolean).join(' ');
  const cliArguments = argumentsList.map(item => `${item.name}=${quote(item.value)}`).join(' ');
  return { title: action.title, kind: read ? 'read' : 'write', sentence, cli: `/${cliPath}${cliArguments ? ` ${cliArguments}` : ''}` };
}

export function compileAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('Aksi tidak valid.');
  switch (action.type) {
    case 'set_identity': {
      if (!safeText(action.name, 64)) throw new Error('Nama router tidak valid.');
      return { title: 'Ubah nama router', sentence: ['/system/identity/set', `=name=${action.name}`], cli: `/system identity set name=${quote(action.name)}` };
    }
    case 'set_dns': {
      if (!Array.isArray(action.servers) || action.servers.length < 1 || action.servers.length > 4 || !action.servers.every(ipv4)) throw new Error('Alamat DNS tidak valid.');
      const servers = action.servers.join(',');
      return { title: 'Atur DNS', sentence: ['/ip/dns/set', `=servers=${servers}`], cli: `/ip dns set servers=${servers}` };
    }
    case 'add_ip_address': {
      if (!address(action.address, true) || !String(action.address).includes('/') || !interfaceName(action.interface)) throw new Error('Alamat IP atau interface tidak valid.');
      return { title: 'Tambah alamat IP', sentence: ['/ip/address/add', `=address=${action.address}`, `=interface=${action.interface}`], cli: `/ip address add address=${action.address} interface=${quote(action.interface)}` };
    }
    case 'add_static_route': {
      if (!address(action.dstAddress, true) || !String(action.dstAddress).includes('/') || !address(action.gateway)) throw new Error('Tujuan atau gateway tidak valid.');
      return { title: 'Tambah static route', sentence: ['/ip/route/add', `=dst-address=${action.dstAddress}`, `=gateway=${action.gateway}`], cli: `/ip route add dst-address=${action.dstAddress} gateway=${action.gateway}` };
    }
    case 'add_firewall_filter': {
      if (!['input', 'forward', 'output'].includes(action.chain) || !['accept', 'drop', 'reject'].includes(action.action)) throw new Error('Chain atau aksi firewall tidak valid.');
      if (action.protocol && !['tcp', 'udp', 'icmp'].includes(action.protocol)) throw new Error('Protokol firewall tidak valid.');
      if (action.srcAddress && !address(action.srcAddress, true)) throw new Error('Sumber firewall tidak valid.');
      if (action.dstAddress && !address(action.dstAddress, true)) throw new Error('Tujuan firewall tidak valid.');
      if (action.dstPort && (!/^(\d{1,5})(,\d{1,5})*$/.test(String(action.dstPort)) || String(action.dstPort).split(',').some(port => Number(port) < 1 || Number(port) > 65535) || !['tcp', 'udp'].includes(action.protocol))) throw new Error('Port firewall tidak valid.');
      if (action.inInterface && !interfaceName(action.inInterface)) throw new Error('Interface firewall tidak valid.');
      if (action.comment && !safeText(action.comment, 80)) throw new Error('Komentar firewall tidak valid.');
      const fields = [['chain', action.chain], ['action', action.action], ['protocol', action.protocol], ['src-address', action.srcAddress], ['dst-address', action.dstAddress], ['dst-port', action.dstPort], ['in-interface', action.inInterface], ['comment', action.comment]].filter(([, value]) => value !== undefined && value !== '');
      return { title: 'Tambah aturan firewall', sentence: ['/ip/firewall/filter/add', ...fields.map(([key, value]) => `=${key}=${value}`)], cli: `/ip firewall filter add ${fields.map(([key, value]) => `${key}=${quote(value)}`).join(' ')}` };
    }
    case 'monitor_interface_traffic': {
      if (!interfaceName(action.interface)) throw new Error('Interface untuk pemantauan traffic tidak valid.');
      return { title: `Snapshot traffic ${action.interface}`, kind: 'read', sentence: ['/interface/monitor-traffic', `=interface=${action.interface}`, '=once='], cli: `/interface monitor-traffic ${quote(action.interface)} once` };
    }
    case 'routeros_command': return compileGenericAction(action);
    default: throw new Error('Jenis aksi tidak didukung.');
  }
}

export function compilePlan(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.actions) || raw.actions.length > 20) throw new Error('Rencana harus berisi 0 sampai 20 aksi.');
  const actions = raw.actions.map(action => ({ input: action, ...compileAction(action) }));
  const summary = safeText(raw.summary, 300) ? raw.summary : 'Rencana konfigurasi MikroTik';
  const manual = typeof raw.manual === 'string' && raw.manual.length <= 4000 ? raw.manual : '';
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.filter(item => safeText(item, 300)).slice(0, 10) : [];
  return { summary, manual, warnings, actions, script: actions.length ? actions.map(item => item.cli).join('\n') : manual || 'Perjelas kebutuhan konfigurasi sebelum menerapkan perubahan.' };
}
