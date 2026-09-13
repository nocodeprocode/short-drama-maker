"use client";

import type { ReactNode, Ref } from "react";
import type { TextFieldProps as AriaTextFieldProps } from "react-aria-components";
import { TextArea as AriaTextArea, TextField as AriaTextField } from "react-aria-components";
import { HintText } from "@/components/base/input/hint-text";
import { Label } from "@/components/base/input/label";
import { cx } from "@/utils/cx";

export interface TextAreaProps extends AriaTextFieldProps {
    /** Label text shown above the field. */
    label?: string;
    /** Helper or error text shown below the field. */
    hint?: ReactNode;
    placeholder?: string;
    /** Visible rows before scrolling. */
    rows?: number;
    textAreaClassName?: string;
    ref?: Ref<HTMLTextAreaElement>;
}

export const TextArea = ({ label, hint, placeholder, rows = 5, className, textAreaClassName, ref, ...props }: TextAreaProps) => {
    return (
        <AriaTextField
            aria-label={!label ? placeholder : undefined}
            {...props}
            className={(state) =>
                cx("group flex h-max w-full flex-col items-start justify-start gap-1.5", typeof className === "function" ? className(state) : className)
            }
        >
            {({ isRequired, isInvalid }) => (
                <>
                    {label && (
                        <Label isRequired={isRequired} isInvalid={isInvalid}>
                            {label}
                        </Label>
                    )}

                    <AriaTextArea
                        ref={ref}
                        rows={rows}
                        placeholder={placeholder}
                        className={cx(
                            "w-full resize-y rounded-lg bg-primary px-3.5 py-2.5 text-md text-primary shadow-xs ring-1 ring-primary transition-shadow duration-100 ease-linear outline-hidden ring-inset",
                            "placeholder:text-placeholder",
                            "focus:ring-2 focus:ring-brand",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                            isInvalid && "ring-error_subtle focus:ring-error",
                            textAreaClassName,
                        )}
                    />

                    {hint && <HintText isInvalid={isInvalid}>{hint}</HintText>}
                </>
            )}
        </AriaTextField>
    );
};

TextArea.displayName = "TextArea";
