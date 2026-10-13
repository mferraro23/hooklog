import { app } from "@azure/functions";
import { timingSafeEqual } from "node:crypto";
import { error, json } from "../lib/http";
import { deletePartition, endpointsTable, requestsTable, type EndpointEntity } from "../lib/storage";

const keyMatches = (given: string | null): boolean => {
	const expected = process.env.ADMIN_KEY;
	if (!expected || !given) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Deletes expired endpoints and all their requests.
 * Static Web Apps' managed functions can't run on a timer, so a scheduled
 * GitHub Action calls this once a day with the admin key.
 */
app.http("purgeExpired", {
	route: "maintenance/purge", // "admin/*" is reserved by the Functions host
	methods: ["POST"],
	authLevel: "anonymous",
	handler: async (req) => {
		if (!keyMatches(req.headers.get("x-admin-key"))) return error(401, "Unauthorized");

		const now = new Date().toISOString();
		const endpoints = await endpointsTable();
		const requests = await requestsTable();

		let endpointsDeleted = 0;
		let requestsDeleted = 0;
		const expired = endpoints.listEntities<EndpointEntity>({
			queryOptions: { filter: `PartitionKey eq 'endpoint' and expiresAt lt '${now}'`, select: ["rowKey"] },
		});
		for await (const e of expired) {
			requestsDeleted += await deletePartition(requests, e.rowKey);
			await endpoints.deleteEntity("endpoint", e.rowKey);
			endpointsDeleted++;
		}
		return json(200, { endpointsDeleted, requestsDeleted });
	},
});
