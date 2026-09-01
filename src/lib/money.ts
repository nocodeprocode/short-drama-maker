export function usdLabel(amount: number | string | null | undefined): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return "0.00";
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}
