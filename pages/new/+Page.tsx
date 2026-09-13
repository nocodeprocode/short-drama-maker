import { useEffect, useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { FilmSlate, Sparkle, UploadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button";
import { FileDrop } from "@/components/base/file-drop/file-drop";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/input/textarea";
import { Radio, RadioGroup } from "react-aria-components";
import { RadioCard, RadioCardGroup } from "@/components/base/radio-card/radio-card";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { CTA } from "@/engine/present.ts";
import {
  COMMISSION_SKUS,
  DEFAULT_COMMISSION_LENGTH,
  DEFAULT_COMMISSION_SKU,
  commissionLength,
  commissionSku,
  episodeSeconds,
  finishedRuntimeSeconds,
  retailFor,
  runtimeLabel,
  skuLabel,
  gapCharge,
  MIN_WALLET_LOAD,
  type CommissionLength,
  type CommissionSku,
  type ProductionPriority,
  type VideoTier,
} from "@/lib/catalog.ts";
import { readScriptFile } from "@/lib/commission-files.ts";
import { ApiError, studio } from "@/lib/api.ts";
import { useSessionReady, useStudio } from "@/lib/use-studio.ts";
import { cx } from "@/utils/cx";

const LENGTHS: Array<{ value: CommissionLength; label: string }> = [
  { value: "45_60", label: "60 sec" },
  { value: "60_90", label: "90 sec" },
  { value: "120_180", label: "120 sec" },
];

const PICTURE: Array<{ value: VideoTier; label: string; note: string }> = [
  { value: "pro", label: "Pro", note: "Seedance 2.5. Default for a finished show." },
  { value: "catalog", label: "Catalog", note: "Seedance 2.0 mini. Same run, 25% less." },
];

const BUDGETS: Array<{ value: ProductionPriority; label: string; note: string }> = [
  { value: "fast", label: "Fast", note: "Accepts small imperfections" },
  { value: "balanced", label: "Balanced", note: "Fixes noticeable issues" },
  { value: "quality", label: "Quality", note: "Strict review, more retries" },
];

const DIRECTIONS = [
  { id: "surprise", label: "Surprise me" },
  { id: "contract", label: "Contract marriage" },
  { id: "secret_child", label: "Secret child" },
  { id: "revenge", label: "Revenge" },
  { id: "hidden_identity", label: "Hidden identity" },
  { id: "second_chance", label: "Second chance" },
  { id: "family_secret", label: "Family secret" },
  { id: "amnesia", label: "Memory loss" },
];

const SETTINGS = ["Private hospital", "Penthouse", "Family estate", "Hotel empire", "Law firm", "Tech campus"];

function money(amount: number) {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

type Script = { text: string; name: string; languageName: string };

export default function Page() {
  const draftId = String(usePageContext().urlParsed.search.draft ?? "").trim();
  const [sku, setSku] = useState<CommissionSku>(DEFAULT_COMMISSION_SKU);
  const [length, setLength] = useState<CommissionLength>(DEFAULT_COMMISSION_LENGTH);
  const [videoTier, setVideoTier] = useState<VideoTier>("pro");
  const [priority, setPriority] = useState<ProductionPriority>("balanced");

  const [source, setSource] = useState<"write" | "upload">("write");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [hint, setHint] = useState("");
  const [lead, setLead] = useState("");
  const [opposite, setOpposite] = useState("");
  const [setting, setSetting] = useState("");
  const [category, setCategory] = useState("surprise");
  const [writing, setWriting] = useState(false);

  const [script, setScript] = useState<Script | null>(null);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);

  const [advanced, setAdvanced] = useState(false);
  const [policy, setPolicy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gap, setGap] = useState<{ needed: number; available: number; shortfall: number } | null>(null);
  const [openDraftId, setOpenDraftId] = useState(draftId);

  const sessionReady = useSessionReady();
  const { data: billing } = useStudio("billing", () => studio.billing());

  // Local math. The quote must never wait on the network.
  const retail = retailFor(sku, priority, length, videoTier);
  const perEpisode = episodeSeconds(length);
  const totalRuntime = runtimeLabel(finishedRuntimeSeconds(sku, length));
  const wallet = billing?.credit_balance ?? 0;
  const hasStory = Boolean(title.trim() && brief.trim());

  useEffect(() => {
    if (!sessionReady || !draftId) return;
    void loadDraft(draftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady, draftId]);

  async function loadDraft(id: string) {
    setWriting(true);
    setError(null);
    try {
      const series = await studio.seriesOne(id);
      setTitle(series.title);
      setBrief(series.description ?? "");
      setSku(commissionSku(series.target_episode_count ?? DEFAULT_COMMISSION_SKU));
      setLength(commissionLength(series.episode_length ?? DEFAULT_COMMISSION_LENGTH));
      if (series.video_tier === "catalog" || series.video_tier === "pro") setVideoTier(series.video_tier);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open that draft");
    } finally {
      setWriting(false);
    }
  }

  async function writeIdea() {
    setWriting(true);
    setError(null);
    setPolicy(null);
    try {
      const idea = await studio.storyIdea({ hint, category, lead, opposite, setting });
      setTitle(idea.title);
      setBrief(idea.brief);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) setPolicy(caught.message);
      else setError(caught instanceof Error ? caught.message : "Could not write a brief");
    } finally {
      setWriting(false);
    }
  }

  async function takeScript(file: File) {
    setScriptBusy(true);
    setScriptError(null);
    setPolicy(null);
    try {
      const text = await readScriptFile(file);
      const adapted = await studio.adaptScript(text);
      setScript({ text, name: file.name, languageName: adapted.source_language_name });
      setTitle(adapted.title);
      setBrief(adapted.brief);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) setPolicy(caught.message);
      setScriptError(caught instanceof Error ? caught.message : "Could not read that script.");
    } finally {
      setScriptBusy(false);
    }
  }

  async function startRun() {
    setBusy(true);
    setPolicy(null);
    setError(null);
    setGap(null);
    try {
      const check = await studio.moderate(`${title}\n${brief}`);
      if (!check.allowed) {
        setPolicy(check.reason ?? "This brief cannot be produced.");
        return;
      }
      const created = await studio.createProduction({
        title,
        description: brief,
        sku,
        priority,
        episode_length: length,
        video_tier: videoTier,
        mode: "autopilot",
        ...(openDraftId ? { series_id: openDraftId } : {}),
        ...(source === "upload" && script ? { script_text: script.text } : {}),
      });
      window.location.href = `/productions/${created.id}`;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 402) {
        const production = caught.body.production as { series_id?: string } | undefined;
        if (production?.series_id) setOpenDraftId(production.series_id);
        setGap({
          needed: Number(caught.body.needed ?? retail),
          available: Number(caught.body.available ?? wallet),
          shortfall: Number(caught.body.shortfall ?? 0),
        });
        return;
      }
      if (caught instanceof ApiError && caught.status === 422) setPolicy(String(caught.body.reason ?? caught.message));
      else setError(caught instanceof Error ? caught.message : "Could not start the run");
    } finally {
      setBusy(false);
    }
  }

  async function loadGap() {
    if (!gap) return;
    setBusy(true);
    setError(null);
    try {
      const back = openDraftId ? `/series/${openDraftId}` : "/new";
      const session = await studio.loadCredits(gapCharge(gap.shortfall), { success: back, cancel: back });
      window.location.href = session.url;
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : "Could not load credit");
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Commission a show"
        subtitle="Pick a length and a count. Price and runtime update as you choose."
      />
      <PageBody className="pb-28 lg:pb-8">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-5">
            <Section title="The season" note={`${sku} episodes at ${runtimeLabel(perEpisode)} each is ${totalRuntime} of finished show.`}>
              <div className="flex flex-col gap-4">
                <ChoiceRow
                  label="Episode length"
                  value={length}
                  onChange={(value) => setLength(value as CommissionLength)}
                  options={LENGTHS}
                />
                <ChoiceRow
                  label="Episode count"
                  value={String(sku)}
                  onChange={(value) => setSku(commissionSku(value))}
                  options={COMMISSION_SKUS.map((count) => ({ value: String(count), label: String(count) }))}
                />
              </div>
            </Section>

            <Section title="Picture">
              <RadioCardGroup
                aria-label="Picture tier"
                columns={2}
                value={videoTier}
                onChange={(value) => setVideoTier(value as VideoTier)}
              >
                {PICTURE.map((item) => (
                  <RadioCard
                    key={item.value}
                    value={item.value}
                    label={item.label}
                    detail={money(retailFor(sku, priority, length, item.value))}
                    description={item.note}
                  />
                ))}
              </RadioCardGroup>
            </Section>

            <Section title="The story">
              <Tabs selectedKey={source} onSelectionChange={(key) => setSource(key as "write" | "upload")}>
                <TabList aria-label="Where the story comes from">
                  <Tab id="write">Let us write it</Tab>
                  <Tab id="upload">Upload a script</Tab>
                </TabList>

                <TabPanel id="write" className="pt-5">
                  <div className="mb-4 flex flex-wrap gap-2">
                    {DIRECTIONS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={category === item.id}
                        onClick={() => setCategory(item.id)}
                        className={cx(
                          "cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition duration-100 ease-linear ring-inset outline-focus-ring",
                          "focus-visible:outline-2 focus-visible:outline-offset-2",
                          category === item.id
                            ? "bg-brand-solid text-white ring-transparent"
                            : "text-tertiary ring-secondary hover:text-secondary",
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-col gap-4">
                    <Input
                      label="Your idea"
                      value={hint}
                      onChange={setHint}
                      placeholder="A hospital heir. Leave empty and we invent a hot one."
                    />
                    <Input
                      label="Lead"
                      value={lead}
                      onChange={setLead}
                      placeholder="Who we follow. Name and what they are."
                    />
                    <Input
                      label="The other"
                      value={opposite}
                      onChange={setOpposite}
                      placeholder="The person they collide with."
                    />
                    <div className="flex flex-col gap-2">
                      <Input
                        label="Setting"
                        value={setting}
                        onChange={setSetting}
                        placeholder="The rooms we never leave."
                      />
                      <div className="flex flex-wrap gap-2">
                        {SETTINGS.map((place) => (
                          <button
                            key={place}
                            type="button"
                            aria-pressed={setting === place}
                            onClick={() => setSetting(place)}
                            className={cx(
                              "cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition duration-100 ease-linear ring-inset outline-focus-ring",
                              "focus-visible:outline-2 focus-visible:outline-offset-2",
                              setting === place
                                ? "bg-brand-solid text-white ring-transparent"
                                : "text-tertiary ring-secondary hover:text-secondary",
                            )}
                          >
                            {place}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Button
                      color="primary"
                      size="md"
                      iconLeading={Sparkle}
                      isDisabled={writing}
                      onClick={() => void writeIdea()}
                      className="self-start"
                    >
                      {writing ? "Writing…" : CTA.writeIdea}
                    </Button>
                  </div>
                </TabPanel>

                <TabPanel id="upload" className="pt-5">
                  <FileDrop
                    accept=".txt,text/plain"
                    icon={UploadSimple}
                    title="Drop your script or browse"
                    subtitle="Plain text. Any language. We translate and polish it automatically."
                    fileName={script?.name ?? null}
                    fileMeta={
                      script
                        ? `${script.languageName} · ${script.text.length.toLocaleString("en-US")} characters · translated and polished`
                        : null
                    }
                    isBusy={scriptBusy}
                    busyLabel="Reading and translating…"
                    error={scriptError}
                    onFile={(file) => void takeScript(file)}
                    onClear={() => {
                      setScript(null);
                      setScriptError(null);
                    }}
                  />
                  {!script && !scriptBusy && (
                    <p className="mt-2.5 text-sm text-tertiary">
                      We keep your plot, characters, and ending. The show is cut from your scenes, not invented around them.
                    </p>
                  )}
                </TabPanel>
              </Tabs>

              <div className="mt-5 flex flex-col gap-4 border-t border-secondary pt-5">
                <Input
                  label="Title"
                  value={title}
                  onChange={setTitle}
                  isDisabled={writing || scriptBusy}
                  placeholder={writing ? "Writing a title…" : "Generate the story, or type your own."}
                />
                <TextArea
                  label="Brief"
                  value={brief}
                  onChange={setBrief}
                  rows={8}
                  isDisabled={writing || scriptBusy}
                  placeholder={
                    writing
                      ? "Writing a brief you can keep or throw out…"
                      : "Lock the people and the rooms, then generate. Or write it yourself."
                  }
                  hint={
                    source === "upload" && script
                      ? "Translated and polished from your script. Edit anything you disagree with."
                      : "This is what the production bible is built from. Generate it, then edit anything you disagree with."
                  }
                />
              </div>
            </Section>

            <div>
              <button
                type="button"
                onClick={() => setAdvanced((value) => !value)}
                className="cursor-pointer rounded-lg text-sm font-semibold text-brand-secondary outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Retry budget: {BUDGETS.find((item) => item.value === priority)?.label}
                <span className="ml-2 font-medium text-tertiary">{advanced ? "Hide" : "Change"}</span>
              </button>
              {advanced && (
                <div className="ds-rise mt-3">
                  <RadioCardGroup
                    aria-label="Retry budget"
                    columns={3}
                    value={priority}
                    onChange={(value) => setPriority(value as ProductionPriority)}
                  >
                    {BUDGETS.map((item) => (
                      <RadioCard
                        key={item.value}
                        value={item.value}
                        label={item.label}
                        detail={money(retailFor(sku, item.value, length, videoTier))}
                        description={item.note}
                      />
                    ))}
                  </RadioCardGroup>
                </div>
              )}
            </div>
            {(gap || policy || error) && (
              <div className="lg:hidden">
                {gap ? (
                  <div className="rounded-lg bg-warning-primary p-3.5 ring-1 ring-warning-secondary ring-inset">
                    <p className="text-sm font-semibold text-primary">Load {money(gapCharge(gap.shortfall))} to start</p>
                    <p className="mt-1 text-sm text-secondary">
                      This run needs {money(gap.needed)} and your wallet has {money(gap.available)}. Saved as a draft for 14 days.
                    </p>
                    {gapCharge(gap.shortfall) > gap.shortfall + 1 ? (
                      <p className="mt-1 text-sm text-secondary">
                        {money(MIN_WALLET_LOAD)} is the smallest load. The rest stays in your wallet.
                      </p>
                    ) : null}
                    {openDraftId ? (
                      <p className="mt-2 text-sm">
                        <a href={`/series/${openDraftId}`} className="font-semibold text-primary underline">
                          Open the draft
                        </a>
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {policy ? <p className="mt-3 text-sm text-error-primary">{policy}</p> : null}
                {error ? <p className="mt-3 text-sm text-error-primary">{error}</p> : null}
              </div>
            )}
          </div>

          <aside className="hidden lg:sticky lg:top-6 lg:block">
            <div className="rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset">
              <h2 className="text-sm font-semibold text-primary">{title.trim() || "Your show"}</h2>
              <p className="mt-1 text-sm text-tertiary">
                {skuLabel(sku)} · {videoTier === "pro" ? "Pro picture" : "Catalog picture"}
              </p>

              <dl className="mt-5 flex flex-col gap-2.5 border-t border-secondary pt-5 text-sm">
                <SummaryRow label="Episodes" value={String(sku)} />
                <SummaryRow label="Each" value={runtimeLabel(perEpisode)} />
                <SummaryRow label="Finished show" value={totalRuntime} emphasis />
              </dl>

              <div className="mt-5 flex items-baseline justify-between border-t border-secondary pt-5">
                <span className="text-sm font-semibold text-primary">Total</span>
                <b key={retail} className="figure ds-tick text-display-xs font-semibold text-primary">
                  {money(retail)}
                </b>
              </div>
              <div className="mt-2 flex items-baseline justify-between text-sm">
                <span className="text-tertiary">Wallet</span>
                <span className="figure text-secondary">{money(wallet)}</span>
              </div>

              {gap && (
                <div className="ds-rise mt-4 rounded-lg bg-warning-primary p-3.5 ring-1 ring-warning-secondary ring-inset">
                  <p className="text-sm font-semibold text-primary">Load {money(gapCharge(gap.shortfall))} to start</p>
                  <p className="mt-1 text-sm text-secondary">
                    This run needs {money(gap.needed)} and your wallet has {money(gap.available)}. The brief is saved as a draft for 14 days.
                  </p>
                  {gapCharge(gap.shortfall) > gap.shortfall + 1 ? (
                    <p className="mt-1 text-sm text-secondary">
                      {money(MIN_WALLET_LOAD)} is the smallest load. The rest stays in your wallet.
                    </p>
                  ) : null}
                  {openDraftId ? (
                    <p className="mt-2 text-sm">
                      <a href={`/series/${openDraftId}`} className="font-semibold text-primary underline">
                        Open the draft
                      </a>
                    </p>
                  ) : null}
                </div>
              )}
              {policy && <p className="mt-4 text-sm text-error-primary">{policy}</p>}
              {error && <p className="mt-4 text-sm text-error-primary">{error}</p>}

              <div className="mt-5">
                {gap ? (
                  <Button color="primary" size="lg" className="w-full" isDisabled={busy} onClick={() => void loadGap()}>
                    {busy ? "Opening checkout…" : `Load ${money(gapCharge(gap.shortfall))}`}
                  </Button>
                ) : (
                  <Button
                    color="primary"
                    size="lg"
                    className="w-full"
                    iconLeading={FilmSlate}
                    isDisabled={busy || writing || scriptBusy || !hasStory}
                    onClick={() => void startRun()}
                  >
                    {busy ? "Starting…" : CTA.payAndStart}
                  </Button>
                )}
              </div>

              <p className="mt-3 text-xs text-tertiary">
                Retries are included. Paid from your wallet first, Stripe only for the gap.
              </p>
            </div>
          </aside>
        </div>
        <div className="app-checkout lg:hidden">
          <div className="min-w-0">
            <p className="truncate text-xs text-tertiary">
              {sku} × {runtimeLabel(perEpisode)} · {totalRuntime}
            </p>
            <b key={retail} className="figure ds-tick text-lg font-semibold text-primary">
              {money(retail)}
            </b>
          </div>
          {gap ? (
            <Button color="primary" size="md" isDisabled={busy} onClick={() => void loadGap()}>
              {busy ? "Opening…" : `Load ${money(gapCharge(gap.shortfall))}`}
            </Button>
          ) : (
            <Button
              color="primary"
              size="md"
              isDisabled={busy || writing || scriptBusy || !hasStory}
              onClick={() => void startRun()}
            >
              {busy ? "Starting…" : CTA.payAndStart}
            </Button>
          )}
        </div>
      </PageBody>
    </>
  );
}

function ChoiceRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <RadioGroup value={value} onChange={onChange} aria-label={label} className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-primary">{label}</span>
      <div className="flex rounded-lg bg-secondary p-0.5 ring-1 ring-secondary ring-inset">
        {options.map((item) => (
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
    </RadioGroup>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset sm:p-6">
      <h2 className="text-md font-semibold text-primary">{title}</h2>
      {note && <p className="mt-1 mb-4 text-sm text-tertiary">{note}</p>}
      <div className={note ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

function SummaryRow({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-tertiary">{label}</dt>
      <dd className={cx("figure", emphasis ? "font-semibold text-primary" : "text-secondary")}>
        <span key={value} className="ds-tick inline-block">
          {value}
        </span>
      </dd>
    </div>
  );
}
