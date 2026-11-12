/**
 * The `api` layer: the only layer clients see.
 *
 * It may import from every other layer. No other layer may import from it.
 */
export { engineVersion } from '../core/version.ts';
