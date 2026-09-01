export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required. This product calls real providers only — set the key in .env.local or the process environment.`,
    );
  }
  return value;
}

export function requireOpenRouterKey(): string {
  return requireEnv("OPENROUTER_API_KEY");
}

export function requireElevenLabsKey(): string {
  return requireEnv("ELEVENLABS_API_KEY");
}
