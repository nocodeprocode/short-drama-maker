"use client";

import type { ReactNode } from "react";
import { Check } from "@untitledui/icons";
import type { CheckboxProps as AriaCheckboxProps } from "react-aria-components";
import { Checkbox as AriaCheckbox } from "react-aria-components";
import { cx } from "@/utils/cx";

export interface CheckboxProps extends Omit<AriaCheckboxProps, "children"> {
    /** Main line of text next to the box. */
    label?: ReactNode;
    /** Secondary line under the label. */
    hint?: ReactNode;
}

export const Checkbox = ({ label, hint, className, ...props }: CheckboxProps) => {
    return (
        <AriaCheckbox
            {...props}
            className={(state) => cx("group flex cursor-pointer items-start gap-2.5", typeof className === "function" ? className(state) : className)}
        >
            {({ isSelected, isInvalid, isFocusVisible }) => (
                <>
                    <span
                        className={cx(
                            "mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-md ring-1 transition duration-100 ease-linear ring-inset",
                            isSelected ? "bg-brand-solid text-white ring-transparent" : "bg-primary ring-primary",
                            isInvalid && "ring-error",
                            isFocusVisible && "outline-2 outline-offset-2 outline-focus-ring",
                        )}
                    >
                        {isSelected && <Check className="size-3 stroke-[3px]" />}
                    </span>

                    {(label || hint) && (
                        <span className="min-w-0">
                            {label && <span className="block text-sm font-medium text-secondary">{label}</span>}
                            {hint && <span className="mt-0.5 block text-sm text-tertiary">{hint}</span>}
                        </span>
                    )}
                </>
            )}
        </AriaCheckbox>
    );
};

Checkbox.displayName = "Checkbox";
