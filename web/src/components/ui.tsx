import { useState, type ReactNode } from "react";
import { navigate } from "../lib";

export const Logo = () => (
	<a
		href="/"
		onClick={(e) => {
			e.preventDefault();
			navigate("/");
		}}
		className="flex items-center gap-2 font-mono text-[15px] font-semibold text-ink"
	>
		<svg width="22" height="22" viewBox="0 0 64 64" aria-hidden>
			<path d="M38 10v26a10 10 0 1 1-20 0v-4" fill="none" stroke="#f5a524" strokeWidth="7" strokeLinecap="round" />
			<path d="M11 37l7-7 7 7" fill="none" stroke="#f5a524" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
		hookpeek
	</a>
);

export const CopyButton = ({ text, label = "Copy", className = "btn" }: { text: string; label?: string; className?: string }) => {
	const [done, setDone] = useState(false);
	return (
		<button
			type="button"
			className={className}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text);
					setDone(true);
					setTimeout(() => setDone(false), 1500);
				} catch {
					/* clipboard blocked */
				}
			}}
		>
			<span aria-live="polite">{done ? "Copied ✓" : label}</span>
		</button>
	);
};

export const Code = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
	<pre
		className={`overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-bg p-4 font-mono text-[12.5px] leading-relaxed text-body ${className}`}
	>
		{children}
	</pre>
);

/** Minimal JSON syntax highlighting over pretty-printed text. */
export const JsonView = ({ text }: { text: string }) => {
	const parts: ReactNode[] = [];
	const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
	let last = 0;
	let m: RegExpExecArray | null;
	let k = 0;
	while ((m = re.exec(text))) {
		if (m.index > last) parts.push(text.slice(last, m.index));
		if (m[1] && m[2]) {
			parts.push(<span key={k++} className="text-info">{m[1]}</span>, m[2]);
		} else if (m[1]) {
			parts.push(<span key={k++} className="text-ok">{m[1]}</span>);
		} else if (m[3]) {
			parts.push(<span key={k++} className="text-violet">{m[3]}</span>);
		} else {
			parts.push(<span key={k++} className="text-hook">{m[4]}</span>);
		}
		last = re.lastIndex;
	}
	parts.push(text.slice(last));
	return <Code>{parts}</Code>;
};

export const KeyValueTable = ({ rows, empty }: { rows: [string, string][]; empty: string }) =>
	rows.length === 0 ? (
		<p className="text-sm text-dim">{empty}</p>
	) : (
		<div className="overflow-hidden rounded-lg border border-line">
			<table className="w-full table-fixed text-left font-mono text-[12.5px]">
				<tbody>
					{rows.map(([k, v], i) => (
						<tr key={`${k}-${i}`} className="border-t border-line first:border-t-0 align-top">
							<td className="w-[38%] break-all bg-panel px-3 py-2 text-muted">{k}</td>
							<td className="break-all px-3 py-2 text-body">{v}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
