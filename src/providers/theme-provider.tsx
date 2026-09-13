import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = (): ThemeContextType => {
    const context = useContext(ThemeContext);

    if (context === undefined) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }

    return context;
};

interface ThemeProviderProps {
    children: ReactNode;
    /**
     * The class to add to the root element when the theme is dark
     * @default "dark-mode"
     */
    darkModeClass?: string;
    /**
     * The default theme to use if no theme is stored in localStorage
     * @default "system"
     */
    defaultTheme?: Theme;
    /**
     * The key to use to store the theme in localStorage
     * @default "ui-theme"
     */
    storageKey?: string;
}

export const ThemeProvider = ({
    children,
    defaultTheme = "system",
    storageKey = "ui-theme",
    darkModeClass = "dark-mode",
}: ThemeProviderProps) => {
    const [theme, setTheme] = useState<Theme>(defaultTheme);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem(storageKey);
        if (saved === "light" || saved === "dark" || saved === "system") {
            setTheme(saved);
        }
        setReady(true);
    }, [storageKey]);

    useEffect(() => {
        if (!ready) return;

        const applyTheme = () => {
            const root = window.document.documentElement;
            const resolved =
                theme === "system"
                    ? window.matchMedia("(prefers-color-scheme: dark)").matches
                        ? "dark"
                        : "light"
                    : theme;
            const dark = resolved === "dark";

            root.classList.toggle(darkModeClass, dark);
            root.style.colorScheme = dark ? "dark" : "light";
            document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0c111d" : "#ffffff");

            if (theme === "system") {
                localStorage.removeItem(storageKey);
            } else {
                localStorage.setItem(storageKey, theme);
            }
        };

        applyTheme();

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleChange = () => {
            if (theme === "system") applyTheme();
        };

        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, [darkModeClass, ready, storageKey, theme]);

    return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
};
