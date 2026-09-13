import { useEffect, useMemo, useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { BrandMark } from "@/components/drama/brand-mark.tsx";
import { TurnstileField, turnstileEnabled } from "@/components/drama/turnstile-field.tsx";
import { ApiError, studio } from "@/lib/api.ts";
import { signIn, updatePassword } from "@/lib/session.ts";

type Mode = "signin" | "signup" | "reset" | "update";

export default function Page() {
  const search = usePageContext().urlParsed.search;
  const initial = search.mode === "update" ? "update" : search.mode === "signup" ? "signup" : search.mode === "reset" ? "reset" : "signin";
  const [mode, setMode] = useState<Mode>(initial);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const captcha = turnstileEnabled();
  const onToken = useMemo(() => (value: string) => setToken(value), []);

  useEffect(() => {
    setToken("");
    setError(null);
    setNotice(null);
  }, [mode]);

  const title =
    mode === "signup" ? "Create your studio" : mode === "reset" ? "Reset password" : mode === "update" ? "Set a new password" : "Sign in to your studio";

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        await signIn(email, password);
        await studio.accept().catch(() => undefined);
        window.location.href = "/";
        return;
      }
      if (mode === "signup") {
        if (password.length < 8) throw new Error("Use at least 8 characters");
        if (!accepted) throw new Error("Accept the terms to create an account");
        if (captcha && !token) throw new Error("Complete the verification check");
        await studio.signup({ email, password, turnstile_token: token || undefined, accept: true });
        await signIn(email, password);
        await studio.accept().catch(() => undefined);
        window.location.href = "/";
        return;
      }
      if (mode === "reset") {
        if (captcha && !token) throw new Error("Complete the verification check");
        await studio.recover({ email, turnstile_token: token || undefined });
        setNotice("Check your email for a reset link.");
        return;
      }
      if (password.length < 8) throw new Error("Use at least 8 characters");
      if (password !== confirm) throw new Error("Passwords do not match");
      await updatePassword(password);
      window.location.href = "/";
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : "Could not continue");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-secondary bg-primary_alt p-8 shadow-lg">
        <div className="mb-6">
          <BrandMark />
          <p className="mt-3 text-sm text-tertiary">{title}</p>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {mode !== "update" ? <Input label="Email" type="email" value={email} onChange={setEmail} isRequired /> : null}
          {mode === "signin" || mode === "signup" || mode === "update" ? (
            <Input label="Password" type="password" value={password} onChange={setPassword} isRequired />
          ) : null}
          {mode === "update" ? (
            <Input label="Confirm password" type="password" value={confirm} onChange={setConfirm} isRequired />
          ) : null}
          {mode === "signup" ? (
            <label className="flex items-start gap-2 text-sm text-secondary">
              <input
                type="checkbox"
                className="mt-1"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              <span>
                I accept the{" "}
                <a className="font-semibold text-brand-secondary" href="/legal/terms">
                  Terms
                </a>{" "}
                and{" "}
                <a className="font-semibold text-brand-secondary" href="/legal/privacy">
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          ) : null}
          {(mode === "signup" || mode === "reset") && captcha ? <TurnstileField action={mode} onToken={onToken} /> : null}
          {error ? <p className="text-sm text-error-primary">{error}</p> : null}
          {notice ? <p className="text-sm text-secondary">{notice}</p> : null}
          <Button type="submit" color="primary" size="lg" className="w-full" isDisabled={busy}>
            {busy
              ? "Working…"
              : mode === "signup"
                ? "Create account"
                : mode === "reset"
                  ? "Send reset link"
                  : mode === "update"
                    ? "Save password"
                    : "Sign in"}
          </Button>
        </form>
        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {mode !== "signin" ? (
            <button type="button" className="font-semibold text-brand-secondary" onClick={() => setMode("signin")}>
              Sign in
            </button>
          ) : null}
          {mode !== "signup" ? (
            <button type="button" className="font-semibold text-brand-secondary" onClick={() => setMode("signup")}>
              Create account
            </button>
          ) : null}
          {mode !== "reset" && mode !== "update" ? (
            <button type="button" className="font-semibold text-brand-secondary" onClick={() => setMode("reset")}>
              Forgot password
            </button>
          ) : null}
        </div>
        <p className="mt-5 text-xs text-tertiary">
          New accounts stay behind the beta invite until an admin opens the door.
        </p>
      </div>
    </main>
  );
}
