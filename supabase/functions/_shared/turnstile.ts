import { json } from "./auth.ts";

type Siteverify = {
  success?: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
};

export async function requireTurnstile(req: Request, token: unknown, action: string) {
  const secret = Deno.env.get("TURNSTILE_SECRET")?.trim();
  if (!secret) return;

  const value = typeof token === "string" ? token.trim() : "";
  if (!value) throw json({ error: "Complete the verification check" }, 400);

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", value);
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) body.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = (await response.json()) as Siteverify;
  if (!result.success) {
    throw json({ error: "Verification failed. Try again." }, 400);
  }
  if (result.action && result.action !== action) {
    throw json({ error: "Verification failed. Try again." }, 400);
  }
  const allowed = (Deno.env.get("TURNSTILE_HOSTNAMES") ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && result.hostname && !allowed.includes(result.hostname.toLowerCase())) {
    throw json({ error: "Verification failed. Try again." }, 400);
  }
}
