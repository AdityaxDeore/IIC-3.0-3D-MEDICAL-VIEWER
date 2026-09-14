/**
 * Reads a single MRI/CT slice and works out what is in it.
 *
 * A scan of the thighs holds a left femur, a right femur and the soft tissue
 * around both, so identification returns a *list* of structures rather than
 * one: each with its own name, tissue class, polarity and bounding box. Each
 * entry is fitted separately downstream, which is what stops a two-legged
 * scan from collapsing into a single reconstruction.
 */
import { analyzeImageWithGemini, GeminiError } from '@/lib/gemini';

export type SliceCategory = 'bone' | 'organ' | 'vessel' | 'other';
export type Side = 'left' | 'right' | null;

export interface SliceStructure {
  /** Plain-English name as read off the scan, e.g. "Left femur". */
  name: string;
  category: SliceCategory;
  /** Which side of the body, when the name says so. Drives atlas matching. */
  side: Side;
  /** How the structure reads against its surroundings. Drives the threshold. */
  appears: 'bright' | 'dark';
  /** Normalised [x0, y0, x1, y1] around this structure alone. */
  roi: [number, number, number, number];
}

/** Why automatic identification produced nothing, when it produced nothing. */
export type IdentifyFailure =
  /** The key's allowance is spent; retrying will not help until it resets. */
  | { kind: 'quota'; message: string; retryAfter: number }
  /** A momentary rate spike; worth trying again shortly. */
  | { kind: 'rate'; message: string; retryAfter: number }
  /** No API key configured. */
  | { kind: 'key'; message: string; retryAfter: number }
  | { kind: 'other'; message: string; retryAfter: number };

export interface SliceIdentification {
  /**
   * Every structure that was identified, most prominent first. Empty when
   * identification was unavailable - the structures are then named by hand,
   * which is what `manualIdentification` builds.
   */
  structures: SliceStructure[];
  /** Short clinical observations across the whole slice. */
  findings: string[];
  /** False when nothing could be identified automatically. */
  identified: boolean;
  /** Set when `identified` is false, so the panel can explain and advise. */
  failure: IdentifyFailure | null;
  /** True when the structures were named by the user rather than the model. */
  manual: boolean;
  /** The most prominent structure's name, for headings. */
  structure: string;
}

const FULL_FRAME: [number, number, number, number] = [0, 0, 1, 1];

/** Flat RGB (0..1) a reconstruction is painted, by tissue class. */
export function colorFor(category: SliceCategory): [number, number, number] {
  switch (category) {
    case 'bone': return [0.886, 0.851, 0.729];
    case 'vessel': return [0.78, 0.32, 0.30];
    case 'organ': return [0.83, 0.55, 0.48];
    default: return [0.72, 0.76, 0.78];
  }
}

const PROMPT = `You are reading ONE 2-D medical scan slice (MRI or CT) that will be reconstructed in 3-D.

List EVERY distinct anatomical structure you can identify, most prominent first,
up to eight. A scan of both thighs contains a left femur AND a right femur AND
the surrounding muscle - report each of them as its own entry. Never merge two
paired bones into one entry, and never report only one side when both are
visible.

Reply with ONLY a JSON object, no prose and no code fences:
{"structures":[
   {"name":"<plain English name, e.g. Left femur>",
    "category":"bone"|"organ"|"vessel"|"other",
    "appears":"bright"|"dark",
    "box":[x0,y0,x1,y1]},
   ...],
 "findings":["<short finding>", "..."]}

Use the anatomical name a radiologist would use, and include the side in the
name ("Left femur", "Right vastus lateralis") whenever the side is apparent.
"category" is the tissue class: use "bone" only for bone itself, and "other"
for muscle and other soft tissue.
"appears" is how that structure looks compared with the tissue around it in THIS
image - cortical bone is usually dark on MRI and bright on CT, so judge the
picture in front of you rather than applying a rule. Judge it per structure.
"box" is a tight bounding box around THAT ONE structure as fractions of the
image width and height, origin at the top-left, each value between 0 and 1.
Boxes for a left and a right bone must not be the same box.
Keep "findings" to at most three short items; use an empty array if nothing stands out.`;

function extractJson(text: string): Record<string, unknown> | null {
  const body = text.replace(/`{3}(?:json)?/gi, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Coerce whatever box the model returned into a usable, slightly padded ROI.
 * `allowFullFrame` is false for a member of a multi-structure list: a box that
 * covers the whole picture would make its neighbour's box meaningless, so the
 * entry is dropped instead.
 */
function readBox(raw: unknown, allowFullFrame: boolean): [number, number, number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return allowFullFrame ? FULL_FRAME : null;
  const n = raw.map((v) => (typeof v === 'number' ? v : Number(v)));
  if (n.some((v) => !Number.isFinite(v))) return allowFullFrame ? FULL_FRAME : null;

  // Some models answer on a 0..100 or 0..1000 scale instead of 0..1.
  const peak = Math.max(...n.map(Math.abs));
  const div = peak > 100 ? 1000 : peak > 1.5 ? 100 : 1;
  let [x0, y0, x1, y1] = n.map((v) => v / div) as [number, number, number, number];
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];

  // Give the outline a little air so the structure is never clipped at the edge.
  const padX = (x1 - x0) * 0.1;
  const padY = (y1 - y0) * 0.1;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const box: [number, number, number, number] = [clamp(x0 - padX), clamp(y0 - padY), clamp(x1 + padX), clamp(y1 + padY)];

  // A degenerate or near-total box is no better than the whole frame.
  const areaFraction = (box[2] - box[0]) * (box[3] - box[1]);
  if (areaFraction < 0.005 || areaFraction > 0.98) return allowFullFrame ? FULL_FRAME : null;
  return box;
}

const BONE_WORDS = /bone|femur|femoral|vertebra|pelvis|pelvic|skull|rib|humerus|tibia|fibula|patella|hip|scapula|clavicle|sacrum|sternum|calcaneus|talus|metatarsal|metacarpal|phalanx|radius|ulna|mandible|maxilla/i;
const SOFT_WORDS = /muscle|muscul|vastus|rectus|gracilis|sartorius|adductor|hamstring|biceps|gluteus|soleus|gastrocnemius|quadriceps|tendon|\bfat\b|marrow|soft tissue|fascia|skin/i;

function readSide(name: string): Side {
  if (/\bleft\b|\bsinister\b|\(l\)/i.test(name)) return 'left';
  if (/\bright\b|\bdexter\b|\(r\)/i.test(name)) return 'right';
  return null;
}

function readCategory(raw: unknown, name: string): SliceCategory {
  if (raw === 'bone' || raw === 'organ' || raw === 'vessel' || raw === 'other') {
    // The label loses to the name when the two disagree about bone: a model
    // that calls a muscle "bone" would otherwise be fitted with a bone.
    if (raw === 'bone' && SOFT_WORDS.test(name) && !BONE_WORDS.test(name)) return 'other';
    return raw;
  }
  if (BONE_WORDS.test(name)) return 'bone';
  if (SOFT_WORDS.test(name)) return 'other';
  return 'organ';
}

/** How much of the smaller of two boxes the two share. */
function overlapFraction(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const smaller = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
  return smaller > 0 ? (w * h) / smaller : 0;
}

function readStructures(raw: unknown): SliceStructure[] {
  if (!Array.isArray(raw)) return [];
  const out: SliceStructure[] = [];

  for (const entry of raw.slice(0, 8)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === 'string' && e.name.trim() ? e.name.trim() : '';
    if (!name) continue;
    // A lone structure may legitimately fill the frame; one of several may not.
    const roi = readBox(e.box, raw.length === 1);
    if (!roi) continue;

    const side = readSide(name);
    const duplicate = out.some((prev) =>
      // The same name twice, or two boxes sitting on top of each other, means
      // the model listed one structure twice rather than finding two.
      prev.name.toLowerCase() === name.toLowerCase() ||
      (prev.side === side && overlapFraction(prev.roi, roi) > 0.8));
    if (duplicate) continue;

    out.push({
      name,
      category: readCategory(e.category, name),
      side,
      appears: e.appears === 'dark' ? 'dark' : 'bright',
      roi,
    });
  }
  return out;
}

function classify(error: unknown): IdentifyFailure {
  const message = error instanceof Error ? error.message : 'Identification unavailable.';
  if (error instanceof GeminiError) {
    if (error.quota) return { kind: 'quota', message, retryAfter: error.retryAfter };
    if (error.status === 429 || error.status === 503) {
      return { kind: 'rate', message, retryAfter: error.retryAfter };
    }
    return { kind: 'other', message, retryAfter: error.retryAfter };
  }
  if (/api key/i.test(message)) return { kind: 'key', message, retryAfter: 0 };
  return { kind: 'other', message, retryAfter: 0 };
}

export async function identifySlice(dataUrl: string): Promise<SliceIdentification> {
  try {
    const data = extractJson(await analyzeImageWithGemini(dataUrl, PROMPT));
    if (!data) throw new Error('The model did not return a structure.');

    const structures = readStructures(data.structures);
    if (structures.length === 0) throw new Error('The model did not name any structure in this slice.');

    return {
      structures,
      findings: Array.isArray(data.findings)
        ? data.findings.filter((f): f is string => typeof f === 'string' && !!f.trim()).slice(0, 3)
        : [],
      identified: true,
      failure: null,
      manual: false,
      structure: structures[0].name,
    };
  } catch (error) {
    // No invented structure: an empty list is the honest answer, and the panel
    // turns it into a prompt to name the structure by hand.
    return {
      structures: [],
      findings: [],
      identified: false,
      failure: classify(error),
      manual: false,
      structure: '',
    };
  }
}

/**
 * Where to look in the frame for a structure named by hand, given no box from
 * a model. A side splits the frame in two, following the radiological
 * convention that the patient's left is on the viewer's right; `mirrored`
 * swaps that for a scan laid out the other way.
 */
function sideRoi(side: Side, mirrored: boolean): [number, number, number, number] {
  if (!side) return FULL_FRAME;
  const onImageRight = mirrored ? side === 'right' : side === 'left';
  // A little past halfway each way, so a bone sitting near the midline is not
  // clipped by the split.
  return onImageRight ? [0.44, 0, 1, 1] : [0, 0, 0.56, 1];
}

/**
 * Build an identification from atlas structure names the user chose, so the
 * fit works with no model call at all. Categories come from the names, and
 * polarity from `appears` - the one thing a name cannot tell us.
 */
export function manualIdentification(
  names: string[],
  appears: 'bright' | 'dark',
  mirrored: boolean,
): SliceIdentification {
  const structures: SliceStructure[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || structures.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    const side = readSide(name);
    structures.push({
      name,
      category: readCategory(undefined, name),
      side,
      appears,
      roi: sideRoi(side, mirrored),
    });
  }
  return {
    structures,
    findings: [],
    identified: structures.length > 0,
    failure: null,
    manual: true,
    structure: structures[0]?.name ?? '',
  };
}
