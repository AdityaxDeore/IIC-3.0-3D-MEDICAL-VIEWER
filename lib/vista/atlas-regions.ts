/**
 * Atlas body regions for fitting a reconstructed bone mesh into the existing
 * skeleton. Phase 1: pure geometry — take the union bounding box of the
 * skeletal parts that belong to a region and scale/place the mesh into it.
 *
 * (Phase 2, later: label-driven placement once a segmentation model is wired up.)
 */
import type { Atlas } from '@/app/anatomy';

export type RegionId =
  | 'skull'
  | 'cervical'
  | 'thorax'
  | 'lumbar'
  | 'pelvis'
  | 'shoulder'
  | 'humerus'
  | 'forearm'
  | 'femur'
  | 'lower-leg'
  | 'hand-foot'
  | 'full-skeleton';

interface RegionDef {
  id: RegionId;
  label: string;
  /** Matched against atlas skeletal part names (BodyParts3D wording). */
  match: RegExp;
}

// Order = dropdown order. `\b` keeps e.g. "tibia" from catching "tibialis".
export const REGIONS: RegionDef[] = [
  { id: 'skull', label: 'Skull / head', match: /\b(frontal bone|parietal bone|occipital bone|temporal bone|sphenoid|ethmoid|vomer|maxilla|mandible|zygomatic bone|nasal bone|palatine bone|lacrimal|hyoid bone|tooth|gingiva)\b/i },
  { id: 'cervical', label: 'Cervical spine', match: /\b(cervical vertebra|atlas|axis)\b/i },
  { id: 'thorax', label: 'Chest / rib cage', match: /\b(rib|costal cartilage|sternum|manubrium|xiphoid|thoracic vertebra)\b/i },
  { id: 'lumbar', label: 'Lumbar spine', match: /\blumbar vertebra\b/i },
  { id: 'pelvis', label: 'Pelvis / sacrum', match: /\b(hip bone|sacrum|coccyx|ilium|ischium|pubis)\b/i },
  { id: 'shoulder', label: 'Shoulder', match: /\b(scapula|clavicle)\b/i },
  { id: 'humerus', label: 'Upper arm', match: /\bhumerus\b/i },
  { id: 'forearm', label: 'Forearm', match: /\b(radius|ulna)\b/i },
  { id: 'femur', label: 'Thigh / femur', match: /\bfemur\b/i },
  { id: 'lower-leg', label: 'Lower leg / knee', match: /\b(tibia|fibula|patella)\b/i },
  { id: 'hand-foot', label: 'Hand / foot', match: /\b(metacarpal|metatarsal|phalanx|calcaneus|talus|navicular|cuboid|cuneiform bone)\b/i },
  { id: 'full-skeleton', label: 'Whole skeleton', match: /.*/ },
];

export interface RegionBox {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
}

/** Union AABB (atlas units) of the skeletal parts belonging to `region`. */
export function getRegionBox(atlas: Atlas | null | undefined, region: RegionId): RegionBox | null {
  const def = REGIONS.find((r) => r.id === region);
  if (!def || !atlas?.parts?.length) return null;

  const full = region === 'full-skeleton';
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let n = 0;

  for (const p of atlas.parts) {
    if (p.system !== 'skeletal') continue;
    if (!full && !def.match.test(p.name)) continue;
    n++;
    for (let k = 0; k < 3; k++) {
      if (p.bounds[0][k] < min[k]) min[k] = p.bounds[0][k];
      if (p.bounds[1][k] > max[k]) max[k] = p.bounds[1][k];
    }
  }
  if (n === 0) return null;

  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  return { min, max, size, center };
}

/**
 * Rough guess of which region a reconstruction is, from its raw bounding-box
 * proportions. Good enough as a default; the user can always override.
 */
export function guessRegion([sx, sy, sz]: [number, number, number]): RegionId {
  const horiz = Math.max(sx, sz) || 1e-6;
  const ratio = sy / horiz;
  const longest = Math.max(sx, sy, sz) || 1e-6;
  const isotropy = Math.min(sx, sy, sz) / longest;

  if (isotropy > 0.7) return 'skull'; // roughly cubic block
  if (ratio >= 1.9) return 'femur'; // tall and narrow -> a long bone
  if (ratio <= 0.85) return 'thorax'; // wider than tall -> rib cage
  return 'lumbar'; // a squat block -> a spine segment
}
