"use client";

import type { ReactNode } from "react";
import { Check, ChevronDown } from "@untitledui/icons";
import type { SelectProps as AriaSelectProps, Key } from "react-aria-components";
import {
    Button as AriaButton,
    ListBox as AriaListBox,
    ListBoxItem as AriaListBoxItem,
    Popover as AriaPopover,
    Select as AriaSelect,
    SelectValue as AriaSelectValue,
} from "react-aria-components";
import { HintText } from "@/components/base/input/hint-text";
import { Label } from "@/components/base/input/label";
import { cx } from "@/utils/cx";

export type SelectItem = {
    id: string;
    label: string;
    /** Secondary line shown under the label inside the menu. */
    description?: string;
    isDisabled?: boolean;
};

export interface SelectProps extends Omit<AriaSelectProps<SelectItem>, "children"> {
    label?: string;
    hint?: ReactNode;
    placeholder?: string;
    items: SelectItem[];
}

export const Select = ({ label, hint, placeholder = "Select", items, className, ...props }: SelectProps) => {
    return (
        <AriaSelect
            aria-label={!label ? placeholder : undefined}
            {...props}
            className={(state) =>
                cx("group flex h-max w-full flex-col items-start justify-start gap-1.5", typeof className === "function" ? className(state) : className)
            }
        >
            {({ isRequired, isInvalid, isOpen }) => (
                <>
                    {label && (
                        <Label isRequired={isRequired} isInvalid={isInvalid}>
                            {label}
                        </Label>
                    )}

                    <AriaButton
                        className={cx(
                            "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg bg-primary px-3.5 py-2.5 text-left text-md text-primary shadow-xs ring-1 ring-primary transition-shadow duration-100 ease-linear outline-hidden ring-inset",
                            "focus-visible:ring-2 focus-visible:ring-brand",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                            isOpen && "ring-2 ring-brand",
                            isInvalid && "ring-error_subtle",
                        )}
                    >
                        <AriaSelectValue className="truncate data-placeholder:text-placeholder">
                            {({ selectedText, isPlaceholder }) => (isPlaceholder ? placeholder : selectedText)}
                        </AriaSelectValue>
                        <ChevronDown className={cx("size-4 shrink-0 text-fg-quaternary transition-transform duration-150", isOpen && "rotate-180")} />
                    </AriaButton>

                    {hint && <HintText isInvalid={isInvalid}>{hint}</HintText>}

                    <AriaPopover
                        offset={6}
                        className="w-(--trigger-width) overflow-auto rounded-lg bg-primary p-1 shadow-lg ring-1 ring-secondary outline-hidden ring-inset"
                    >
                        <AriaListBox items={items} className="outline-hidden">
                            {(item) => (
                                <AriaListBoxItem
                                    id={item.id}
                                    textValue={item.label}
                                    isDisabled={item.isDisabled}
                                    className={cx(
                                        "flex cursor-pointer items-start justify-between gap-2 rounded-md px-2.5 py-2 text-md text-primary outline-hidden",
                                        "hover:bg-primary_hover focus:bg-primary_hover",
                                        "disabled:cursor-not-allowed disabled:opacity-50",
                                    )}
                                >
                                    {({ isSelected }) => (
                                        <>
                                            <span className="min-w-0">
                                                <span className="block truncate font-medium">{item.label}</span>
                                                {item.description && <span className="mt-0.5 block text-sm text-tertiary">{item.description}</span>}
                                            </span>
                                            {isSelected && <Check className="mt-0.5 size-4 shrink-0 text-fg-brand-primary" />}
                                        </>
                                    )}
                                </AriaListBoxItem>
                            )}
                        </AriaListBox>
                    </AriaPopover>
                </>
            )}
        </AriaSelect>
    );
};

Select.displayName = "Select";

export type { Key };
