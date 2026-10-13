import { TableClient, type TableEntity } from "@azure/data-tables";
import { randomBytes } from "node:crypto";

// ---------- limits ----------
export const LIMITS = {
	/** Largest body we keep. Anything past this is stored truncated. */
	maxBodyBytes: 256 * 1024,
	/** Requests kept per endpoint; older ones are pruned. */
	maxRequestsPerEndpoint: 200,
	/** Endpoints (and their requests) expire this long after creation. */
	endpointTtlMs: 7 * 24 * 60 * 60 * 1000,
	/** Table string properties top out at 32K UTF-16 chars, so bodies are chunked. */
	chunkChars: 30_000,
};

// ---------- tables ----------
const conn = () => {
	const c = process.env.STORAGE_CONNECTION;
	if (!c) throw new Error("STORAGE_CONNECTION is not configured");
	return c;
};

const clients = new Map<string, Promise<TableClient>>();

const table = (name: string): Promise<TableClient> => {
	let p = clients.get(name);
	if (!p) {
		const client = TableClient.fromConnectionString(conn(), name, { allowInsecureConnection: true });
		p = client.createTable().then(() => client);
		// Don't cache a failed init; the next call retries.
		p.catch(() => clients.delete(name));
		clients.set(name, p);
	}
	return p;
};

export const endpointsTable = () => table("endpoints");
export const requestsTable = () => table("requests");

// ---------- ids ----------
/** 16 url-safe chars, ~96 bits. The id is the only secret guarding an endpoint. */
export const newEndpointId = () => randomBytes(12).toString("base64url");

const MAX_TS = 9_999_999_999_999;
/** Row keys sort newest-first: inverted timestamp + random suffix. */
export const newRequestId = () =>
	`${String(MAX_TS - Date.now()).padStart(13, "0")}-${randomBytes(3).toString("hex")}`;

export const isValidEndpointId = (id: string | undefined): id is string => !!id && /^[A-Za-z0-9_-]{16}$/.test(id);
export const isValidRequestId = (id: string | undefined): id is string => !!id && /^\d{13}-[0-9a-f]{6}$/.test(id);

// ---------- entities ----------
export interface EndpointEntity extends TableEntity {
	partitionKey: "endpoint";
	rowKey: string;
	createdAt: string;
	expiresAt: string;
}

export interface StoredRequest {
	id: string;
	method: string;
	path: string;
	query: string;
	headers: Record<string, string>;
	contentType: string;
	size: number;
	sourceIp: string;
	receivedAt: string;
	bodyEncoding: "utf8" | "base64";
	truncated: boolean;
	body?: string;
}

/** Fields returned in list views (no body, no headers). */
export const SUMMARY_FIELDS = ["rowKey", "method", "path", "query", "contentType", "size", "sourceIp", "receivedAt"];

export const getEndpoint = async (id: string): Promise<EndpointEntity | null> => {
	const t = await endpointsTable();
	try {
		const e = await t.getEntity<EndpointEntity>("endpoint", id);
		if (Date.parse(e.expiresAt) < Date.now()) return null;
		return e;
	} catch (err) {
		if ((err as { statusCode?: number }).statusCode === 404) return null;
		throw err;
	}
};

export const chunkBody = (body: string): Record<string, string> => {
	const out: Record<string, string> = {};
	for (let i = 0, n = 0; i < body.length; i += LIMITS.chunkChars, n++) {
		out[`body${n}`] = body.slice(i, i + LIMITS.chunkChars);
	}
	return out;
};

export const joinBody = (entity: Record<string, unknown>): string => {
	let s = "";
	for (let n = 0; typeof entity[`body${n}`] === "string"; n++) s += entity[`body${n}`] as string;
	return s;
};

export const toSummary = (e: Record<string, unknown>) => ({
	id: e.rowKey as string,
	method: e.method as string,
	path: e.path as string,
	query: (e.query as string) ?? "",
	contentType: (e.contentType as string) ?? "",
	size: (e.size as number) ?? 0,
	sourceIp: (e.sourceIp as string) ?? "",
	receivedAt: e.receivedAt as string,
});

export const toStoredRequest = (e: Record<string, unknown>): StoredRequest => ({
	...toSummary(e),
	headers: JSON.parse((e.headers as string) || "{}"),
	bodyEncoding: (e.bodyEncoding as "utf8" | "base64") ?? "utf8",
	truncated: !!e.truncated,
	body: joinBody(e),
});

/** Deletes every entity in a partition, 100 at a time (the transaction limit). */
export const deletePartition = async (t: TableClient, partitionKey: string, keep = 0) => {
	const keys: string[] = [];
	const iter = t.listEntities({
		queryOptions: { filter: `PartitionKey eq '${partitionKey}'`, select: ["rowKey"] },
	});
	for await (const e of iter) keys.push(e.rowKey as string);
	const doomed = keys.slice(keep); // row keys are newest-first, so this keeps the newest `keep`
	for (let i = 0; i < doomed.length; i += 100) {
		await t.submitTransaction(doomed.slice(i, i + 100).map((rk) => ["delete", { partitionKey, rowKey: rk }]));
	}
	return doomed.length;
};
