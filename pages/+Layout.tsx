import "@/styles/globals.css";
import { Button } from "@/components/base/buttons/button";
import { AppShell } from "@/components/drama/app-shell.tsx";
import { BrandMark } from "@/components/drama/brand-mark.tsx";
import { SupportAgentWidget } from "@/components/support-agent-widget";
import { LEGAL_ENTITY } from "@/legal/entity.ts";
import { FOOTER_LINKS } from "@/legal/policy.ts";
import { RouteProvider } from "@/providers/route-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { usePageContext } from "vike-react/usePageContext";

const LEGAL_PREFIXES = ["/legal", "/security", "/privacy", "/admin"];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { urlPathname } = usePageContext();
  const isLegal = LEGAL_PREFIXES.some((prefix) => urlPathname.startsWith(prefix));
  const isAuth = urlPathname === "/login";

  if (isAuth) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
        <RouteProvider>
          <div className="relative min-h-dvh bg-secondary_alt text-primary">
            {children}
          </div>
        </RouteProvider>
      </ThemeProvider>
    );
  }

  if (isLegal) {
    const year = new Date().getUTCFullYear();
    const owner = LEGAL_ENTITY.legal_entity_name.trim() || LEGAL_ENTITY.product_name;
    return (
      <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
        <RouteProvider>
        <div className="flex min-h-dvh flex-col bg-secondary text-primary">
          <header className="flex h-16 items-center justify-between gap-4 bg-primary px-4 sm:px-6">
            <a href="/" className="rounded-md outline-focus-ring">
              <BrandMark size="sm" />
            </a>
            <div className="flex items-center gap-1">
              <nav className="hidden items-center gap-1 sm:flex" aria-label="Legal">
                <Button href="/legal/privacy" color="tertiary" size="sm">
                  Privacy
                </Button>
                <Button href="/legal/terms" color="tertiary" size="sm">
                  Terms
                </Button>
              </nav>
            </div>
          </header>
          <div className="flex flex-1 justify-center px-4 pb-12 sm:px-6">{children}</div>
          <footer className="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-sm text-tertiary">
              © {year} {owner}
            </p>
            <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legal">
              {FOOTER_LINKS.map((link) => (
                <Button key={link.href} href={link.href} color="link-gray" size="sm">
                  {link.label}
                </Button>
              ))}
            </nav>
          </footer>
          <SupportAgentWidget />
        </div>
      </RouteProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
      <RouteProvider>
        <AppShell>{children}</AppShell>
      </RouteProvider>
    </ThemeProvider>
  );
}
