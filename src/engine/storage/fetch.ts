type AssetFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let assetFetch: AssetFetch = globalThis.fetch.bind(globalThis);

export function setAssetFetch(fn: AssetFetch | null) {
  assetFetch = fn ?? globalThis.fetch.bind(globalThis);
}

export function mediaFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return assetFetch(input, init);
}
