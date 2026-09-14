/**
 * Resolves a structure named on a scan to the real BodyParts3D meshes already
 * shipped with the viewer, and loads their geometry out of the packed chunks.
 *
 * This is what lets a reconstruction start from correct anatomy — a femur with
 * a head, a neck and condyles — instead of an outline inflated into a blob.
 * The image then only has to nudge that mesh (see atlas-morph.ts), so a thin
 * or noisy segmentation can no longer produce a thin or ragged bone.
 */
import type { Atlas, Part } from '@/app/anatomy';
import { decodeModelResponse } from '@/app/model-download';
import type { Side } from './identify';

export interface PartGeometry {
  part: Part;
  /** Atlas-space vertices, three floats per vertex. Freshly copied, writable. */
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Names a radiologist uses that cover several BodyParts3D meshes. Each entry
 * is matched against atlas part names after the side word is stripped.
 */
const GROUPS: { match: RegExp; members: RegExp }[] = [
  { match: /\bquadriceps|quads\b/i, members: /^(vastus (lateralis|medialis|intermedius)|rectus femoris)$/i },
  { match: /\bhamstrings?\b/i, members: /^(biceps femoris|semitendinosus|semimembranosus)$/i },
  { match: /\bcalf|triceps surae\b/i, members: /^(gastrocnemius|soleus)$/i },
  { match: /\badductor (group|muscles)\b/i, members: /^adductor (brevis|longus|magnus)$/i },
  { match: /\bglutes|gluteal (group|muscles)\b/i, members: /^gluteus (maximus|medius|minimus)$/i },
  { match: /\bthigh muscles?\b/i, members: /^(vastus (lateralis|medialis|intermedius)|rectus femoris|biceps femoris|semitendinosus|semimembranosus|sartorius|gracilis|adductor (brevis|longus|magnus))$/i },
  { match: /\brib cage\b|\bribs\b/i, members: /(^| )ribs?$/i },
];

/**
 * Adjectives a radiologist uses where BodyParts3D uses the noun. Applied to
 * both sides of the comparison, so "left femoral shaft" and "Left femur" meet
 * in the middle instead of the query drifting onto the femoral artery.
 */
const SYNONYMS: [RegExp, string][] = [
  [/\bfemoral\b/g, 'femur'],
  [/\btibial\b/g, 'tibia'],
  [/\bfibular\b/g, 'fibula'],
  [/\bhumeral\b/g, 'humerus'],
  [/\bpelvic\b/g, 'pelvis'],
  [/\bvertebral\b/g, 'vertebra'],
  [/\bcostal\b/g, 'rib'],
  [/\bscapular\b/g, 'scapula'],
  [/\bclavicular\b/g, 'clavicle'],
];

/** "Left femoral shaft" -> { side: 'left', core: 'femur' } */
function split(name: string): { side: Side; core: string } {
  const lower = name.toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  let side: Side = null;
  if (/\bleft\b|\bsinister\b/.test(lower)) side = 'left';
  else if (/\bright\b|\bdexter\b/.test(lower)) side = 'right';
  let core = lower
    .replace(/\b(left|right|sinister|dexter|the|a|an|of)\b/g, ' ')
    .replace(/\b(bone|muscle|shaft|diaphysis|proximal|distal|mid|midshaft)\b/g, ' ');
  for (const [pattern, replacement] of SYNONYMS) core = core.replace(pattern, replacement);
  return { side, core: core.replace(/\s+/g, ' ').trim() };
}

/** Content words of a name, so "femur" scores against "Left femur". */
function tokens(core: string): string[] {
  return core.split(' ').filter((t) => t.length > 2);
}

/**
 * The atlas meshes that best represent `name`, or an empty array when nothing
 * in the atlas plausibly matches.
 *
 * `side` comes from identification and wins over any side word in the name, so
 * a left and a right call resolve to different meshes even when the model
 * wrote the same core name twice.
 */
export function matchParts(atlas: Atlas, name: string, side: Side): Part[] {
  const wanted = split(name);
  const want = side ?? wanted.side;
  const core = wanted.core;
  if (!core) return [];

  // Keep only the requested side once we know it. A part with no side word
  // (the sacrum, the skin) is eligible whatever side was asked for.
  const sideOk = (partName: string) => {
    if (!want) return true;
    const p = split(partName).side;
    return p === null || p === want;
  };

  const group = GROUPS.find((g) => g.match.test(core));
  if (group) {
    const members = atlas.parts.filter((p) => group.members.test(split(p.name).core) && sideOk(p.name));
    if (members.length) return members;
  }

  const wantTokens = tokens(core);
  let best: Part[] = [];
  let bestScore = 0;

  for (const part of atlas.parts) {
    if (!sideOk(part.name)) continue;
    const partCore = split(part.name).core;
    if (!partCore) continue;

    let score: number;
    if (partCore === core) score = 1000;
    else {
      const partTokens = tokens(partCore);
      const shared = wantTokens.filter((t) => partTokens.includes(t)).length;
      if (shared === 0) continue;
      // Both names have to be largely accounted for. One word in common is not
      // a match: it is how "titanium plate" used to reach "Tarsal plate of
      // left upper eyelid", and how "vastus lateralis" could land on "vastus
      // medialis".
      if (shared / wantTokens.length < 0.6) continue;
      if (partTokens.length && shared / partTokens.length <= 0.5) continue;
      // Then prefer the part that adds fewest extra words of its own.
      score = (shared / wantTokens.length) * 100 - Math.abs(partTokens.length - wantTokens.length) * 6;
    }
    if (score <= 0) continue;

    if (score > bestScore + 1e-6) { bestScore = score; best = [part]; }
    // Paired or subdivided structures tie; keep them all so a name like
    // "ribs" or an unsided call brings back every matching mesh.
    else if (Math.abs(score - bestScore) < 1e-6 && best.length < 24) best.push(part);
  }

  // A weak partial match is worse than admitting nothing was found.
  return bestScore >= 34 ? best : [];
}

const chunks = new Map<number, Promise<ArrayBuffer>>();

/** Fetch a packed chunk once per session; concurrent callers share the fetch. */
function loadChunk(atlas: Atlas, index: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const cached = chunks.get(index);
  if (cached) return cached;

  const chunk = atlas.chunks[index];
  if (!chunk) return Promise.reject(new Error('That anatomy chunk is not in the catalogue.'));
  const compressed = !!chunk.gzip && typeof DecompressionStream !== 'undefined';

  const pending = fetch(compressed ? chunk.gzip! : chunk.url, { signal })
    .then((response) => decodeModelResponse(response, chunk.bytes, compressed))
    .catch((error) => {
      // Never cache a failure: the next attempt should be able to succeed.
      chunks.delete(index);
      throw error;
    });
  chunks.set(index, pending);
  return pending;
}

/**
 * Atlas-space geometry for `parts`. Positions are copied out of the chunk so
 * the caller can deform them in place without corrupting the shared buffer.
 */
export async function loadPartGeometry(
  atlas: Atlas,
  parts: Part[],
  signal?: AbortSignal,
): Promise<PartGeometry[]> {
  const needed = [...new Set(parts.map((p) => p.chunk))];
  const buffers = new Map<number, ArrayBuffer>();
  await Promise.all(needed.map(async (i) => { buffers.set(i, await loadChunk(atlas, i, signal)); }));

  return parts.map((part) => {
    const buffer = buffers.get(part.chunk)!;
    return {
      part,
      positions: new Float32Array(buffer, part.positions, part.vertexCount * 3).slice(),
      indices: new Uint32Array(buffer, part.indices, part.indexCount).slice(),
    };
  });
}
