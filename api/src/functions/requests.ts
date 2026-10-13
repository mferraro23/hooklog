import { app, type HttpRequest, type HttpResponseInit } from "@azure/functions";
import { error, json } from "../lib/http";
import { checkTarget } from "../lib/ssrf";
import {
	SUMMARY_FIELDS,
	deletePartition,
	getEndpoint,
	isValidEndpointId,
	isValidRequestId,
	requestsTable,
	toStoredRequest,
	toSummary,
} from "../lib/storage";

const PAGE = 50;

/** Resolves the endpoint id from the route, or returns an error response. */
const requireEndpoint = async (req: HttpRequest): Promise<{ id: string; fail?: never } | { id?: never; fail: HttpResponseInit }> => {
	const id = req.params.id;
	if (!isValidEndpointId(id) || !(await getEndpoint(id))) return { fail: error(404, "Endpoint not found or expired") };
	return { id };
};

app.http("listRequests", {
	route: "endpoints/{id}/requests",
	methods: ["GET"],
	authLevel: "anonymous",
	handler: async (req) => {
		const ep = await requireEndpoint(req);
		if (ep.fail) return ep.fail;

		// Row keys sort newest-first, so "newer than X" means RowKey < X.
		const after = req.query.get("after");
		let filter = `PartitionKey eq '${ep.id}'`;
		if (after && isValidRequestId(after)) filter += ` and RowKey lt '${after}'`;

		const t = await requestsTable();
		const page = await t
			.listEntities({ queryOptions: { filter, select: SUMMARY_FIELDS } })
			.byPage({ maxPageSize: PAGE })
			.next();
		const items = page.done ? [] : page.value.map((e) => toSummary(e as Record<string, unknown>));
		return json(200, { items });
	},
});

app.http("getRequest", {
	route: "endpoints/{id}/requests/{rid}",
	methods: ["GET"],
	authLevel: "anonymous",
	handler: async (req) => {
		const ep = await requireEndpoint(req);
		if (ep.fail) return ep.fail;
		const rid = req.params.rid;
		if (!isValidRequestId(rid)) return error(404, "Request not found");
		try {
			const e = await (await requestsTable()).getEntity(ep.id, rid);
			return json(200, toStoredRequest(e as Record<string, unknown>));
		} catch (err) {
			if ((err as { statusCode?: number }).statusCode === 404) return error(404, "Request not found");
			throw err;
		}
	},
});

app.http("clearRequests", {
	route: "endpoints/{id}/requests",
	methods: ["DELETE"],
	authLevel: "anonymous",
	handler: async (req) => {
		const ep = await requireEndpoint(req);
		if (ep.fail) return ep.fail;
		const deleted = await deletePartition(await requestsTable(), ep.id);
		return json(200, { deleted });
	},
});

/** Headers that describe the original hop and must not be copied onto a new request. */
const HOP_HEADERS = new Set([
	"host",
	"content-length",
	"connection",
	"keep-alive",
	"transfer-encoding",
	"accept-encoding",
	"upgrade",
	"te",
	"trailer",
	"proxy-authorization",
	"proxy-connection",
]);

const REPLAY_TIMEOUT_MS = 10_000;
const PREVIEW_CHARS = 4_000;

app.http("replayRequest", {
	route: "endpoints/{id}/requests/{rid}/replay",
	methods: ["POST"],
	authLevel: "anonymous",
	handler: async (req) => {
		const ep = await requireEndpoint(req);
		if (ep.fail) return ep.fail;
		const rid = req.params.rid;
		if (!isValidRequestId(rid)) return error(404, "Request not found");

		const { url: target } = ((await req.json().catch(() => ({}))) ?? {}) as { url?: string };
		if (!target) return error(400, "Body must be JSON with a `url`");
		const problem = await checkTarget(target);
		if (problem) return error(400, problem);

		let stored;
		try {
			stored = toStoredRequest((await (await requestsTable()).getEntity(ep.id, rid)) as Record<string, unknown>);
		} catch {
			return error(404, "Request not found");
		}

		const headers = new Headers();
		for (const [k, v] of Object.entries(stored.headers)) if (!HOP_HEADERS.has(k)) headers.set(k, v);
		headers.set("x-hooklog-replay", rid);

		const hasBody = !["GET", "HEAD"].includes(stored.method) && !!stored.body;
		const body = hasBody ? Buffer.from(stored.body!, stored.bodyEncoding === "base64" ? "base64" : "utf8") : undefined;

		const started = Date.now();
		try {
			const res = await fetch(target, {
				method: stored.method,
				headers,
				body,
				redirect: "manual",
				signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS),
			});
			const text = await res.text();
			return json(200, {
				status: res.status,
				durationMs: Date.now() - started,
				headers: Object.fromEntries(res.headers.entries()),
				body: text.slice(0, PREVIEW_CHARS),
				truncated: text.length > PREVIEW_CHARS,
			});
		} catch (err) {
			const timedOut = (err as Error).name === "TimeoutError";
			return error(502, timedOut ? `Target didn't respond within ${REPLAY_TIMEOUT_MS / 1000}s` : "Couldn't reach target");
		}
	},
});
