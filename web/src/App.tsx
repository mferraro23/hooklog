import { useEffect, useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { Landing } from "./components/Landing";

const route = () => {
	const m = window.location.pathname.match(/^\/e\/([A-Za-z0-9_-]{16})\/?$/);
	return m ? { page: "endpoint" as const, id: m[1] } : { page: "home" as const };
};

const App = () => {
	const [r, setR] = useState(route);

	useEffect(() => {
		const onPop = () => setR(route());
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	return r.page === "endpoint" ? <Dashboard key={r.id} id={r.id} /> : <Landing />;
};

export default App;
