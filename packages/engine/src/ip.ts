/** IPv4 / IPv6 / MAC helpers used by the discrete-event engine. */

export function parseIPv4(s: string): number | null {
  const p = s.trim().split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    if (!/^\d+$/.test(x)) return null;
    const v = Number(x);
    if (v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

export function formatIPv4(n: number): string {
  const x = n >>> 0;
  return `${(x >>> 24) & 255}.${(x >>> 16) & 255}.${(x >>> 8) & 255}.${x & 255}`;
}

export function prefixToMask(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function maskToPrefix(mask: number): number {
  const m = mask >>> 0;
  let bits = 0;
  let seenZero = false;
  for (let i = 31; i >= 0; i--) {
    const b = (m >>> i) & 1;
    if (b) {
      if (seenZero) return -1;
      bits++;
    } else seenZero = true;
  }
  return bits;
}

export function parseMaskOrPrefix(s: string): number | null {
  if (s.startsWith('/')) {
    const p = Number(s.slice(1));
    return Number.isInteger(p) && p >= 0 && p <= 32 ? p : null;
  }
  if (/^\d+$/.test(s) && Number(s) <= 32) return Number(s);
  const m = parseIPv4(s);
  if (m === null) return null;
  const p = maskToPrefix(m);
  return p < 0 ? null : p;
}

export function networkAddr(ip: number, prefix: number): number {
  return (ip & prefixToMask(prefix)) >>> 0;
}

export function broadcastAddr(ip: number, prefix: number): number {
  const mask = prefixToMask(prefix);
  return (ip | (~mask >>> 0)) >>> 0;
}

export function inSubnet(ip: number, network: number, prefix: number): boolean {
  const mask = prefixToMask(prefix);
  return ((ip ^ network) & mask) >>> 0 === 0;
}

export function wildcardToPrefix(wild: number): number {
  return maskToPrefix((~wild) >>> 0);
}

export function parseCidrV4(s: string): { ip: number; prefix: number } | null {
  const [a, b] = s.split('/');
  if (!a) return null;
  const ip = parseIPv4(a);
  if (ip === null) return null;
  const prefix = b === undefined ? 32 : Number(b);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  return { ip, prefix };
}

export function isIPv4Literal(s: string): boolean {
  return parseIPv4(s) !== null;
}

export function parseIPv6(input: string): Uint8Array | null {
  let s = input.trim().toLowerCase();
  if (s.includes('.')) {
    const last = s.lastIndexOf(':');
    if (last < 0) return null;
    const v4 = parseIPv4(s.slice(last + 1));
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    s = `${s.slice(0, last)}:${hi}:${lo}`;
  }
  if ((s.match(/::/g) || []).length > 1) return null;
  let head: string[];
  let tail: string[];
  if (s.includes('::')) {
    const [h, t] = s.split('::');
    head = h ? h.split(':') : [];
    tail = t ? t.split(':') : [];
  } else {
    head = s.split(':');
    tail = [];
  }
  const parts = [...head, ...tail];
  if (parts.some((p) => p.length > 4 || !/^[0-9a-f]*$/.test(p))) return null;
  const missing = 8 - (head.length + tail.length);
  if (s.includes('::')) {
    if (missing < 0) return null;
  } else if (head.length !== 8) return null;
  const groups: number[] = [];
  for (const p of head) groups.push(p ? parseInt(p, 16) : 0);
  if (s.includes('::')) for (let i = 0; i < missing; i++) groups.push(0);
  for (const p of tail) groups.push(p ? parseInt(p, 16) : 0);
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    out[i * 2] = (groups[i] >> 8) & 0xff;
    out[i * 2 + 1] = groups[i] & 0xff;
  }
  return out;
}

export function formatIPv6(bytes: Uint8Array): string {
  const g: string[] = [];
  for (let i = 0; i < 8; i++) {
    g.push(((bytes[i * 2] << 8) | bytes[i * 2 + 1]).toString(16));
  }
  let bestLen = 0;
  let bestStart = -1;
  let i = 0;
  while (i < 8) {
    if (g[i] === '0') {
      let j = i;
      while (j < 8 && g[j] === '0') j++;
      if (j - i > bestLen) {
        bestLen = j - i;
        bestStart = i;
      }
      i = j;
    } else i++;
  }
  if (bestLen > 1) {
    const left = g.slice(0, bestStart).join(':');
    const right = g.slice(bestStart + bestLen).join(':');
    return `${left}::${right}`;
  }
  return g.join(':');
}

export function ipv6PrefixMatch(a: Uint8Array, b: Uint8Array, prefix: number): boolean {
  const bits = Math.max(0, Math.min(128, prefix));
  const full = Math.floor(bits / 8);
  for (let i = 0; i < full; i++) if (a[i] !== b[i]) return false;
  const rem = bits % 8;
  if (rem) {
    const mask = (0xff << (8 - rem)) & 0xff;
    if ((a[full] & mask) !== (b[full] & mask)) return false;
  }
  return true;
}

export function parseCidrV6(s: string): { ip: Uint8Array; prefix: number } | null {
  const idx = s.lastIndexOf('/');
  const addr = idx >= 0 ? s.slice(0, idx) : s;
  const prefix = idx >= 0 ? Number(s.slice(idx + 1)) : 128;
  const ip = parseIPv6(addr);
  if (!ip || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) return null;
  return { ip, prefix };
}

export function isIPv6Literal(s: string): boolean {
  return s.includes(':') && parseIPv6(s) !== null;
}

export function parseMac(s: string): string | null {
  const t = s.trim().toLowerCase().replace(/[.-]/g, ':');
  let hex: string;
  if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(t)) hex = t.replace(/:/g, '');
  else if (/^[0-9a-f]{4}:[0-9a-f]{4}:[0-9a-f]{4}$/.test(t)) hex = t.replace(/:/g, '');
  else if (/^[0-9a-f]{12}$/.test(t)) hex = t;
  else return null;
  const parts = hex.match(/.{2}/g);
  if (!parts) return null;
  return parts.join(':');
}

export function formatMacCisco(mac: string): string {
  const h = mac.replace(/:/g, '');
  return `${h.slice(0, 4)}.${h.slice(4, 8)}.${h.slice(8, 12)}`;
}

export function macToBytes(mac: string): number[] {
  return mac.split(':').map((x) => parseInt(x, 16));
}

export function eui64FromMac(mac: string): Uint8Array {
  const m = macToBytes(mac);
  const e = new Uint8Array(8);
  e[0] = m[0] ^ 0x02;
  e[1] = m[1];
  e[2] = m[2];
  e[3] = 0xff;
  e[4] = 0xfe;
  e[5] = m[3];
  e[6] = m[4];
  e[7] = m[5];
  return e;
}

export function linkLocalFromMac(mac: string): string {
  const b = new Uint8Array(16);
  b[0] = 0xfe;
  b[1] = 0x80;
  b.set(eui64FromMac(mac), 8);
  return formatIPv6(b);
}

export function slaacAddress(prefixCidr: string, mac: string): string | null {
  const parsed = parseCidrV6(prefixCidr.includes('/') ? prefixCidr : `${prefixCidr}/64`);
  if (!parsed || parsed.prefix > 64) return null;
  const b = parsed.ip.slice();
  b.set(eui64FromMac(mac), 8);
  return formatIPv6(b);
}

export function solicitedNodeMac(ip: Uint8Array): string {
  const last = ip[15];
  return `33:33:ff:${ip[13].toString(16).padStart(2, '0')}:${ip[14].toString(16).padStart(2, '0')}:${last.toString(16).padStart(2, '0')}`;
}

export const MAC_BCAST = 'ff:ff:ff:ff:ff:ff';
export const MAC_IPV6_MCAST = '33:33:00:00:00:01';

let macSeq = 1;
export function resetMacSeq(): void {
  macSeq = 1;
}
export function allocMac(): string {
  const n = macSeq++;
  const b = [0x02, 0x00, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return b.map((x) => x.toString(16).padStart(2, '0')).join(':');
}

export function compareIPv6(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < 16; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function ipv6Network(ip: Uint8Array, prefix: number): Uint8Array {
  const out = ip.slice();
  const bits = Math.max(0, Math.min(128, prefix));
  const full = Math.floor(bits / 8);
  const rem = bits % 8;
  for (let i = full + (rem ? 1 : 0); i < 16; i++) out[i] = 0;
  if (rem) out[full] = out[full] & ((0xff << (8 - rem)) & 0xff);
  return out;
}

export function formatIPv6Cidr(ip: Uint8Array, prefix: number): string {
  return `${formatIPv6(ipv6Network(ip, prefix))}/${prefix}`;
}
