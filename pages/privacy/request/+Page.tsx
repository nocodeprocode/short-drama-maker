import { contactOrPlaceholder, LEGAL_ENTITY } from "@/legal/entity.ts";
import { PRIVACY_REQUEST_TYPES } from "@/legal/records.ts";

export default function Page() {
  const privacy = contactOrPlaceholder(LEGAL_ENTITY.privacy_email, "[PRIVACY_EMAIL]");

  return (
    <article className="w-full max-w-3xl py-4 pb-10">
      <p className="text-sm font-semibold text-brand-secondary">Privacy</p>
      <h1 className="mt-2 text-display-sm font-semibold tracking-tight text-primary">Privacy request</h1>
      <p className="mt-4 text-md leading-relaxed text-secondary">
        Tell us what you need. We verify the requester before releasing or deleting data.
        Production fulfillment is email-first until account deletion is wired to authentication.
      </p>
      <ul className="mt-4 list-disc space-y-1.5 pl-5 text-md text-secondary">
        {PRIVACY_REQUEST_TYPES.map((item) => (
          <li key={item.type}>{item.label}</li>
        ))}
      </ul>
      <p className="mt-4 text-md text-secondary">
        Email{" "}
        {privacy.href ? (
          <a className="text-brand-secondary hover:text-brand-secondary_hover" href={privacy.href}>
            {privacy.label}
          </a>
        ) : (
          privacy.label
        )}{" "}
        with the request type and the email on the account.
      </p>
      <p className="mt-4 text-md text-secondary">
        Settings → Privacy will later expose Download data, Delete account, and AI privacy
        settings. Those controls are not claimed as finished here.
      </p>
    </article>
  );
}
