import type { CapabilityCallers, ReachabilityGraphProvider } from "./analyzer.js";

export interface GraphProviderInput {
  /** Import graph as module -> its direct dependency modules (repo-relative paths); e.g. madge `.obj()`. */
  readonly importGraph: Readonly<Record<string, readonly string[]>>;
  /** Repo-relative source/test file path -> contents, for the non-test call-site scan. */
  readonly sourceFiles: ReadonlyMap<string, string>;
}

/**
 * Build a {@link ReachabilityGraphProvider} over a precomputed import graph (from madge) and the repo's
 * source/test file contents. Pure over its inputs — `scripts/reachability-check.ts` supplies the real
 * madge graph and files, while tests inject fixtures. `importPathFrom` BFS-walks the import graph;
 * `callersOf` / `isDeadExport` scan file contents for word-boundary references to the symbol.
 */
export function createGraphProvider(input: GraphProviderInput): ReachabilityGraphProvider {
  return {
    importPathFrom: (entryModule, module) => shortestImportPath(input.importGraph, entryModule, module),
    callersOf: (symbol, module) => classifyCallers(input.sourceFiles, symbol, module),
    isDeadExport: (symbol, module) => {
      const callers = classifyCallers(input.sourceFiles, symbol, module);
      return callers.nonTest.length === 0 && callers.test.length === 0;
    },
  };
}

function shortestImportPath(
  graph: Readonly<Record<string, readonly string[]>>,
  from: string,
  to: string,
): readonly string[] | undefined {
  if (from === to) {
    return [from];
  }
  const seen = new Set<string>([from]);
  const queue: (readonly string[])[] = [[from]];
  while (queue.length > 0) {
    const trail = queue.shift();
    if (!trail) {
      break;
    }
    const node = trail[trail.length - 1];
    if (node === undefined) {
      continue;
    }
    for (const dep of graph[node] ?? []) {
      if (dep === to) {
        return [...trail, dep];
      }
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push([...trail, dep]);
      }
    }
  }
  return undefined;
}

function classifyCallers(files: ReadonlyMap<string, string>, symbol: string, module: string): CapabilityCallers {
  const pattern = new RegExp(`\\b${escapeRegExp(symbol)}\\b`);
  const nonTest: string[] = [];
  const test: string[] = [];
  for (const [filePath, content] of files) {
    if (filePath === module || !pattern.test(content)) {
      continue;
    }
    if (isTestPath(filePath)) {
      test.push(filePath);
    } else {
      nonTest.push(filePath);
    }
  }
  return { nonTest, test };
}

function isTestPath(filePath: string): boolean {
  return filePath.startsWith("tests/") || filePath.endsWith(".test.ts");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
