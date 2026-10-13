import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { cleanHeaders, encodeBody, error, json, sourceIpFrom } from "../lib/http";
import {
	LIMITS,
	chunkBody,
	deletePartition,
	getEndpoint,
	isValidEndpointId,
	newRequestId,
	requestsTable,
} from "../lib/storage";

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
	"access-control-allow-headers": "*",
};

/** Prune old requests on roughly one capture in ten, rather than on every write. */
const PRUNE_ODDS = 0.1;

const capture = async (req: HttpRequest): Promise<HttpResponseInit> => {
	const id = req.params.id;
	if (!isValidEndpointId(id)) return { ...error(404, "Endpoint not found"), headers: CORS };
	if (!(await getEndpoint(id))) return { ...error(410, "Endpoint not found or expired"), headers: CORS };

	const url = new URL(req.url);
	const prefix = `/api/h/${id}`;
	const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || "/" : "/";

	const raw = Buffer.from(await req.arrayBuffer());
	const truncated = raw.length > LIMITS.maxBodyBytes;
	const contentType = req.headers.get("content-type") ?? "";
	const { body, encoding } = encodeBody(truncated ? raw.subarray(0, LIMITS.maxBodyBytes) : raw, contentType);

	const requestId = newRequestId();
	const t = await requestsTable();
	await t.createEntity({
		partitionKey: id,
		rowKey: requestId,
		method: req.method,
		path,
		query: url.search,
		headers: JSON.stringify(cleanHeaders(req.headers)),
		contentType,
		size: raw.length,
		sourceIp: sourceIpFrom(req.headers),
		receivedAt: new Date().toISOString(),
		bodyEncoding: encoding,
		truncated,
		...chunkBody(body),
	});

	if (Math.random() < PRUNE_ODDS) await deletePartition(t, id, LIMITS.maxRequestsPerEndpoint);

	return json(200, { ok: true, id: requestId }, CORS);
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

// Two routes so both /h/{id} and /h/{id}/anything/below are captured.
app.http("capture", { route: "h/{id}", methods: [...METHODS], authLevel: "anonymous", handler: capture });
app.http("captureWithPath", { route: "h/{id}/{*rest}", methods: [...METHODS], authLevel: "anonymous", handler: capture });
