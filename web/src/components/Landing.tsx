import { useState } from "react";
import { api } from "../api";
import { daysLeft, navigate, recentEndpoints, rememberEndpoint } from "../lib";
import { Code, Logo } from "./ui";

export const REPO_URL = "https://github.com/mferraro23/hookpeek";
const PORTFOLIO_URL = "https://michaelferraro.dev";

const FEATURES = [
	{ title: "Capture anything", body: "Any method, any path, any content type. Headers, query, and body are stored exactly as they arrived." },
	{ title: "Watch it live", body: "Requests appear the moment they land. JSON is pretty-printed, forms are decoded, and binary is kept intact." },
	{ title: "Replay anywhere", body: "Resend any captured request to a staging or production URL and see the response status, timing, and body." },
	{ title: "Forward to localhost", body: "Run one command and every new webhook is relayed to your local server. No tunnel or port forwarding needed." },
];

export const Landing = () => {
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState("");
	const recent = recentEndpoints();

	const create = async () => {
		setBusy(true);
		setErr("");
		try {
			const ep = await api.createEndpoint();
			rememberEndpoint(ep.id, ep.expiresAt);
			navigate(`/e/${ep.id}`);
		} catch (e) {
			setErr((e as Error).message);
			setBusy(false);
		}
	};

	return (
		<div className="min-h-screen">
			<header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
				<Logo />
				<a href={REPO_URL} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-muted hover:text-ink">
					github ↗
				</a>
			</header>

			<main className="mx-auto max-w-5xl px-4 sm:px-6">
				<section className="pb-16 pt-14 sm:pt-24">
					<p className="font-mono text-xs text-hook">free · open source · no sign-up</p>
					<h1 className="mt-4 max-w-3xl text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.035em] text-ink sm:text-6xl">
						Catch every webhook.
						<br />
						<span className="text-muted">See exactly what was sent.</span>
					</h1>
					<p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
						Get a URL in one click and point Stripe, GitHub, Paystand, or anything else at it. Watch requests land live,
						inspect the payload, replay it to any server, or forward it to localhost.
					</p>
					<div className="mt-8 flex flex-wrap items-center gap-4">
						<button onClick={create} disabled={busy} className="btn btn-primary px-5 py-3 text-base">
							{busy ? "Creating…" : "Create an endpoint →"}
						</button>
						<span className="text-sm text-dim">Endpoints last 7 days.</span>
					</div>
					{err && <p className="mt-4 text-sm text-bad">{err}</p>}

					{recent.length > 0 && (
						<div className="mt-10 max-w-md">
							<p className="label">your endpoints</p>
							<ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
								{recent.map((e) => (
									<li key={e.id}>
										<a
											href={`/e/${e.id}`}
											onClick={(ev) => {
												ev.preventDefault();
												navigate(`/e/${e.id}`);
											}}
											className="flex items-center justify-between bg-panel px-3 py-2.5 font-mono text-[13px] text-body hover:bg-raised"
										>
											{e.id}
											<span className="text-dim">{daysLeft(e.expiresAt)}d left</span>
										</a>
									</li>
								))}
							</ul>
						</div>
					)}
				</section>

				<section className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
					{FEATURES.map((f) => (
						<div key={f.title} className="bg-panel p-6">
							<h2 className="font-semibold text-ink">{f.title}</h2>
							<p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
						</div>
					))}
				</section>

				<section className="grid gap-8 py-20 md:grid-cols-2">
					<div>
						<p className="label">send something</p>
						<Code className="mt-3">{`curl -X POST ${window.location.origin}/api/h/<id>/stripe \\
  -H 'content-type: application/json' \\
  -d '{"type":"invoice.paid","amount":4200}'`}</Code>
					</div>
					<div>
						<p className="label">forward to your machine</p>
						<Code className="mt-3">{`npx github:mferraro23/hookpeek listen <id> \\
  --to http://localhost:3000 --server ${window.location.origin}`}</Code>
					</div>
				</section>
			</main>

			<footer className="mx-auto flex max-w-5xl flex-col gap-2 border-t border-line px-4 py-8 text-sm text-dim sm:flex-row sm:justify-between sm:px-6">
				<span>
					Built by{" "}
					<a href={PORTFOLIO_URL} className="text-muted hover:text-ink">
						Michael Ferraro
					</a>{" "}
					· runs on Azure Static Web Apps + Functions
				</span>
				<span>Don't send real secrets. Anyone with an endpoint's URL can view it.</span>
			</footer>
		</div>
	);
};
