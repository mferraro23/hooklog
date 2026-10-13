import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, hookUrl, type CapturedRequest, type ReplayResult } from "../api";
import { METHOD_COLOR, formatBytes, parseBody, toCurl } from "../lib";
import { Code, CopyButton, JsonView, KeyValueTable } from "./ui";

type Tab = "body" | "headers" | "query" | "replay";

export const RequestDetail = ({ endpointId, requestId }: { endpointId: string; requestId: string }) => {
	const [req, setReq] = useState<CapturedRequest | null>(null);
	const [err, setErr] = useState("");
	const [tab, setTab] = useState<Tab>("body");

	useEffect(() => {
		api.getRequest(endpointId, requestId).then(setReq, (e) => setErr((e as Error).message));
	}, [endpointId, requestId]);

	const body = useMemo(() => (req ? parseBody(req) : null), [req]);
	const query = useMemo(() => (req ? [...new URLSearchParams(req.query).entries()] : []), [req]);

	if (err) return <p className="p-6 text-sm text-bad">{err}</p>;
	if (!req || !body) return <p className="p-6 font-mono text-sm text-dim">loading…</p>;

	const headers = Object.entries(req.headers).sort(([a], [b]) => a.localeCompare(b));
	const tabs: { id: Tab; label: string; count?: number }[] = [
		{ id: "body", label: "Body" },
		{ id: "headers", label: "Headers", count: headers.length },
		{ id: "query", label: "Query", count: query.length },
		{ id: "replay", label: "Replay" },
	];

	return (
		<div className="px-4 py-5 sm:px-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="break-all font-mono text-[15px]">
						<span className={`font-semibold ${METHOD_COLOR[req.method] ?? "text-muted"}`}>{req.method}</span>{" "}
						<span className="text-ink">{req.path}</span>
						<span className="text-dim">{req.query}</span>
					</p>
					<p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-dim">
						<span>{new Date(req.receivedAt).toLocaleString()}</span>
						<span>{formatBytes(req.size)}</span>
						{req.contentType && <span>{req.contentType}</span>}
						{req.sourceIp && <span>from {req.sourceIp}</span>}
					</p>
				</div>
				<div className="flex gap-2">
					<CopyButton text={toCurl(req, hookUrl(endpointId))} label="Copy as cURL" className="btn py-1.5 text-xs" />
					{req.body && <CopyButton text={req.body} label="Copy body" className="btn py-1.5 text-xs" />}
				</div>
			</div>

			<div className="mt-5 flex gap-1 border-b border-line" role="tablist">
				{tabs.map((t) => (
					<button
						key={t.id}
						role="tab"
						aria-selected={tab === t.id}
						onClick={() => setTab(t.id)}
						className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
							tab === t.id ? "border-hook text-ink" : "border-transparent text-muted hover:text-ink"
						}`}
					>
						{t.label}
						{t.count !== undefined && <span className="ml-1.5 font-mono text-xs text-dim">{t.count}</span>}
					</button>
				))}
			</div>

			<div className="mt-5" role="tabpanel">
				{tab === "body" && (
					<>
						{req.truncated && (
							<p className="mb-3 text-xs text-hook">Body was larger than 256 KB, so only the first 256 KB were kept.</p>
						)}
						{body.kind === "empty" && <p className="text-sm text-dim">No body.</p>}
						{body.kind === "json" && <JsonView text={body.pretty} />}
						{body.kind === "form" && <KeyValueTable rows={body.pairs} empty="Empty form." />}
						{body.kind === "text" && <Code>{body.text}</Code>}
						{body.kind === "binary" && (
							<>
								<p className="mb-3 text-xs text-muted">Binary body, shown as base64.</p>
								<Code>{body.base64}</Code>
							</>
						)}
					</>
				)}
				{tab === "headers" && (
					<>
						<KeyValueTable rows={headers} empty="No headers." />
						<p className="mt-3 text-xs text-dim">
							Azure Static Web Apps doesn't pass an incoming <code className="font-mono">Authorization</code> header through, so it isn't captured.
						</p>
					</>
				)}
				{tab === "query" && <KeyValueTable rows={query} empty="No query string." />}
				{tab === "replay" && <Replay endpointId={endpointId} requestId={requestId} />}
			</div>
		</div>
	);
};

const LAST_TARGET = "hooklog:replay-target";

const Replay = ({ endpointId, requestId }: { endpointId: string; requestId: string }) => {
	const [url, setUrl] = useState(() => {
		try {
			return localStorage.getItem(LAST_TARGET) ?? "";
		} catch {
			return "";
		}
	});
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<ReplayResult | null>(null);
	const [err, setErr] = useState("");

	const send = async (e: FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setErr("");
		setResult(null);
		try {
			localStorage.setItem(LAST_TARGET, url);
		} catch {
			/* storage unavailable */
		}
		try {
			setResult(await api.replay(endpointId, requestId, url));
		} catch (e) {
			setErr((e as Error).message);
		} finally {
			setBusy(false);
		}
	};

	const statusColor = !result ? "" : result.status < 300 ? "text-ok" : result.status < 400 ? "text-hook" : "text-bad";

	return (
		<div className="max-w-2xl">
			<form onSubmit={send} className="flex flex-col gap-2 sm:flex-row">
				<label htmlFor="replay-url" className="sr-only">
					Target URL
				</label>
				<input
					id="replay-url"
					type="url"
					required
					placeholder="https://staging.example.com/webhooks/stripe"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					className="input"
				/>
				<button type="submit" disabled={busy} className="btn btn-primary shrink-0">
					{busy ? "Sending…" : "Replay"}
				</button>
			</form>
			<p className="mt-2 text-xs text-dim">
				Sends the same method, headers, and body. Public URLs only; use the CLI to forward to localhost.
			</p>

			{err && <p className="mt-4 text-sm text-bad">{err}</p>}
			{result && (
				<div className="mt-6">
					<p className="font-mono text-sm">
						<span className={`font-semibold ${statusColor}`}>{result.status}</span>
						<span className="text-dim"> · {result.durationMs} ms</span>
					</p>
					<p className="label mt-4">response body{result.truncated ? " (first 4 KB)" : ""}</p>
					<Code className="mt-2">{result.body || "(empty)"}</Code>
				</div>
			)}
		</div>
	);
};
