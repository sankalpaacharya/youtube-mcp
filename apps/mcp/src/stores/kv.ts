import type { TokenSet, TokenStore } from "../lib/types";

export interface KVNamespaceLite {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export class KVTokenStore implements TokenStore {
  constructor(
    private readonly kv: KVNamespaceLite,
    private readonly key = "google_tokens",
  ) {}

  async load(): Promise<TokenSet | null> {
    const raw = await this.kv.get(this.key);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  }

  async save(tokens: TokenSet): Promise<void> {
    await this.kv.put(this.key, JSON.stringify(tokens));
  }
}
