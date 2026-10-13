#!/usr/bin/env node
// hookpeek CLI: forwards webhooks captured by a hookpeek endpoint to a local server.
// Usage: hookpeek listen <endpoint-id> --to http://localhost:3000 [--server https://your-hookpeek-host]
// Requires Node 18+ (global fetch). No dependencies.

const DEFAULT_SERVER = process.env.HOOKPEEK_SERVER;
const POLL_MS = 1500;
const HOP = new Set(["host", "content-length", "connection", "keep-alive", "transfer-encoding", "accept-encoding", "upgrade"]);

const c = {
	dim: (s) => `\x1b[2m${s}\x1b[0m`,
	green: (s) => `\x1b[32m${s}\x1b[0m`,
	red: (s) => `\x1b[31m${s}\x1b[0m`,
	yellow: (s) => `\x1b[33m${s}\x1b[0m`,
	bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const usage = () => {
	console.log(`
${c.bold("hookpeek")} — forward captured webhooks to your machine

  ${c.bold("hookpeek listen")} <endpoint-id> --to <url> [--server <url>]

  --to       where to forward, e.g. http://localhost:3000
  --server   your hookpeek host, e.g. https://hookpeek.example.com (or set $HOOKPEEK_SERVER)
`);
	process.exit(1);
};

const parseArgs = (argv) => {
	const [cmd, id, ...rest] = argv;
	const opts = {};
	for (let i = 0; i < rest.length; i += 2) {
		if (!rest[i]?.startsWith("--")) usage();
		opts[rest[i].slice(2)] = rest[i + 1];
	}
	if (cmd !== "listen" || !id || !opts.to || !(opts.server ?? DEFAULT_SERVER)) usage();
	return { id, to: opts.to.replace(/\/$/, ""), server: (opts.server ?? DEFAULT_SERVER).replace(/\/$/, "") };
};

const getJson = async (url) => {
	const res = await fetch(url);
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
	return data;
};

const forward = async (to, r) => {
	const headers = new Headers();
	for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) headers.set(k, v);
	const hasBody = !["GET", "HEAD"].includes(r.method) && r.body;
	const started = Date.now();
	const res = await fetch(to + (r.path === "/" ? "" : r.path) + r.query, {
		method: r.method,
		headers,
		body: hasBody ? Buffer.from(r.body, r.bodyEncoding === "base64" ? "base64" : "utf8") : undefined,
		redirect: "manual",
	});
	await res.arrayBuffer();
	return { status: res.status, ms: Date.now() - started };
};

const main = async () => {
	const { id, to, server } = parseArgs(process.argv.slice(2));
	const api = `${server}/api/endpoints/${id}`;

	try {
		await getJson(api);
	} catch (e) {
		console.error(c.red(e.status === 404 ? `Endpoint ${id} not found or expired.` : `Can't reach ${server}: ${e.message}`));
		process.exit(1);
	}

	// Start from "now": only requests that arrive after we connect are forwarded.
	let newest = (await getJson(`${api}/requests`)).items[0]?.id;

	console.log(`${c.green("●")} listening on ${c.bold(`${server}/api/h/${id}`)}`);
	console.log(`${c.dim("→")} forwarding to ${c.bold(to)}  ${c.dim("(ctrl+c to stop)")}\n`);

	for (;;) {
		try {
			const { items } = await getJson(`${api}/requests${newest ? `?after=${newest}` : ""}`);
			if (items.length) newest = items[0].id;
			for (const summary of items.reverse()) {
				const time = new Date(summary.receivedAt).toLocaleTimeString();
				const line = `${c.dim(time)} ${summary.method.padEnd(6)} ${summary.path}${summary.query}`;
				try {
					const full = await getJson(`${api}/requests/${summary.id}`);
					const { status, ms } = await forward(to, full);
					const color = status < 300 ? c.green : status < 400 ? c.yellow : c.red;
					console.log(`${line}  ${color(status)} ${c.dim(`${ms}ms`)}`);
				} catch (e) {
					console.log(`${line}  ${c.red(`✗ ${e.cause?.code ?? e.message}`)}`);
				}
			}
		} catch (e) {
			if (e.status === 404) {
				console.error(c.red("\nEndpoint expired."));
				process.exit(1);
			}
			// network blip: keep polling
		}
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
};

main();
