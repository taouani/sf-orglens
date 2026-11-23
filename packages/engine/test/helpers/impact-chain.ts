/**
 * The whole chain of references behind a result of an impact answer, put together the way a reader of the
 * answer does it: a result holds the reference it is found by, and the other end of that reference is a result
 * of the depth before, which holds the next. A flow refers to what its elements refer to (decision record 0066):
 * where the other end is an element of a flow that is no result, its flow is.
 */
import { parentKey, type ComponentKey } from '../../src/core/keys.ts';
import type { ImpactResult, ImpactStep } from '../../src/engines/impact.ts';

/**
 * The references between a result and the component that was asked about, in the order they follow each other:
 * the `to` of one is the `from` of the next. For what refers to a component the chain starts at the result,
 * for what a component refers to (`outgoing`) it ends there.
 */
export function chainOf(results: readonly ImpactResult[], result: ImpactResult, outgoing = false): ImpactStep[] {
  const byKey = new Map(results.map((one) => [one.key, one]));
  const chain: ImpactStep[] = [];
  for (let at: ImpactResult | undefined = result; at !== undefined;) {
    if (chain.length > results.length) throw new Error(`The chain of ${result.key} goes round in a circle.`);
    chain.push(at.reference);
    const next: ComponentKey = outgoing ? at.reference.from : at.reference.to;
    const flow = next.startsWith('Flow:') ? parentKey(next) : undefined;
    at = byKey.get(next) ?? (flow === undefined ? undefined : byKey.get(flow));
  }
  return outgoing ? chain.reverse() : chain;
}
