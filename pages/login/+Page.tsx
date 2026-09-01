import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { signIn } from "@/lib/session.ts";

export default function Page() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-secondary bg-primary p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-linear-to-b from-brand-500 to-brand-700 text-sm font-extrabold text-white">
            DS
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Drama Space</h1>
            <p className="text-sm text-tertiary">Sign in to your studio</p>
          </div>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await signIn(email, password);
              window.location.href = "/";
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "Could not sign in");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input label="Email" type="email" value={email} onChange={setEmail} isRequired />
          <Input label="Password" type="password" value={password} onChange={setPassword} isRequired />
          {error ? <p className="text-sm text-error-primary">{error}</p> : null}
          <Button type="submit" color="primary" size="lg" className="w-full" isDisabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
