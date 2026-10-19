import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { AppError } from "@/lib/errors";

/** Addresses a webhook may never reach: our own network, the cloud metadata service, loopback. */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const)
  PRIVATE.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const)
  PRIVATE.addSubnet(net, prefix, "ipv6");

const isPrivate = (address: string) => {
  const family = isIP(address) === 6 ? "ipv6" : "ipv4";
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is checked as the IPv4 it is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  return mapped ? PRIVATE.check(mapped, "ipv4") : PRIVATE.check(address, family);
};

/**
 * Throws unless `url` is HTTPS and every address it resolves to is public, so a webhook can't be
 * pointed at internal services (SSRF). Checked when the endpoint is saved and again before each
 * send, since DNS can change in between.
 */
export async function assertPublicUrl(url: string) {
  const { protocol, hostname } = new URL(url);
  const refuse = () => new AppError("VALIDATION_FAILED", "Webhook URLs must be public HTTPS URLs.");
  if (protocol !== "https:") throw refuse();
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0 || addresses.some(isPrivate)) throw refuse();
}
