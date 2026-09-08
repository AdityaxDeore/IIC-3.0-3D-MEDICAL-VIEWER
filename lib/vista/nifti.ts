/**
 * Minimal NIfTI-1 reader for VISTA-3D segmentation output (.nii / .nii.gz).
 * Only what we need: dimensions, voxel spacing, and the label volume itself.
 */

export interface Volume {
  dims: [number, number, number];
  /** Voxel spacing in mm. */
  spacing: [number, number, number];
  /** Label per voxel (segmentation) or raw intensity (CT/MRI), x fastest. */
  data: Uint8Array | Int16Array | Uint16Array | Int32Array | Float32Array;
  /** Real value = stored * sclSlope + sclInter (e.g. Hounsfield units for CT). */
  sclSlope: number;
  sclInter: number;
}

const NIFTI1_HEADER_SIZE = 348;

export async function gunzipIfNeeded(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buffer;
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress .nii.gz (no DecompressionStream).');
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export async function parseNifti(input: ArrayBuffer): Promise<Volume> {
  const buffer = await gunzipIfNeeded(input);
  if (buffer.byteLength < NIFTI1_HEADER_SIZE) throw new Error('File is too small to be a NIfTI volume.');
  const view = new DataView(buffer);

  // sizeof_hdr tells us the byte order.
  let little = true;
  if (view.getInt32(0, true) !== NIFTI1_HEADER_SIZE) {
    if (view.getInt32(0, false) === NIFTI1_HEADER_SIZE) little = false;
    else throw new Error('Not a NIfTI-1 volume (unexpected header size).');
  }

  const nx = view.getInt16(42, little);
  const ny = view.getInt16(44, little);
  const nz = view.getInt16(46, little);
  if (nx <= 0 || ny <= 0 || nz <= 0) throw new Error('NIfTI volume has no usable dimensions.');

  const datatype = view.getInt16(70, little);
  const sx = Math.abs(view.getFloat32(80, little)) || 1;
  const sy = Math.abs(view.getFloat32(84, little)) || 1;
  const sz = Math.abs(view.getFloat32(88, little)) || 1;
  const offset = Math.max(NIFTI1_HEADER_SIZE + 4, Math.round(view.getFloat32(108, little)) || 352);
  const sclSlope = view.getFloat32(112, little) || 1;
  const sclInter = view.getFloat32(116, little) || 0;

  const count = nx * ny * nz;
  const bytes = buffer.byteLength - offset;

  // Endianness note: a byte-per-voxel label volume is byte-order agnostic, and
  // VISTA-3D returns uint8, so the common path needs no swapping.
  const make = (): Volume['data'] => {
    switch (datatype) {
      case 2: return new Uint8Array(buffer, offset, Math.min(count, bytes));
      case 256: return new Uint8Array(buffer, offset, Math.min(count, bytes));
      case 4: return new Int16Array(buffer.slice(offset, offset + count * 2));
      case 512: return new Uint16Array(buffer.slice(offset, offset + count * 2));
      case 8: return new Int32Array(buffer.slice(offset, offset + count * 4));
      case 16: return new Float32Array(buffer.slice(offset, offset + count * 4));
      default: throw new Error(`Unsupported NIfTI datatype ${datatype}.`);
    }
  };

  const data = make();
  if (data.length < count) throw new Error('NIfTI volume is truncated.');

  return { dims: [nx, ny, nz], spacing: [sx, sy, sz], data, sclSlope, sclInter };
}
