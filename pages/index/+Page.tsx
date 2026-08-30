import logoUrl from "../../assets/logo.svg";

export default function Page() {
  return (
    <main className="card">
      <img className="logo" src={logoUrl} alt="Vike" />
      <h1>Hello World</h1>
      <p>
        This page is rendered on the server with Vike, React, and Vite, then
        hydrated in the browser.
      </p>
      <span className="badge">SSR enabled</span>
    </main>
  );
}
