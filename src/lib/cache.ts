const PREFIX = "ds.cache.v1.";
const memory = new Map<string, string>();

type Entry<T> = { t: number; v: T };

type Store = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};

function storage(): Store {
  if (typeof window !== "undefined") {
    try {
      return window.sessionStorage;
    } catch {
      /* private mode */
    }
  }
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value);
    },
    removeItem: (key) => {
      memory.delete(key);
    },
    key: (index) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size;
    },
  };
}

export function readCache<T>(key: string): T | null {
  const raw = storage().getItem(PREFIX + key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Entry<T>;
    return parsed?.v ?? null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T) {
  try {
    storage().setItem(PREFIX + key, JSON.stringify({ t: Date.now(), v: value } satisfies Entry<T>));
  } catch {
    /* quota or private mode */
  }
}

export function clearCache() {
  const store = storage();
  const keys: string[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
}
