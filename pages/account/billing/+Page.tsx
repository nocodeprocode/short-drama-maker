import { useEffect, useRef, useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { Radio, RadioGroup } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RadioCard, RadioCardGroup } from "@/components/base/radio-card/radio-card";
import { Select } from "@/components/base/select/select";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { AccountSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import { CTA } from "@/engine/present.ts";
import {
  BLOCK_SKUS,
  CREDIT_PRESETS,
  DEFAULT_COMMISSION_LENGTH,
  commissionLength,
  commissionSku,
  episodeSeconds,
  finishedRuntimeLabel,
  retailFor,
  runtimeLabel,
  skuLabel,
  type CommissionLength,
  type VideoTier,
} from "@/lib/catalog.ts";
import { ApiError, studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";
import { cx } from "@/utils/cx";

const LENGTHS: Array<{ value: CommissionLength; label: string }> = [
  { value: "45_60", label: "60 sec" },
  { value: "60_90", label: "90 sec" },
  { value: "120_180", label: "120 sec" },
];

function money(amount: number) {
  return `$${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`;
}

function paidOn(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function Page() {
  const requestedSeries = String(usePageContext().urlParsed.search.series ?? "").trim();
  const { data, error, reload } = useStudio("billing", () => studio.billing());
  const [sku, setSku] = useState<number>(30);
  const [length, setLength] = useState<CommissionLength>(DEFAULT_COMMISSION_LENGTH);
  const [videoTier, setVideoTier] = useState<VideoTier>("pro");
  const [seriesId, setSeriesId] = useState<string>(requestedSeries);
  const [preset, setPreset] = useState<number>(49);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState<"order" | "wallet" | "portal" | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const [gap, setGap] = useState<number | null>(null);
  const appliedShow = useRef("");

  useEffect(() => {
    if (!data) return;
    const id = seriesId || requestedSeries || data.series.find((item) => item.started)?.id || "";
    if (!id || appliedShow.current === id) return;
    const show = data.series.find((item) => item.id === id);
    if (!show) return;
    appliedShow.current = id;
    setSku(commissionSku(show.target_episode_count ?? 30));
    setLength(commissionLength(show.episode_length));
    if (show.video_tier === "catalog" || show.video_tier === "pro") setVideoTier(show.video_tier);
  }, [data, seriesId, requestedSeries]);

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;
  if (!data) return <AccountSkeleton />;

  const startedShows = data.series.filter((show) => show.started);
  const selectedSeries = seriesId || requestedSeries || startedShows[0]?.id || "";
  const selectedShow = data.series.find((show) => show.id === selectedSeries);
  const selectedIsDraft = Boolean(selectedShow && !selectedShow.started);
  const catalog = BLOCK_SKUS.map((count) => ({
    sku: count,
    retail: retailFor(count, "balanced", length, videoTier),
  }));
  const picked = catalog.find((item) => item.sku === sku) ?? catalog[1];
  const wallet = data.credit_balance ?? 0;
  const loadAmount = custom.trim() ? Number(custom) : preset;
  const draftRetail = selectedShow
    ? retailFor(
        commissionSku(selectedShow.target_episode_count ?? sku),
        "balanced",
        commissionLength(selectedShow.episode_length ?? length),
        selectedShow.video_tier === "catalog" ? "catalog" : videoTier,
      )
    : 0;

  const loadWallet = async (amount = loadAmount) => {
    if (!Number.isFinite(amount) || amount < 10) {
      setFail("Enter at least $10.");
      return;
    }
    setBusy("wallet");
    setFail(null);
    try {
      const session = await studio.loadCredits(Math.round(amount));
      window.location.href = session.url;
    } catch (caught) {
      setFail(caught instanceof ApiError || caught instanceof Error ? caught.message : "Could not load credit");
      setBusy(null);
    }
  };

  const order = async () => {
    if (!selectedSeries) {
      setFail("Start a show first, then extend it here.");
      return;
    }
    setBusy("order");
    setFail(null);
    setGap(null);
    try {
      const created = await studio.createProduction({
        start_confirmed: true,
        series_id: selectedSeries,
        sku,
        priority: "balanced",
        episode_length: length,
        video_tier: videoTier,
        mode: "autopilot",
      });
      window.location.href = `/productions/${created.id}`;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 402) {
        const shortfall = Math.max(10, Math.ceil(Number(caught.body.shortfall ?? 0)));
        setGap(shortfall);
        setFail(`Wallet is short ${money(shortfall)}. Load the gap, then start the run.`);
        setBusy(null);
        return;
      }
      setFail(caught instanceof ApiError || caught instanceof Error ? caught.message : "Could not start the run");
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy("portal");
    setFail(null);
    try {
      const session = await studio.portal();
      window.location.href = session.url;
    } catch (caught) {
      setFail(caught instanceof ApiError || caught instanceof Error ? caught.message : "Could not open receipts");
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Billing"
        subtitle="Load studio credit. Start a draft from the show. Add episodes only after a run has begun."
      />
      <PageBody className="max-w-xl">
        <div className="rounded-xl bg-primary p-6 ring-1 ring-secondary ring-inset">
          <p className="text-sm font-medium text-tertiary">Wallet</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <b className="figure text-display-sm font-semibold">{money(wallet)}</b>
            <span className="truncate text-sm text-tertiary">{data.email}</span>
          </div>
          <p className="mt-2 text-sm text-tertiary">Unused credit with no show attached. Series leftover is not drained from here.</p>
          <div className="mt-5">
            <RadioCardGroup
              aria-label="Amount to load"
              columns={5}
              value={custom ? "" : String(preset)}
              onChange={(value) => {
                setPreset(Number(value));
                setCustom("");
              }}
            >
              {CREDIT_PRESETS.map((value) => (
                <RadioCard key={value} value={String(value)} label={money(value)} />
              ))}
            </RadioCardGroup>
          </div>
          <div className="mt-4">
            <Input
              label="Custom amount"
              inputMode="decimal"
              placeholder="250"
              value={custom}
              onChange={setCustom}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button color="primary" isDisabled={busy !== null} onClick={() => void loadWallet(gap ?? loadAmount)}>
              {busy === "wallet" ? "Opening checkout…" : `Load ${money(gap ?? (Number.isFinite(loadAmount) ? loadAmount : preset))}`}
            </Button>
            <Button color="secondary" isDisabled={busy !== null} onClick={() => void openPortal()}>
              {busy === "portal" ? "Opening…" : "Receipts & cards"}
            </Button>
          </div>
        </div>

        {selectedIsDraft && selectedShow ? (
          <div className="mt-5 rounded-xl bg-primary p-6 ring-1 ring-secondary ring-inset">
            <h2 className="text-md font-semibold">Start {selectedShow.title}</h2>
            <p className="mt-1 text-sm text-tertiary">
              This is still a draft. Nothing has been shot. Pay the run you already locked — do not add episodes here.
            </p>
            <p className="mt-4 text-sm text-secondary">
              {skuLabel(commissionSku(selectedShow.target_episode_count))} · {runtimeLabel(episodeSeconds(commissionLength(selectedShow.episode_length)))} each · {finishedRuntimeLabel(commissionSku(selectedShow.target_episode_count), commissionLength(selectedShow.episode_length))} finished
              {selectedShow.video_tier === "catalog" ? " · Catalog picture" : " · Pro picture"}
            </p>
            <div className="mt-4 flex items-baseline justify-between gap-3">
              <span className="text-sm text-tertiary">This run</span>
              <b className="figure text-lg font-semibold">{money(draftRetail)}</b>
            </div>
            {fail ? <p className="mt-3 text-sm text-error-primary">{fail}</p> : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button href={`/series/${selectedShow.id}`} color="primary">
                Open the draft
              </Button>
              <Button href={`/new?draft=${selectedShow.id}`} color="tertiary">
                Change length or count
              </Button>
            </div>
          </div>
        ) : startedShows.length ? (
          <div className="mt-5 rounded-xl bg-primary p-6 ring-1 ring-secondary ring-inset">
            <h2 className="text-md font-semibold">Add episodes</h2>
            <p className="mt-1 text-sm text-tertiary">
              For a show that is already shooting. Paid from the wallet.
            </p>
            <div className="mt-4">
              <Select
                label="Show"
                selectedKey={selectedSeries}
                onSelectionChange={(key) => setSeriesId(String(key))}
                items={startedShows.map((show) => ({ id: show.id, label: show.title }))}
              />
            </div>
            <div className="mt-4">
              <RadioGroup
                aria-label="Episode length"
                value={length}
                onChange={(value) => setLength(commissionLength(value))}
                className="flex flex-col gap-2"
              >
                <span className="text-sm font-semibold text-primary">Episode length</span>
                <div className="flex rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
                  {LENGTHS.map((item) => (
                    <Radio
                      key={item.value}
                      value={item.value}
                      className={({ isSelected, isFocusVisible }) =>
                        cx(
                          "flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-md text-sm font-semibold",
                          isSelected ? "bg-primary text-primary shadow-xs" : "text-tertiary",
                          isFocusVisible && "outline-2 outline-offset-2 outline-focus-ring",
                        )
                      }
                    >
                      {item.label}
                    </Radio>
                  ))}
                </div>
                <p className="text-sm text-tertiary">
                  {sku} episodes at {runtimeLabel(episodeSeconds(length))} each is {finishedRuntimeLabel(sku, length)} of finished show.
                </p>
              </RadioGroup>
            </div>
            <div className="mt-4">
              <RadioCardGroup
                aria-label="Picture"
                columns={2}
                value={videoTier}
                onChange={(value) => setVideoTier(value === "catalog" ? "catalog" : "pro")}
              >
                <RadioCard value="pro" label="Pro" detail={money(retailFor(sku, "balanced", length, "pro"))} description="Seedance 2.5" />
                <RadioCard value="catalog" label="Catalog" detail={money(retailFor(sku, "balanced", length, "catalog"))} description="Seedance 2.0 mini · 25% less" />
              </RadioCardGroup>
            </div>
            <div className="mt-4">
              <RadioCardGroup
                aria-label="Episodes to add"
                columns={2}
                value={String(sku)}
                onChange={(value) => setSku(commissionSku(value))}
              >
                {catalog.map((item) => (
                  <RadioCard
                    key={String(item.sku)}
                    value={String(item.sku)}
                    label={skuLabel(item.sku)}
                    detail={money(item.retail)}
                  />
                ))}
              </RadioCardGroup>
            </div>
            {fail ? <p className="mt-3 text-sm text-error-primary">{fail}</p> : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button color="primary" isDisabled={busy !== null} onClick={() => void order()}>
                {busy === "order" ? "Starting…" : picked ? `Add ${skuLabel(picked.sku)} · ${money(picked.retail)}` : CTA.orderMore}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-xl bg-primary p-6 ring-1 ring-secondary ring-inset">
            <h2 className="text-md font-semibold">No show to extend yet</h2>
            <p className="mt-1 text-sm text-tertiary">Start a draft first. You can add episodes after the first run is paid.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button href="/new" color="primary">
                Commission a show
              </Button>
            </div>
          </div>
        )}

        <div className="mt-5 rounded-xl bg-primary p-6 ring-1 ring-secondary ring-inset">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-tertiary">Production slots</span>
            <b className="figure">
              {data.slots_used} of {data.slots_total}
            </b>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-tertiary">Last payment</span>
            <b className="text-right">
              {data.last_payment
                ? `${money(data.last_payment.amount)}${data.last_payment.series_title ? ` · ${data.last_payment.series_title}` : " · Wallet"} · ${paidOn(data.last_payment.created_at)}`
                : "None yet"}
            </b>
          </div>
        </div>

        {data.receipts.length ? (
          <div className="mt-5 overflow-hidden rounded-xl bg-primary ring-1 ring-secondary ring-inset">
            <h3 className="px-6 py-4 text-md font-semibold">Recent payments</h3>
            <div className="divide-y divide-secondary border-t border-secondary">
              {data.receipts.map((row) => (
                <div key={row.id} className="flex items-baseline justify-between gap-3 px-6 py-3 text-sm">
                  <span className="text-secondary">
                    {row.series_title ?? "Wallet"} · {paidOn(row.created_at)}
                  </span>
                  <b className="figure">{money(row.amount)}</b>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
