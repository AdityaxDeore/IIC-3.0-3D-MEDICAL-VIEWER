import type { RegionId } from '@/lib/vista/atlas-regions';
import { analyzeImageWithGemini } from './gemini';

export interface ClassificationResult {
  organ: string;
  pathologies: string[];
  recommendedTools: ('screw' | 'rod' | 'clip')[];
  /** Atlas skeletal region the scan should be laid over. */
  region: RegionId;
  /** Which side of a paired region, when the scan shows one. */
  side: 'left' | 'right' | null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}

/** Regions the overlay can be aligned to, and what a scan of each usually shows. */
const PROFILES: {
  region: RegionId;
  organ: string;
  match: RegExp;
  pathologies: string[];
  recommendedTools: ('screw' | 'rod' | 'clip')[];
}[] = [
  { region: 'skull', organ: 'Skull', match: /brain|head|skull|cranial/, pathologies: ['Subdural Hematoma', 'Aneurysm'], recommendedTools: ['clip'] },
  { region: 'cervical', organ: 'Cervical Spine', match: /cervical|neck/, pathologies: ['Disc Herniation', 'Cervical Stenosis'], recommendedTools: ['screw', 'rod'] },
  { region: 'thorax', organ: 'Rib Cage', match: /thorax|thoracic|rib|chest|sternum/, pathologies: ['Rib Fracture', 'Costal Cartilage Injury'], recommendedTools: ['screw'] },
  { region: 'lumbar', organ: 'Lumbar Spine', match: /spine|spinal|vert|lumbar/, pathologies: ['Herniated Disc', 'Spinal Stenosis', 'Vertebral Compression'], recommendedTools: ['screw', 'rod'] },
  { region: 'pelvis', organ: 'Pelvis', match: /pelvi|hip|acetabul|sacr|ilia|ischi|pubis/, pathologies: ['Acetabular Fracture', 'Sacroiliac Disruption'], recommendedTools: ['screw', 'rod'] },
  { region: 'shoulder', organ: 'Shoulder', match: /shoulder|scapula|clavic/, pathologies: ['Rotator Cuff Tear', 'Clavicle Fracture'], recommendedTools: ['screw'] },
  { region: 'humerus', organ: 'Humerus', match: /humer|upper arm/, pathologies: ['Humeral Shaft Fracture'], recommendedTools: ['rod', 'screw'] },
  { region: 'forearm', organ: 'Forearm', match: /forearm|radius|ulna|wrist/, pathologies: ['Distal Radius Fracture'], recommendedTools: ['screw'] },
  { region: 'femur', organ: 'Femur', match: /femur|femoral|thigh/, pathologies: ['Femoral Neck Stress Fracture', 'Osteoporosis'], recommendedTools: ['screw', 'rod'] },
  { region: 'lower-leg', organ: 'Knee / Tibia', match: /knee|tibia|fibula|patella|shin/, pathologies: ['ACL Tear', 'Tibial Plateau Fracture'], recommendedTools: ['screw'] },
  { region: 'hand-foot', organ: 'Hand / Foot', match: /hand|foot|ankle|calcaneus|metatars|metacarp|phalan/, pathologies: ['Calcaneal Fracture', 'Metatarsal Stress Fracture'], recommendedTools: ['screw'] },
];

const DEFAULT_PROFILE = PROFILES.find((p) => p.region === 'femur')!;

function profileFor(text: string) {
  return PROFILES.find((p) => p.match.test(text)) ?? DEFAULT_PROFILE;
}

function sideFrom(text: string): 'left' | 'right' | null {
  if (/\bleft\b|\bl[- ]?sided\b/.test(text)) return 'left';
  if (/\bright\b|\br[- ]?sided\b/.test(text)) return 'right';
  return null;
}

const PROMPT = `You are reading a single medical scan slice (MRI or CT).
Identify which skeletal region of the body it shows so it can be overlaid on a 3D skeleton.

Reply with ONLY a JSON object, no prose and no code fences:
{"region":"<one of: ${PROFILES.map((p) => p.region).join('|')}>",
 "side":"left"|"right"|null,
 "bone":"<the specific bone in plain English, e.g. Left femur>",
 "findings":["<short pathology or finding>", "..."]}

Use "side" only when the scan clearly shows one side of a paired structure.
Keep "findings" to at most three short items; use an empty array if nothing stands out.`;

/** Pull the first JSON object out of a model reply that may be fenced or padded. */
function extractJson(text: string): Record<string, unknown> | null {
  const body = text.replace(/```(?:json)?/gi, '');
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
 * Identify the body region in an uploaded scan.
 *
 * Gemini reads the image itself; if it is unavailable or unreadable the file
 * name is used instead, so an upload always resolves to something the overlay
 * can be aligned against.
 */
export async function classifyMRI(file: File): Promise<ClassificationResult> {
  const filename = file.name.toLowerCase();

  try {
    const reply = await analyzeImageWithGemini(await fileToBase64(file), PROMPT);
    const data = extractJson(reply);
    if (!data) throw new Error('Gemini did not return a region.');

    const region = String(data.region ?? '');
    const bone = typeof data.bone === 'string' ? data.bone : '';
    // Trust the declared region when it is one we can align to, otherwise read
    // the region back out of the bone name.
    const profile = PROFILES.find((p) => p.region === region) ?? profileFor(`${bone} ${region}`.toLowerCase());
    const side =
      data.side === 'left' || data.side === 'right'
        ? data.side
        : sideFrom(bone.toLowerCase()) ?? sideFrom(filename);
    const findings = Array.isArray(data.findings)
      ? data.findings.filter((f): f is string => typeof f === 'string' && !!f.trim()).slice(0, 3)
      : [];

    return {
      organ: bone.trim() || profile.organ,
      pathologies: findings.length ? findings : profile.pathologies,
      recommendedTools: profile.recommendedTools,
      region: profile.region,
      side,
    };
  } catch (err) {
    console.warn('Scan identification fell back to the file name:', err);
    const profile = profileFor(filename);
    return {
      organ: profile.organ,
      pathologies: profile.pathologies,
      recommendedTools: profile.recommendedTools,
      region: profile.region,
      side: sideFrom(filename),
    };
  }
}
