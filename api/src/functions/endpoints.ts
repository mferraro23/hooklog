import { app } from "@azure/functions";
import { error, json } from "../lib/http";
import { LIMITS, endpointsTable, getEndpoint, isValidEndpointId, newEndpointId, type EndpointEntity } from "../lib/storage";

const view = (e: EndpointEntity) => ({
	id: e.rowKey,
	createdAt: e.createdAt,
	expiresAt: e.expiresAt,
	limits: { maxBodyBytes: LIMITS.maxBodyBytes, maxRequests: LIMITS.maxRequestsPerEndpoint },
});

app.http("createEndpoint", {
	route: "endpoints",
	methods: ["POST"],
	authLevel: "anonymous",
	handler: async () => {
		const now = Date.now();
		const entity: EndpointEntity = {
			partitionKey: "endpoint",
			rowKey: newEndpointId(),
			createdAt: new Date(now).toISOString(),
			expiresAt: new Date(now + LIMITS.endpointTtlMs).toISOString(),
		};
		await (await endpointsTable()).createEntity(entity);
		return json(201, view(entity));
	},
});

app.http("getEndpoint", {
	route: "endpoints/{id}",
	methods: ["GET"],
	authLevel: "anonymous",
	handler: async (req) => {
		const id = req.params.id;
		if (!isValidEndpointId(id)) return error(404, "Endpoint not found");
		const e = await getEndpoint(id);
		return e ? json(200, view(e)) : error(404, "Endpoint not found or expired");
	},
});
