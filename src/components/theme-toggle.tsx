import { Select } from "@/components/base/select/select";
import { useTheme } from "@/providers/theme-provider";

const OPTIONS = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Match device" },
] as const;

export function ThemeSetting() {
  const { theme, setTheme } = useTheme();

  return (
    <Select
      aria-label="Appearance"
      selectedKey={theme}
      onSelectionChange={(key) => {
        if (key === "light" || key === "dark" || key === "system") setTheme(key);
      }}
      items={[...OPTIONS]}
      className="w-40"
    />
  );
}
