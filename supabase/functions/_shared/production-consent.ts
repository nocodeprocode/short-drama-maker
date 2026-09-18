export function hasExplicitStartConfirmation(body: Record<string, unknown>): boolean {
  return body.start_confirmed === true;
}
