import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// Server-side replay must never reach private networks or cloud metadata endpoints.
const blocked = new BlockList();
for (const [net, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["224.0.0.0", 3],
] as const) {
	blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
	["::", 128],
	["::1", 128],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	blocked.addSubnet(net, prefix, "ipv6");
}

const isBlocked = (address: string): boolean => {
	const v = isIP(address);
	if (v === 4) return blocked.check(address, "ipv4");
	if (v === 6) {
		const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
		if (mapped) return blocked.check(mapped[1], "ipv4");
		return blocked.check(address, "ipv6");
	}
	return true;
};

/** Returns an error message if the URL is not a safe public http(s) target, else null. */
export const checkTarget = async (raw: string): Promise<string | null> => {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return "Target must be a valid URL";
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return "Target must use http or https";
	if (url.username || url.password) return "Target URL can't contain credentials";

	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
		return "Replay can't reach localhost or private networks. Use the CLI to forward to your machine.";
	}
	let addresses: string[];
	try {
		addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
	} catch {
		return `Couldn't resolve ${host}`;
	}
	if (addresses.length === 0 || addresses.some(isBlocked)) {
		return "Replay can't reach localhost or private networks. Use the CLI to forward to your machine.";
	}
	return null;
};
