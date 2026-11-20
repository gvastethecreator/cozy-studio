import { FIELDS, type Snapshot, type Layer } from './types.js';
import { jsonClone, sha256 } from './canonical.js';
import { validateSnapshot, validateLayer } from './validation.js';
export async function createLayer(snapshot: Snapshot, layerId: string): Promise<Layer> {
  validateSnapshot(snapshot);
  const frozen = jsonClone(snapshot);
  const result: Layer = {
    layerId,
    snapshot: frozen,
    snapshotHash: await sha256(frozen),
    enabled: true,
    strength: 0.75,
    fields: Object.fromEntries(
      FIELDS.map((field) => [
        field,
        { enabled: frozen.policy.defaultFields.includes(field), weight: 1 },
      ]),
    ) as Layer['fields'],
    avoidRulesMode: 'merge',
  };
  validateLayer(result);
  return result;
}
export async function verifyLayerHashes(layers: readonly Layer[]): Promise<void> {
  const hashes = await Promise.all(
    layers.map(async (layer) => {
      validateLayer(layer);
      return sha256(layer.snapshot);
    }),
  );
  const mismatch = layers.find((layer, index) => hashes[index] !== layer.snapshotHash);
  if (mismatch) throw new Error(`Snapshot hash mismatch: ${mismatch.layerId}`);
}
