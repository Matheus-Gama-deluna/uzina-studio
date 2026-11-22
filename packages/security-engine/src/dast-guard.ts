import dns from "node:dns/promises";
import net from "node:net";

export interface DnsAddressRecord {
  address: string;
  family: number;
}

export interface DastGuardOptions {
  serverAllowlist: readonly string[];
  lookupDns?: (hostname: string) => Promise<DnsAddressRecord[]>;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parseIpv4Octets(ip: string): number[] | null {
  if (net.isIPv4(ip)) {
    return ip.split(".").map((n) => Number.parseInt(n, 10));
  }
  const mappedMatch = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedMatch?.[1] && net.isIPv4(mappedMatch[1])) {
    return mappedMatch[1].split(".").map((n) => Number.parseInt(n, 10));
  }
  return null;
}

function isMetadataOrUnspecifiedIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::" || normalized === "0.0.0.0" || normalized === "fd00:ec2::254") {
    return true;
  }
  const v4 = parseIpv4Octets(normalized);
  if (!v4) {
    return normalized.startsWith("fe80:");
  }
  const [a, b] = v4;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // AWS/GCP/Azure IMDS link-local
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; // CGNAT / Alibaba metadata
  return false;
}

function isLoopbackIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "::ffff:127.0.0.1") {
    return true;
  }
  const v4 = parseIpv4Octets(normalized);
  return v4 !== null && v4[0] === 127;
}

function isPrivateNetworkIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  const v4 = parseIpv4Octets(normalized);
  if (!v4) return false;
  const [a, b] = v4;
  if (a === 10) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export async function assertDastTargetAllowed(
  rawUrl: string,
  options: DastGuardOptions
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("URL DAST inválida.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Protocolo '${parsed.protocol}' proibido para DAST; use apenas http: ou https:.`
    );
  }

  const normalizedHost = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const normalizedAllowlist = options.serverAllowlist
    .map((h) => h.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, ""))
    .filter(Boolean);

  if (normalizedAllowlist.length === 0) {
    throw new Error(
      "Trava DAST ativa: nenhum host configurado em UZINA_DAST_ALLOWLIST no servidor."
    );
  }

  const hostWithoutBrackets = normalizedHost.replace(/^\[|\]$/g, "");
  if (!normalizedAllowlist.includes(hostWithoutBrackets)) {
    throw new Error(
      `Trava DAST bloqueou host '${hostWithoutBrackets}': fora da allowlist do servidor.`
    );
  }

  const lookup =
    options.lookupDns ??
    (async (hostname: string) =>
      dns.lookup(hostname, { all: true }));

  const resolved: DnsAddressRecord[] = net.isIP(hostWithoutBrackets)
    ? [{ address: hostWithoutBrackets, family: net.isIP(hostWithoutBrackets) }]
    : await lookup(hostWithoutBrackets);

  if (resolved.length === 0) {
    throw new Error(
      `Não foi possível resolver DNS para '${hostWithoutBrackets}'.`
    );
  }

  const explicitlyLoopbackHostname = LOOPBACK_HOSTS.has(hostWithoutBrackets);

  for (const record of resolved) {
    if (isMetadataOrUnspecifiedIp(record.address)) {
      throw new Error(
        `Trava DAST bloqueou IP proibido de metadata/link-local (${record.address}).`
      );
    }
    if (isLoopbackIp(record.address) && !explicitlyLoopbackHostname) {
      throw new Error(
        `Trava DAST bloqueou DNS rebinding para loopback (${record.address}).`
      );
    }
    if (isPrivateNetworkIp(record.address)) {
      throw new Error(
        `Trava DAST bloqueou endereço de rede privada RFC1918/ULA (${record.address}).`
      );
    }
  }

  return parsed;
}
