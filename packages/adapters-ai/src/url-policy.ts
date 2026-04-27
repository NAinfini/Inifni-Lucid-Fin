export interface ProviderUrlPolicyOptions {
  allowLocalhost?: boolean;
}

export interface ProviderUrlPolicyResult {
  origin: string;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function isLocalHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost' || normalized === '::1' || normalized.endsWith('.local');
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (normalized === '::1') return true;
  const firstGroup = Number.parseInt(normalized.split(':')[0] ?? '', 16);
  if (Number.isInteger(firstGroup)) {
    if (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) return true;
    if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return true;
  }
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    if (mappedIpv4.includes('.')) {
      return isPrivateIpv4(mappedIpv4);
    }
    const groups = mappedIpv4.split(':');
    if (groups.length === 2) {
      const high = Number.parseInt(groups[0] ?? '', 16);
      const low = Number.parseInt(groups[1] ?? '', 16);
      if (
        Number.isInteger(high) &&
        Number.isInteger(low) &&
        high >= 0 &&
        high <= 0xffff &&
        low >= 0 &&
        low <= 0xffff
      ) {
        return isPrivateIpv4(
          `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`,
        );
      }
    }
  }
  return false;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  return isLocalHostname(hostname) || isPrivateIpv4(hostname) || isPrivateIpv6(hostname);
}

export function validateProviderUrl(
  value: string | URL | Request,
  options: ProviderUrlPolicyOptions = {},
): ProviderUrlPolicyResult {
  const rawUrl = value instanceof Request ? value.url : String(value);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid provider URL');
  }

  if (url.protocol === 'file:' || url.protocol === 'ftp:') {
    throw new Error('Unsupported provider URL protocol');
  }

  const hostIsPrivateOrLocal = isPrivateOrLocalHost(url.hostname);
  if (hostIsPrivateOrLocal && options.allowLocalhost) {
    return { origin: url.origin };
  }

  if (hostIsPrivateOrLocal) {
    throw new Error('Provider URL resolves to a private or local address');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Provider URL must use HTTPS');
  }

  return { origin: url.origin };
}
