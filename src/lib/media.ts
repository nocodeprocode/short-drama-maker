export function assetKey(url: string | null | undefined): string {
  if (!url) return "";
  return url.split("?")[0] ?? url;
}

export function sameAsset(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = assetKey(left);
  const b = assetKey(right);
  return Boolean(a) && a === b;
}

export async function downloadMedia(url: string, filename: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("download failed");
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
