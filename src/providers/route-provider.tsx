import { type PropsWithChildren } from "react";
import { RouterProvider } from "react-aria-components";
import { navigate } from "vike/client/router";

declare module "react-aria-components" {
    interface RouterConfig {
        routerOptions: {
            keepScrollPosition?: boolean;
            overwriteLastHistoryEntry?: boolean;
        };
    }
}

export const RouteProvider = ({ children }: PropsWithChildren) => {
    return (
        <RouterProvider navigate={(href) => void navigate(href)} useHref={(href) => href}>
            {children}
        </RouterProvider>
    );
};
