import type { CapturedRequest } from "./api";

// ---------- navigation (two routes don't need a router) ----------
export const navigate = (to: string) => {
	window.history.pushState(null, "", to);
	window.dispatchEvent(new PopStateEvent("popstate"));
};

// ---------- formatting ----------
export const formatBytes = (n: number) =>
	n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export const timeAgo = (iso: string, now = Date.now()) => {
	const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
	if (s < 5) return "just now";
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
};

export const daysLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

// ---------- bodies ----------
export type ParsedBody =
	| { kind: "empty" }
	| { kind: "json"; value: unknown; pretty: string }
	| { kind: "form"; pairs: [string, string][] }
	| { kind: "text"; text: string }
	| { kind: "binary"; base64: string };

export const parseBody = (r: CapturedRequest): ParsedBody => {
	if (!r.body) return { kind: "empty" };
	if (r.bodyEncoding === "base64") return { kind: "binary", base64: r.body };
	try {
		const value = JSON.parse(r.body);
		if (typeof value === "object" && value !== null) return { kind: "json", value, pretty: JSON.stringify(value, null, 2) };
	} catch {
		/* not JSON */
	}
	if (/x-www-form-urlencoded/i.test(r.contentType)) {
		return { kind: "form", pairs: [...new URLSearchParams(r.body).entries()] };
	}
	return { kind: "text", text: r.body };
};

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export const toCurl = (r: CapturedRequest, baseUrl: string) => {
	const parts = [`curl -X ${r.method} ${shellQuote(baseUrl + (r.path === "/" ? "" : r.path) + r.query)}`];
	for (const [k, v] of Object.entries(r.headers)) {
		if (["host", "content-length", "connection", "accept-encoding"].includes(k)) continue;
		parts.push(`-H ${shellQuote(`${k}: ${v}`)}`);
	}
	if (r.body && r.bodyEncoding === "utf8") parts.push(`--data-raw ${shellQuote(r.body)}`);
	return parts.join(" \\\n  ");
};

// ---------- local memory of endpoints this browser created ----------
const KEY = "hookpeek:endpoints";

export const rememberEndpoint = (id: string, expiresAt: string) => {
	try {
		const list = recentEndpoints().filter((e) => e.id !== id);
		localStorage.setItem(KEY, JSON.stringify([{ id, expiresAt }, ...list].slice(0, 8)));
	} catch {
		/* storage unavailable */
	}
};

export const recentEndpoints = (): { id: string; expiresAt: string }[] => {
	try {
		const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as { id: string; expiresAt: string }[];
		return list.filter((e) => Date.parse(e.expiresAt) > Date.now());
	} catch {
		return [];
	}
};

export const METHOD_COLOR: Record<string, string> = {
	GET: "text-info",
	POST: "text-ok",
	PUT: "text-hook",
	PATCH: "text-violet",
	DELETE: "text-bad",
};
