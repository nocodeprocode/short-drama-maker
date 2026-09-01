export type Clock = {
  now(): Date;
};

export type IdFactory = {
  id(): string;
  token(): string;
};

export function systemClock(): Clock {
  return { now: () => new Date() };
}

export function cryptoIds(): IdFactory {
  return {
    id: () => crypto.randomUUID(),
    token: () => crypto.randomUUID().replaceAll("-", ""),
  };
}

export function iso(clock: Clock): string {
  return clock.now().toISOString();
}

export function addSeconds(clock: Clock, seconds: number): string {
  return new Date(clock.now().getTime() + seconds * 1000).toISOString();
}
