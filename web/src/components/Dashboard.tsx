import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, hookUrl, type Endpoint, type RequestSummary } from "../api";
import { METHOD_COLOR, daysLeft, formatBytes, navigate, rememberEndpoint, timeAgo } from "../lib";
import { RequestDetail } from "./RequestDetail";
import { Code, CopyButton, Logo } from "./ui";

const POLL_MS = 2000;

const SAMPLE = {
	type: "invoice.paid",
	id: "evt_test_1042",
	data: { invoice: "INV-20481", customer: "acme-co", amount: 4200, currency: "usd" },
	created: 0,
};

export const Dashboard = ({ id }: { id: string }) => {
	const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
	const [missing, setMissing] = useState(false);
	const [items, setItems] = useState<RequestSummary[]>([]);
	const [fresh, setFresh] = useState<Set<string>>(new Set());
	const [selected, setSelected] = useState<string | null>(null);
	const [now, setNow] = useState(Date.now());
	const newest = useRef<string | undefined>(undefined);
	const limit = endpoint?.limits.maxRequests ?? 200;

	// Load endpoint + first page.
	useEffect(() => {
		api
			.getEndpoint(id)
			.then((ep) => {
				setEndpoint(ep);
				rememberEndpoint(ep.id, ep.expiresAt);
				return api.listRequests(id);
			})
			.then(({ items }) => {
				setItems(items);
				newest.current = items[0]?.id;
				setSelected(items[0]?.id ?? null);
			})
			.catch((e) => {
				if (e instanceof ApiError && e.status === 404) setMissing(true);
			});
	}, [id]);

	const poll = useCallback(async () => {
		if (document.hidden) return;
		try {
			const { items: incoming } = await api.listRequests(id, newest.current);
			if (incoming.length === 0) return;
			newest.current = incoming[0].id;
			setItems((prev) => [...incoming, ...prev].slice(0, limit));
			setFresh(new Set(incoming.map((i) => i.id)));
			setSelected((cur) => cur ?? incoming[0].id);
		} catch {
			/* transient; try again next tick */
		}
	}, [id, limit]);

	useEffect(() => {
		if (!endpoint) return;
		const t = setInterval(() => {
			poll();
			setNow(Date.now());
		}, POLL_MS);
		return () => clearInterval(t);
	}, [endpoint, poll]);

	const sendTest = async () => {
		await fetch(`${hookUrl(id)}/test?source=dashboard`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-hookpeek-test": "1" },
			body: JSON.stringify({ ...SAMPLE, created: Math.floor(Date.now() / 1000) }),
		});
		poll();
	};

	const clear = async () => {
		if (!confirm("Delete every captured request for this endpoint?")) return;
		await api.clearRequests(id);
		setItems([]);
		setSelected(null);
		newest.current = undefined;
	};

	if (missing) {
		return (
			<div className="mx-auto max-w-md px-4 py-32 text-center">
				<p className="font-mono text-sm text-hook">410 · gone</p>
				<h1 className="mt-3 text-2xl font-semibold text-ink">This endpoint expired or never existed</h1>
				<p className="mt-3 text-muted">Endpoints and their requests are deleted 7 days after creation.</p>
				<button onClick={() => navigate("/")} className="btn btn-primary mt-8">
					Create a new one
				</button>
			</div>
		);
	}

	const url = hookUrl(id);

	return (
		<div className="flex h-screen flex-col">
			<header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:flex-nowrap">
				<Logo />
				<div className="order-last flex min-w-0 flex-1 basis-full items-center gap-2 rounded-lg border border-line2 bg-panel py-1 pl-3 pr-1 sm:order-none sm:ml-4 sm:basis-auto">
					<span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-ok" aria-hidden />
					<code className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{url}</code>
					<CopyButton text={url} className="btn border-0 bg-raised px-2.5 py-1 text-xs" />
				</div>
				<div className="ml-auto flex items-center gap-2">
					{endpoint && <span className="hidden font-mono text-xs text-dim lg:inline">expires in {daysLeft(endpoint.expiresAt)}d</span>}
					<button onClick={sendTest} className="btn py-1.5 text-xs">
						Send test
					</button>
					<button onClick={clear} disabled={items.length === 0} className="btn btn-ghost py-1.5 text-xs">
						Clear
					</button>
				</div>
			</header>

			<div className="grid min-h-0 flex-1 md:grid-cols-[340px_1fr]">
				<aside className="min-h-0 overflow-y-auto border-b border-line md:border-b-0 md:border-r max-md:max-h-[40vh]">
					<div className="sticky top-0 flex items-center justify-between border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
						<span className="label">requests</span>
						<span className="font-mono text-[11px] text-dim">
							{items.length}/{limit}
						</span>
					</div>
					{items.length === 0 ? (
						<p className="px-4 py-6 text-sm text-dim">Nothing yet. Requests show up here as they arrive.</p>
					) : (
						<ul>
							{items.map((r) => (
								<li key={r.id}>
									<button
										onClick={() => setSelected(r.id)}
										aria-current={selected === r.id}
										className={`block w-full border-b border-line px-4 py-3 text-left transition-colors ${
											selected === r.id ? "bg-raised" : "hover:bg-panel"
										} ${fresh.has(r.id) ? "animate-flash" : ""}`}
									>
										<div className="flex items-center gap-2 font-mono text-[12.5px]">
											<span className={`w-14 shrink-0 font-semibold ${METHOD_COLOR[r.method] ?? "text-muted"}`}>{r.method}</span>
											<span className="truncate text-body">
												{r.path}
												<span className="text-dim">{r.query}</span>
											</span>
										</div>
										<div className="mt-1 flex gap-3 pl-16 font-mono text-[11px] text-dim">
											<span>{timeAgo(r.receivedAt, now)}</span>
											<span>{formatBytes(r.size)}</span>
											{r.sourceIp && <span className="truncate">{r.sourceIp}</span>}
										</div>
									</button>
								</li>
							))}
						</ul>
					)}
				</aside>

				<section className="min-h-0 overflow-y-auto">
					{selected ? (
						<RequestDetail key={selected} endpointId={id} requestId={selected} />
					) : (
						<Waiting id={id} url={url} />
					)}
				</section>
			</div>
		</div>
	);
};

const Waiting = ({ id, url }: { id: string; url: string }) => (
	<div className="mx-auto max-w-2xl px-6 py-14">
		<p className="flex items-center gap-2 font-mono text-sm text-hook">
			<span className="h-2 w-2 animate-pulse rounded-full bg-hook" /> listening…
		</p>
		<h2 className="mt-3 text-2xl font-semibold text-ink">Point a webhook at your URL</h2>
		<p className="mt-2 text-muted">
			Paste it into Stripe, GitHub, or any webhook settings page, or press <b className="text-body">Send test</b>. Any path under
			it works too, like <code className="font-mono text-body">/stripe</code> or <code className="font-mono text-body">/github</code>.
		</p>
		<p className="label mt-8">from your terminal</p>
		<Code className="mt-2">{`curl -X POST ${url}/hello \\
  -H 'content-type: application/json' \\
  -d '{"hello":"world"}'`}</Code>
		<p className="label mt-6">forward to localhost</p>
		<Code className="mt-2">{`npx github:mferraro23/hookpeek listen ${id} \\
  --to http://localhost:3000 --server ${window.location.origin}`}</Code>
	</div>
);
