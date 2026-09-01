import { Button } from "@/components/base/buttons/button";
import { usePageContext } from "vike-react/usePageContext";

export default function Page() {
  const { is404 } = usePageContext();

  if (is404) {
    return (
      <main className="flex w-full flex-1 items-center justify-center py-10">
        <div className="w-full max-w-lg rounded-2xl bg-primary_alt p-8 shadow-lg ring-1 ring-secondary">
          <h1 className="text-display-sm font-semibold tracking-tight text-primary">Page not found</h1>
          <p className="mt-3 text-md text-secondary">That URL does not match a page in this product.</p>
          <Button href="/" color="primary" size="sm" className="mt-6">
            Back home
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex w-full flex-1 items-center justify-center py-10">
      <div className="w-full max-w-lg rounded-2xl bg-primary_alt p-8 shadow-lg ring-1 ring-secondary">
        <h1 className="text-display-sm font-semibold tracking-tight text-primary">Something went wrong</h1>
        <p className="mt-3 text-md text-secondary">The server could not render this page.</p>
        <Button href="/" color="primary" size="sm" className="mt-6">
          Back home
        </Button>
      </div>
    </main>
  );
}
