import { usePageContext } from "vike-react/usePageContext";

export default function Page() {
  const { is404 } = usePageContext();

  if (is404) {
    return (
      <main className="card">
        <h1>Page not found</h1>
        <p>That URL does not match a page in this demo.</p>
      </main>
    );
  }

  return (
    <main className="card">
      <h1>Something went wrong</h1>
      <p>The server could not render this page.</p>
    </main>
  );
}
