import { Button } from "@/components/base/buttons/button";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { AccountSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import { studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const { data: account, error, reload } = useStudio("account", () => studio.account());

  if (error && !account) return <LoadError message={error} onRetry={() => void reload()} />;
  if (!account) return <AccountSkeleton />;

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Blocks are paid once. Retries and repairs stay inside what you already paid."
      />
      <PageBody className="max-w-xl">
        <div className="rounded-xl border border-secondary bg-primary p-6">
          <div className="flex justify-between border-b border-secondary py-2 text-sm">
            <span className="text-tertiary">Account</span>
            <b>{account.email}</b>
          </div>
          <div className="flex justify-between py-2 text-sm">
            <span className="text-tertiary">Production slots</span>
            <b className="mono">
              {account.slots_used} / {account.slots_total}
            </b>
          </div>
          <p className="mt-4 text-sm text-tertiary">
            Payment is taken at Autopilot setup through Stripe Checkout. Nothing generates until payment clears.
          </p>
          <Button href="/new" color="primary" className="mt-5">
            Start a paid run
          </Button>
        </div>
      </PageBody>
    </>
  );
}
