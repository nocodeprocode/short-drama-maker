import { Button } from "@/components/base/buttons/button";
import { PageBody, PageHeader, logout } from "@/components/drama/app-shell.tsx";
import { AccountSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import { ThemeSetting } from "@/components/theme-toggle";
import { studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const { data: account, error, reload } = useStudio("account", () => studio.account());

  if (error && !account) return <LoadError message={error} onRetry={() => void reload()} />;
  if (!account) return <AccountSkeleton />;

  return (
    <>
      <PageHeader title="Account" subtitle={account.email} />
      <PageBody className="max-w-xl">
        <div className="rounded-xl border border-secondary bg-primary p-6">
          <div className="flex justify-between py-2 text-sm">
            <span className="text-tertiary">Name</span>
            <b>{account.display_name}</b>
          </div>
          <div className="flex justify-between py-2 text-sm">
            <span className="text-tertiary">Wallet</span>
            <b className="mono">${Math.round(account.credit_balance ?? 0)}</b>
          </div>
          <div className="flex justify-between py-2 text-sm">
            <span className="text-tertiary">Concurrent jobs</span>
            <b className="mono">
              {account.slots_used} / {account.slots_total}
            </b>
          </div>
          <div className="flex items-center justify-between gap-4 py-2 text-sm">
            <span className="text-tertiary">Appearance</span>
            <ThemeSetting />
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button href="/account/billing" color="secondary">
              Billing
            </Button>
            <Button color="secondary" onClick={() => logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </PageBody>
    </>
  );
}
