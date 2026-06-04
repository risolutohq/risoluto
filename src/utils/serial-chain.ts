/**
 * Serializes async operations so each runs to settlement before the next begins.
 *
 * Two shapes share one promise-chain idiom: a per-instance chain (createSerialChain)
 * and a keyed chain that serializes only operations sharing a key (withKeyedSerialChain).
 * In both, the chain advances on a settled (never-rejecting) promise so one failed
 * operation does not poison the queue for later callers.
 */

/** Enqueues an operation onto a single serialized chain, resolving with its result. */
export type SerialChain = <T>(operation: () => Promise<T>) => Promise<T>;

/**
 * Create a per-instance serializer. Each returned function owns one chain, so
 * operations enqueued through it run one at a time, in call order.
 */
export function createSerialChain(): SerialChain {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = chain.then(operation, operation);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

/**
 * Serialize operations that share a key against the given chain map, so each key's
 * read-modify-write body runs atomically against concurrent callers. Settled keys are
 * pruned from the map so it does not grow unbounded.
 */
export function withKeyedSerialChain<T>(
  chains: Map<string, Promise<unknown>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const prior = chains.get(key) ?? Promise.resolve();
  const result = prior.then(operation, operation);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) {
      chains.delete(key);
    }
  });
  return result;
}
