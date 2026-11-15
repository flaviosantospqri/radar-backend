import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TEMP_PREFIX = "radar-analysis-";

export type UploadedImage = { buffer: Buffer; mimeType: string };
export type TemporaryImage = { buffer: Buffer; mimeType: "image/jpeg"; temporaryFilePath: string; dispose: () => Promise<void> };

export async function optimizeToTemporaryFile(upload: UploadedImage): Promise<TemporaryImage> {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(upload.mimeType)) throw new AppError("Formato inválido. Use JPEG, PNG ou WebP.", 415, "INVALID_IMAGE_TYPE");
  if (upload.buffer.byteLength === 0 || upload.buffer.byteLength > MAX_IMAGE_BYTES) throw new AppError("A imagem deve ter até 8 MB.", 413, "IMAGE_TOO_LARGE");
  const directory = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  const filePath = join(directory, "image.jpg");
  try {
    const metadata = await sharp(upload.buffer, { failOn: "error" }).metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) throw new Error("Formato de imagem não suportado.");
    await sharp(upload.buffer).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(filePath);
    const buffer = await readFile(filePath);
    return {
      buffer,
      mimeType: "image/jpeg",
      temporaryFilePath: filePath,
      async dispose() {
        buffer.fill(0);
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new AppError("O arquivo enviado não é uma imagem válida.", 400, "INVALID_IMAGE");
  }
}

export async function cleanupStaleTemporaryImages(now = Date.now()) {
  const root = resolve(tmpdir());
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch { return 0; }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue;
    const target = resolve(root, entry.name);
    const childPath = relative(root, target);
    if (isAbsolute(childPath) || childPath.startsWith("..")) continue;
    try {
      const details = await stat(target);
      if (now - details.mtimeMs > env.TEMP_IMAGE_MAX_AGE_MS) {
        await rm(target, { recursive: true, force: true });
        removed += 1;
      }
    } catch { /* A concurrently removed or unreadable temp directory is harmless. */ }
  }
  return removed;
}
