import type { HttpResponseInit } from "@azure/functions";

export const json = (status: number, body: unknown, headers: Record<string, string> = {}): HttpResponseInit => ({
	status,
	jsonBody: body,
	headers: { "cache-control": "no-store", ...headers },
});

export const error = (status: number, message: string) => json(status, { error: message });

/** Headers added by Azure's front end. They describe the hop, not the sender, so we hide them. */
const INFRA_HEADER = /^(x-ms-|x-arr-|x-azure-|x-forwarded-|x-original-|x-waws-|x-site-|x-appservice-|x-client-|was-default-hostname$|disguised-host$|client-ip$|max-forwards$|x-envoy-|x-request-id$|traceparent$)/i;

/**
 * Static Web Apps replaces the caller's Authorization header with its own short-lived
 * token for the managed Functions backend. That token must never be stored or replayed.
 */
const isPlatformToken = (value: string): boolean => {
	const jwt = value.match(/^Bearer ([\w-]+)\.([\w-]+)\.[\w-]+$/);
	if (!jwt) return false;
	try {
		const claims = JSON.parse(Buffer.from(jwt[2], "base64url").toString("utf8")) as { iss?: string; aud?: string };
		return /\.(scm\.)?azurewebsites\.net/i.test(`${claims.iss ?? ""} ${claims.aud ?? ""}`);
	} catch {
		return false;
	}
};

export const cleanHeaders = (headers: Headers): Record<string, string> => {
	const out: Record<string, string> = {};
	for (const [k, v] of headers.entries()) {
		if (INFRA_HEADER.test(k)) continue;
		if (k === "authorization" && isPlatformToken(v)) continue;
		out[k.toLowerCase()] = v;
	}
	// Show the host the sender actually called, not the internal backend host.
	const publicHost = headers.get("x-forwarded-host") ?? headers.get("x-original-host");
	if (publicHost) out.host = publicHost.split(",")[0].trim();
	return out;
};

export const sourceIpFrom = (headers: Headers): string => {
	const raw = headers.get("x-forwarded-for") ?? headers.get("x-client-ip") ?? "";
	const first = raw.split(",")[0].trim();
	// "1.2.3.4:5678" -> "1.2.3.4"; leave IPv6 alone.
	return /^\d+\.\d+\.\d+\.\d+:\d+$/.test(first) ? first.split(":")[0] : first;
};

const TEXTUAL = /^(text\/|application\/(json|xml|x-www-form-urlencoded|graphql|javascript|[\w.+-]+\+(json|xml)))/i;

/** Text bodies are stored as-is; anything that isn't valid UTF-8 is stored as base64. */
export const encodeBody = (buf: Buffer, contentType: string): { body: string; encoding: "utf8" | "base64" } => {
	if (buf.length === 0) return { body: "", encoding: "utf8" };
	const text = buf.toString("utf8");
	const looksTextual = TEXTUAL.test(contentType) || !contentType;
	if (looksTextual && Buffer.from(text, "utf8").equals(buf)) return { body: text, encoding: "utf8" };
	return { body: buf.toString("base64"), encoding: "base64" };
};
