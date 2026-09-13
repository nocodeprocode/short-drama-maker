import { Check } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

/**
 * The order a show gets made in, shown as an order.
 *
 * Every step here is a thing the shoot needs to exist before it runs: a name and
 * a face for each part, a plate for each room, a still for each object. A buyer
 * who skips one does not find out until episode 4 has a different penthouse in
 * it, so the run cannot be bought until they are all done — and if that is going
 * to block someone, it has to be visible from the first screen rather than
 * discovered at the paywall.
 */

export type StepState = "done" | "current" | "todo" | "blocked";

export type Step = {
  id: string;
  label: string;
  /** "3 of 5" or "Not started" — short enough to sit under the label. */
  hint: string;
  state: StepState;
  done: number;
  total: number;
};

function Dot({ step, index }: { step: Step; index: number }) {
  const done = step.state === "done";
  return (
    <span
      aria-hidden
      className={cx(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset",
        done && "bg-success-solid text-white ring-transparent",
        step.state === "current" && "bg-brand-solid text-white ring-transparent",
        step.state === "blocked" && "bg-primary text-warning-primary ring-warning",
        step.state === "todo" && "bg-primary text-tertiary ring-secondary",
      )}
    >
      {done ? <Check size={14} weight="bold" /> : index + 1}
    </span>
  );
}

export function StepRail({
  steps,
  onGo,
  activeId,
}: {
  steps: Step[];
  onGo: (id: string) => void;
  activeId?: string;
}) {
  return (
    <ol className="flex flex-col gap-1 sm:flex-row sm:items-stretch sm:gap-0">
      {steps.map((step, index) => (
        <li key={step.id} className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={() => onGo(step.id)}
            aria-current={activeId === step.id ? "step" : undefined}
            className={cx(
              "flex min-w-0 grow cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition duration-100 ease-linear",
              "outline-focus-ring hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2",
              activeId === step.id && "bg-secondary",
            )}
          >
            <Dot step={step} index={index} />
            <span className="min-w-0">
              <span
                className={cx(
                  "block truncate text-sm font-semibold",
                  step.state === "todo" ? "text-tertiary" : "text-primary",
                )}
              >
                {step.label}
              </span>
              <span className="block truncate text-xs text-tertiary">{step.hint}</span>
            </span>
          </button>
          {index < steps.length - 1 ? (
            <span aria-hidden className="hidden h-px w-4 shrink-0 bg-border-secondary sm:block" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * What to do next, in one sentence and one button. Shown under the rail so the
 * buyer never has to work out which tab their attention belongs in.
 */
export function NextStep({
  title,
  body,
  reasons,
  action,
  busy,
}: {
  title: string;
  body: string;
  reasons?: string[];
  action?: { label: string; onClick?: () => void; href?: string };
  busy?: boolean;
}) {
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-secondary pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-tertiary">{body}</p>
        {reasons?.length ? (
          <ul className="mt-2 space-y-0.5">
            {reasons.map((reason) => (
              <li key={reason} className="text-xs text-tertiary">
                · {reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {action?.href ? (
        <Button color="primary" size="sm" href={action.href} className="shrink-0">
          {action.label}
        </Button>
      ) : action ? (
        <Button color="primary" size="sm" isDisabled={busy} onClick={action.onClick} className="shrink-0">
          {busy ? "Working…" : action.label}
        </Button>
      ) : null}
    </div>
  );
}
