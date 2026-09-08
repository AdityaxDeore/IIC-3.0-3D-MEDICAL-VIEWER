/**
 * VISTA-3D label map (subset) and the skeletal selection this feature reconstructs.
 * Source: Project-MONAI/VISTA vista3d/data/jsons/label_dict.json
 */

export const BONE_LABELS: Record<number, string> = {
  // Spine
  33: 'vertebrae L5', 34: 'vertebrae L4', 35: 'vertebrae L3', 36: 'vertebrae L2', 37: 'vertebrae L1',
  38: 'vertebrae T12', 39: 'vertebrae T11', 40: 'vertebrae T10', 41: 'vertebrae T9', 42: 'vertebrae T8',
  43: 'vertebrae T7', 44: 'vertebrae T6', 45: 'vertebrae T5', 46: 'vertebrae T4', 47: 'vertebrae T3',
  48: 'vertebrae T2', 49: 'vertebrae T1',
  50: 'vertebrae C7', 51: 'vertebrae C6', 52: 'vertebrae C5', 53: 'vertebrae C4', 54: 'vertebrae C3',
  55: 'vertebrae C2', 56: 'vertebrae C1',
  127: 'vertebrae S1',
  // Ribs
  63: 'left rib 1', 64: 'left rib 2', 65: 'left rib 3', 66: 'left rib 4', 67: 'left rib 5', 68: 'left rib 6',
  69: 'left rib 7', 70: 'left rib 8', 71: 'left rib 9', 72: 'left rib 10', 73: 'left rib 11', 74: 'left rib 12',
  75: 'right rib 1', 76: 'right rib 2', 77: 'right rib 3', 78: 'right rib 4', 79: 'right rib 5', 80: 'right rib 6',
  81: 'right rib 7', 82: 'right rib 8', 83: 'right rib 9', 84: 'right rib 10', 85: 'right rib 11', 86: 'right rib 12',
  // Girdles and long bones
  87: 'left humerus', 88: 'right humerus',
  89: 'left scapula', 90: 'right scapula',
  91: 'left clavicula', 92: 'right clavicula',
  93: 'left femur', 94: 'right femur',
  95: 'left hip', 96: 'right hip',
  97: 'sacrum',
  // Axial
  114: 'costal cartilages',
  120: 'skull',
  122: 'sternum',
  // Pathology
  128: 'bone lesion',
};

/** Every skeletal id we ask VISTA-3D for. */
export const BONE_IDS: number[] = Object.keys(BONE_LABELS).map(Number);

/** Class-name prompts sent to the API (it accepts names or ids; names are clearer in logs). */
export const BONE_CLASSES: string[] = BONE_IDS.map((id) => BONE_LABELS[id]);

/** Lesions are drawn separately so the injury reads at a glance. */
export const LESION_ID = 128;

/** Coarse region colouring, tuned to sit beside the atlas' bone palette (#e2d9ba). */
export function boneTint(id: number): [number, number, number] {
  if (id === LESION_ID) return [0.92, 0.26, 0.24];       // lesion — red
  if (id === 120) return [0.90, 0.87, 0.77];             // skull
  if (id >= 33 && id <= 56) return [0.85, 0.80, 0.66];   // vertebrae
  if (id === 127 || id === 97) return [0.83, 0.78, 0.64]; // sacrum / S1
  if (id >= 63 && id <= 86) return [0.89, 0.85, 0.72];   // ribs
  if (id === 114) return [0.78, 0.82, 0.78];             // costal cartilage
  if (id === 122) return [0.87, 0.83, 0.70];             // sternum
  if (id >= 87 && id <= 96) return [0.86, 0.81, 0.67];   // limbs / girdles
  return [0.886, 0.851, 0.729];
}

/** Human-readable summary of which structures the segmentation actually contains. */
export function describeFound(counts: Map<number, number>): string[] {
  return [...counts.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${BONE_LABELS[id] ?? `label ${id}`} (${n.toLocaleString()} voxels)`);
}
