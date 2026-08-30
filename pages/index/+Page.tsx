import { useData } from "vike-react/useData";
import logoUrl from "../../assets/logo.svg";
import type { Data } from "./+data";

export default function Page() {
  const { supabase } = useData<Data>();

  return (
    <main className="card">
      <img className="logo" src={logoUrl} alt="Vike" />
      <h1>Hello World</h1>
      <p>
        This page is rendered on the server with Vike, React, and Vite, then
        hydrated in the browser.
      </p>
      <div className="badges">
        <span className="badge">SSR enabled</span>
        <span
          className={supabase.ok ? "badge badge-ok" : "badge badge-warn"}
        >
          Supabase {supabase.ok ? "connected" : "offline"}
        </span>
      </div>
      <p className="status">{supabase.message}</p>
    </main>
  );
}
