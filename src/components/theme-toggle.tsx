import { Moon01, Sun } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { useTheme } from "@/providers/theme-provider";

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const isDark =
        theme === "dark" ||
        (theme === "system" &&
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);

    return (
        <Button
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            color="tertiary"
            size="sm"
            iconLeading={isDark ? Sun : Moon01}
            onClick={() => setTheme(isDark ? "light" : "dark")}
        />
    );
}
