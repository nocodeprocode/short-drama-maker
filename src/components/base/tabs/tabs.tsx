"use client";

import type { ReactNode } from "react";
import type { TabListProps as AriaTabListProps, TabsProps as AriaTabsProps } from "react-aria-components";
import { Tab as AriaTab, TabList as AriaTabList, TabPanel as AriaTabPanel, Tabs as AriaTabs } from "react-aria-components";
import { cx } from "@/utils/cx";

export interface TabsProps extends AriaTabsProps {}

export const Tabs = ({ className, ...props }: TabsProps) => (
    <AriaTabs {...props} className={(state) => cx("flex w-full flex-col", typeof className === "function" ? className(state) : className)} />
);

Tabs.displayName = "Tabs";

export interface TabListProps<T extends object> extends AriaTabListProps<T> {}

export function TabList<T extends object>({ className, ...props }: TabListProps<T>) {
    return (
        <AriaTabList
            {...props}
            className={(state) =>
                cx("flex gap-1 overflow-x-auto border-b border-secondary scrollbar-hide", typeof className === "function" ? className(state) : className)
            }
        />
    );
}

TabList.displayName = "TabList";

export interface TabProps {
    id: string;
    children: ReactNode;
    /** Small count or status shown after the label. */
    badge?: ReactNode;
    className?: string;
}

export const Tab = ({ id, children, badge, className }: TabProps) => (
    <AriaTab
        id={id}
        className={({ isSelected, isFocusVisible }) =>
            cx(
                "-mb-px flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors duration-100 ease-linear outline-hidden",
                isSelected ? "border-brand text-primary" : "border-transparent text-tertiary hover:text-secondary",
                isFocusVisible && "rounded-t-lg outline-2 outline-offset-2 outline-focus-ring",
                className,
            )
        }
    >
        {children}
        {badge != null && <span className="mono text-xs font-medium text-quaternary">{badge}</span>}
    </AriaTab>
);

Tab.displayName = "Tab";

export const TabPanel = ({ id, className, children }: { id: string; className?: string; children: ReactNode }) => (
    <AriaTabPanel id={id} className={cx("outline-hidden", className)}>
        {children}
    </AriaTabPanel>
);

TabPanel.displayName = "TabPanel";
