import { useEffect, useState } from "react";
import { Sparkle } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { CTA } from "@/engine/present.ts";
import { ApiError, studio, type Estimate } from "@/lib/api.ts";
import { useSessionReady } from "@/lib/use-studio.ts";
import { cx } from "@/utils/cx";

const LENGTHS = [
  { value: "30_45", label: "45 sec" },
  { value: "60_90", label: "90 sec" },
  { value: "120_180", label: "2 to 3 min" },
  { value: "900_1080", label: "15 min" },
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

export default function Page() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [hint, setHint] = useState("");
  const [category, setCategory] = useState("surprise");
  const [priority, setPriority] = useState<"fast" | "balanced" | "quality">("balanced");
  const [length, setLength] = useState("60_90");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [policy, setPolicy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const sessionReady = useSessionReady();

  useEffect(() => {
    if (!sessionReady) return;
    studio.estimate(2, priority, length).then(setEstimate).catch(() => setEstimate(null));
  }, [priority, length, sessionReady]);

  useEffect(() => {
    if (!sessionReady) return;
    void writeIdea();
    // First visit only. Later writes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady]);

  async function writeIdea() {
    setWriting(true);
    setError(null);
    setPolicy(null);
    try {
      const idea = await studio.storyIdea({ hint, category });
      setTitle(idea.title);
      setBrief(idea.brief);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        setPolicy(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : "Could not write a brief");
      }
    } finally {
      setWriting(false);
    }
  }

  const hasStory = Boolean(title.trim() && brief.trim());

  return (
    <>
      <PageHeader
        eyebrow="New show"
        title="What should we make?"
        subtitle="We write a brief when you arrive. Keep it, steer it, or write a new one."
      />
      <PageBody className="max-w-[720px]">
        <ol className="mb-6 flex gap-2 text-xs font-semibold">
          {[
            [1, "Story"],
            [2, "Length"],
            [3, "Pay"],
          ].map(([n, label]) => (
            <li
              key={n}
              className={cx(
                "rounded-full px-3 py-1",
                step === n ? "bg-brand-50 text-brand-700" : "bg-secondary_alt text-tertiary",
              )}
            >
              {n} {label}
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <div className="rounded-xl border border-secondary bg-primary p-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Sparkle size={16} className="text-brand-600" />
              <span className="text-sm font-semibold">Story</span>
              {writing ? (
                <Badge type="pill-color" color="brand" size="sm">
                  Writing…
                </Badge>
              ) : null}
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              {DIRECTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCategory(item.id)}
                  className={cx(
                    "rounded-full border px-3 py-1 text-xs font-semibold",
                    category === item.id
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-secondary text-tertiary hover:border-brand-200",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="mb-1.5 block text-sm font-semibold" htmlFor="hint">
              Optional: a hospital heir
            </label>
            <input
              id="hint"
              className="mb-4 w-full rounded-lg border border-primary bg-primary px-3.5 py-2.5 text-md shadow-xs"
              value={hint}
              onChange={(event) => setHint(event.target.value)}
              placeholder="A hospital heir. Or keep it empty and we invent it."
            />
            <label className="mb-1.5 block text-sm font-semibold" htmlFor="title">
              Title
            </label>
            <input
              id="title"
              className="w-full rounded-lg border border-primary bg-primary px-3.5 py-2.5 text-md shadow-xs"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={writing ? "Writing a title…" : "The Night Desk"}
              disabled={writing}
            />
            <label className="mt-5 mb-1.5 block text-sm font-semibold" htmlFor="brief">
              Brief
            </label>
            <textarea
              id="brief"
              className="min-h-32 w-full rounded-lg border border-primary bg-primary px-3.5 py-2.5 text-md leading-6 shadow-xs"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder={writing ? "Writing a brief you can keep or throw out…" : "Three sentences is enough."}
              disabled={writing}
            />
            {policy ? <p className="mt-3 text-sm text-error-primary">{policy}</p> : null}
            {error ? <p className="mt-3 text-sm text-error-primary">{error}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button color="secondary" size="sm" iconLeading={Sparkle} isDisabled={writing} onClick={() => void writeIdea()}>
                {writing ? "Writing…" : CTA.writeIdea}
              </Button>
              <Button color="primary" isDisabled={writing || !hasStory} onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="rounded-xl border border-secondary bg-primary p-6">
            <p className="mb-3 text-sm font-semibold">How long is each episode?</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {LENGTHS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setLength(item.value)}
                  className={cx(
                    "rounded-lg border bg-primary p-3.5 text-left",
                    length === item.value ? "border-brand-600 bg-brand-25 ring-4 ring-brand-100" : "border-primary",
                  )}
                >
                  <b className="block text-sm">{item.label}</b>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-5 text-sm font-semibold text-brand-700"
              onClick={() => setAdvanced((value) => !value)}
            >
              Quality: {priority[0]!.toUpperCase() + priority.slice(1)}
              <span className="ml-2 font-medium text-tertiary">{advanced ? "Hide" : "Advanced"}</span>
            </button>
            {advanced ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["fast", "Fast", "Accepts small imperfections"],
                    ["balanced", "Balanced", "Fixes noticeable issues"],
                    ["quality", "Quality", "Strict review, more retries"],
                  ] as const
                ).map(([value, label, hintText]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPriority(value)}
                    className={cx(
                      "rounded-lg border bg-primary p-3.5 text-left",
                      priority === value ? "border-brand-600 bg-brand-25 ring-4 ring-brand-100" : "border-primary",
                    )}
                  >
                    <b className="block text-sm">{label}</b>
                    <span className="text-sm text-tertiary">{hintText}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button color="secondary" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button color="primary" onClick={() => setStep(3)}>
                Continue
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="rounded-xl border border-secondary bg-primary p-6">
            <h2 className="text-lg font-semibold">Pilot · 2 episodes</h2>
            <p className="mt-1 text-sm text-secondary">
              {title || "Your show"} · {LENGTHS.find((item) => item.value === length)?.label} each ·{" "}
              {estimate?.finished_runtime_label ?? "~2 min finished runtime"}
            </p>
            <div className="mt-5 rounded-xl bg-secondary_alt p-4">
              <div className="flex items-baseline justify-between">
                <b>Today</b>
                {estimate ? <b className="mono text-xl">${estimate.retail}</b> : <span className="ds-skeleton inline-block h-7 w-16" />}
              </div>
              <p className="mt-2 text-sm text-tertiary">Retries included. You can leave after you pay.</p>
            </div>
            {policy ? <p className="mt-3 text-sm text-error-primary">{policy}</p> : null}
            {error ? <p className="mt-3 text-sm text-error-primary">{error}</p> : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button color="secondary" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                color="primary"
                size="lg"
                isDisabled={busy || writing || !hasStory}
                onClick={async () => {
                  setBusy(true);
                  setPolicy(null);
                  setError(null);
                  try {
                    const check = await studio.moderate(`${title}\n${brief}`);
                    if (!check.allowed) {
                      setPolicy(check.reason ?? "This brief cannot be produced.");
                      return;
                    }
                    const created = await studio.createProduction({
                      title,
                      description: brief,
                      sku: 2,
                      priority,
                      episode_length: length,
                      mode: "autopilot",
                    });
                    if (created.checkout?.url) {
                      window.location.href = created.checkout.url;
                      return;
                    }
                    window.location.href = `/productions/${created.id}`;
                  } catch (caught) {
                    if (caught instanceof ApiError && caught.status === 422) {
                      setPolicy(String(caught.body.reason ?? caught.message));
                    } else {
                      setError(caught instanceof Error ? caught.message : "Could not start checkout");
                    }
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Starting checkout…" : CTA.payAndStart}
              </Button>
            </div>
            <p className="mt-3 text-xs text-tertiary">Secured by Stripe</p>
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
