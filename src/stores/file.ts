import { existsSync } from "node:fs";
import type { TokenSet, TokenStore } from "../lib/types";

export class FileTokenStore implements TokenStore {
  private cached: TokenSet | null = null;

  constructor(private readonly path: string) {}

  async load(): Promise<TokenSet | null> {
    if (this.cached) return this.cached;
    if (!existsSync(this.path)) return null;
    this.cached = (await Bun.file(this.path).json()) as TokenSet;
    return this.cached;
  }

  async save(tokens: TokenSet): Promise<void> {
    this.cached = tokens;
    await Bun.write(this.path, JSON.stringify(tokens, null, 2));
  }
}
