import { v7 as uuidv7 } from 'uuid';

/**
 * Generates a time-ordered UUID (v7). Time-ordering keeps primary-key inserts
 * close to the B-tree's right edge, which keeps index bloat low compared to
 * v4 identifiers. The generator lives in the domain because identifiers are
 * part of the aggregate's identity, not an infrastructure detail.
 */
export function newId(): string {
  return uuidv7();
}
