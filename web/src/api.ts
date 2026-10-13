export interface Endpoint {
	id: string;
	createdAt: string;
	expiresAt: string;
	limits: { maxBodyBytes: number; maxRequests: number };
}

export interface RequestSummary {
	id: string;
	method: string;
	path: string;
	query: string;
	contentType: string;
	size: number;
	sourceIp: string;
	receivedAt: string;
}

export interface CapturedRequest extends RequestSummary {
	headers: Record<string, string>;
	bodyEncoding: "utf8" | "base64";
	truncated: boolean;
	body: string;
}

export interface ReplayResult {
	status: number;
	durationMs: number;
	headers: Record<string, string>;
	body: string;
	truncated: boolean;
}

export class ApiError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}

const call = async <T,>(path: string, init?: RequestInit): Promise<T> => {
	const res = await fetch(`/api${path}`, {
		...init,
		headers: { "content-type": "application/json", ...init?.headers },
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
	return data as T;
};

export const api = {
	createEndpoint: () => call<Endpoint>("/endpoints", { method: "POST" }),
	getEndpoint: (id: string) => call<Endpoint>(`/endpoints/${id}`),
	listRequests: (id: string, after?: string) =>
		call<{ items: RequestSummary[] }>(`/endpoints/${id}/requests${after ? `?after=${after}` : ""}`),
	getRequest: (id: string, rid: string) => call<CapturedRequest>(`/endpoints/${id}/requests/${rid}`),
	clearRequests: (id: string) => call<{ deleted: number }>(`/endpoints/${id}/requests`, { method: "DELETE" }),
	replay: (id: string, rid: string, url: string) =>
		call<ReplayResult>(`/endpoints/${id}/requests/${rid}/replay`, { method: "POST", body: JSON.stringify({ url }) }),
};

/** The public URL webhooks should be sent to. */
export const hookUrl = (id: string) => `${window.location.origin}/api/h/${id}`;
