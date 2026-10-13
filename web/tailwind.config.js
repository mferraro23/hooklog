/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	theme: {
		extend: {
			colors: {
				bg: "#0c0d10",
				panel: "#121318",
				raised: "#1a1c22",
				line: "#24262e",
				line2: "#30333d",
				ink: "#f2f3f5",
				body: "#c8cad1",
				muted: "#8b8f9a",
				dim: "#666a75",
				hook: "#f5a524",
				ok: "#3fb950",
				bad: "#f85149",
				info: "#58a6ff",
				violet: "#bc8cff",
			},
			fontFamily: {
				sans: ["Inter", "system-ui", "sans-serif"],
				mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
			},
			keyframes: {
				flash: { from: { backgroundColor: "rgba(245,165,36,.14)" }, to: { backgroundColor: "transparent" } },
			},
			animation: { flash: "flash 1.6s ease-out" },
		},
	},
	plugins: [],
};
