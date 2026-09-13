"use client";

import type { ReactNode } from "react";
import type { RadioGroupProps as AriaRadioGroupProps, RadioProps as AriaRadioProps } from "react-aria-components";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup } from "react-aria-components";
import { HintText } from "@/components/base/input/hint-text";
import { Label } from "@/components/base/input/label";
import { cx } from "@/utils/cx";

export interface RadioCardGroupProps extends AriaRadioGroupProps {
    label?: string;
    hint?: ReactNode;
    /** Cards per row from the mobile breakpoint up. Ignored when layout is stack. */
    columns?: 1 | 2 | 3 | 4 | 5;
    /** stack lets the caller group cards; grid is the default. */
    layout?: "grid" | "stack";
}

const COLUMNS: Record<NonNullable<RadioCardGroupProps["columns"]>, string> = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 lg:grid-cols-5",
};

export const RadioCardGroup = ({ label, hint, columns = 2, layout = "grid", className, children, ...props }: RadioCardGroupProps) => {
    return (
        <AriaRadioGroup
            {...props}
            className={(state) => cx("flex w-full flex-col gap-2.5", typeof className === "function" ? className(state) : className)}
        >
            {(state) => (
                <>
                    {label && <Label isRequired={state.isRequired}>{label}</Label>}
                    <div className={layout === "stack" ? "flex flex-col gap-5" : cx("grid gap-2", COLUMNS[columns])}>
                        {typeof children === "function" ? children(state) : children}
                    </div>
                    {hint && <HintText isInvalid={state.isInvalid}>{hint}</HintText>}
                </>
            )}
        </AriaRadioGroup>
    );
};

RadioCardGroup.displayName = "RadioCardGroup";

export interface RadioCardProps extends Omit<AriaRadioProps, "children"> {
    /** Primary line, for example "30 episodes". */
    label: ReactNode;
    /** Emphasised secondary line, usually the price. */
    detail?: ReactNode;
    /** Supporting sentence under the detail. */
    description?: ReactNode;
    /** Quiet tag, for example "Small" or "Suggested". */
    badge?: ReactNode;
}

export const RadioCard = ({ label, detail, description, badge, className, ...props }: RadioCardProps) => {
    return (
        <AriaRadio
            {...props}
            className={(state) =>
                cx(
                    "flex cursor-pointer flex-col rounded-lg bg-primary p-2.5 text-left ring-1 transition duration-100 ease-linear ring-inset sm:p-3.5",
                    state.isSelected ? "ring-2 ring-brand" : "ring-primary hover:ring-secondary",
                    state.isFocusVisible && "outline-2 outline-offset-2 outline-focus-ring",
                    state.isDisabled && "cursor-not-allowed opacity-50",
                    "active:scale-[0.99]",
                    typeof className === "function" ? className(state) : className,
                )
            }
        >
            <span className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold text-primary sm:text-sm">{label}</span>
                {badge && <span className="text-xs font-medium text-tertiary">{badge}</span>}
            </span>
            {detail && <span className="figure mt-1 block text-sm font-semibold text-primary sm:text-md">{detail}</span>}
            {description && <span className="mt-1 hidden text-sm text-tertiary sm:block">{description}</span>}
        </AriaRadio>
    );
};

RadioCard.displayName = "RadioCard";
