// Minimal ambient declaration: madge ships no types (and there is no @types/madge). Declares only the
// surface scripts/reachability-check.ts and the reach:check integration test use — the default factory
// and `.obj()` on its result.
declare module "madge" {
  interface MadgeInstance {
    obj(): Record<string, string[]>;
  }
  interface MadgeOptions {
    readonly baseDir?: string;
    readonly fileExtensions?: readonly string[];
    readonly tsConfig?: string;
  }
  export default function madge(entry: string | readonly string[], options?: MadgeOptions): Promise<MadgeInstance>;
}
