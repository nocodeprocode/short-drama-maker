import { LEGAL_ENTITY } from "@/legal/entity.ts";

const THEME_BOOT = `(function(){try{var t=localStorage.getItem("ui-theme");var d=t==="light"?false:t==="system"?window.matchMedia("(prefers-color-scheme: dark)").matches:true;var r=document.documentElement;r.classList.toggle("dark-mode",d);r.style.colorScheme=d?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?"#0c111d":"#ffffff");}catch(e){document.documentElement.classList.add("dark-mode");document.documentElement.style.colorScheme="dark";}})();`;

export default function Head() {
  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="apple-touch-icon" href="/favicon.svg" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <meta name="theme-color" content="#0c111d" />
      <meta name="application-name" content={LEGAL_ENTITY.product_name} />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="apple-mobile-web-app-title" content={LEGAL_ENTITY.product_name} />
      <meta name="mobile-web-app-capable" content="yes" />
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
    </>
  );
}
