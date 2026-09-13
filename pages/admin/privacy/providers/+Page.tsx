import { COMPANY_PRIVACY_POLICY } from "@/legal/policy.ts";
import { AI_PROVIDER_ROUTES, INFRASTRUCTURE_PROVIDERS } from "@/legal/providers.ts";
import { studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const { data: me, error } = useStudio("me", () => studio.me());

  if (error || (me && !me.is_admin)) {
    return (
      <article className="w-full max-w-3xl py-10">
        <h1 className="text-display-sm font-semibold tracking-tight text-primary">Admins only</h1>
        <p className="mt-3 text-md text-secondary">
          The provider registry is an internal page. Sign in as an admin, or read the public{" "}
          <a className="font-semibold text-brand-secondary" href="/legal/ai-processing">
            AI processing
          </a>{" "}
          notice.
        </p>
      </article>
    );
  }

  if (!me) {
    return (
      <article className="w-full max-w-3xl py-10">
        <p className="text-sm text-tertiary">Checking access…</p>
      </article>
    );
  }

  return (
    <article className="w-full max-w-6xl py-4 pb-10">
      <p className="text-sm font-semibold text-brand-secondary">Internal registry</p>
      <h1 className="mt-2 text-display-sm font-semibold tracking-tight text-primary">
        AI provider routes
      </h1>
      <p className="mt-4 text-md leading-relaxed text-secondary">
        This table is the same registry the router and the public AI Processing page use. Strict
        mode shipped: {String(COMPANY_PRIVACY_POLICY.strict_privacy_shipped)}. Training on private
        projects: {String(COMPANY_PRIVACY_POLICY.customer_project_training)}.
      </p>
      <div className="mt-6 overflow-x-auto rounded-xl ring-1 ring-secondary">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-tertiary">
            <tr>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">ZDR class</th>
              <th className="px-3 py-2 font-medium">Training</th>
              <th className="px-3 py-2 font-medium">Region</th>
              <th className="px-3 py-2 font-medium">Verified</th>
              <th className="px-3 py-2 font-medium">Standard</th>
              <th className="px-3 py-2 font-medium">Strict allowed</th>
              <th className="px-3 py-2 font-medium">Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {AI_PROVIDER_ROUTES.map((row) => (
              <tr key={row.model_id} className="border-t border-secondary">
                <td className="px-3 py-2 text-secondary">{row.model_id}</td>
                <td className="px-3 py-2 text-secondary">{row.upstream_provider}</td>
                <td className="px-3 py-2 text-secondary">{row.retention_class}</td>
                <td className="px-3 py-2 text-secondary">{row.training_allowed ? "yes" : "no"}</td>
                <td className="px-3 py-2 text-secondary">{row.processing_region}</td>
                <td className="px-3 py-2 text-secondary">
                  {row.processing_region_verified ? "yes" : "no"}
                </td>
                <td className="px-3 py-2 text-secondary">{row.approved_standard ? "yes" : "no"}</td>
                <td className="px-3 py-2 text-secondary">{row.approved_strict ? "yes" : "no"}</td>
                <td className="px-3 py-2 text-secondary">{row.reviewed_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="mt-8 text-lg font-semibold text-primary">Infrastructure</h2>
      <div className="mt-3 overflow-x-auto rounded-xl ring-1 ring-secondary">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-tertiary">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Purpose</th>
              <th className="px-3 py-2 font-medium">Location</th>
            </tr>
          </thead>
          <tbody>
            {INFRASTRUCTURE_PROVIDERS.map((row) => (
              <tr key={row.id} className="border-t border-secondary">
                <td className="px-3 py-2 text-secondary">{row.name}</td>
                <td className="px-3 py-2 text-secondary">{row.purpose}</td>
                <td className="px-3 py-2 text-secondary">{row.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
