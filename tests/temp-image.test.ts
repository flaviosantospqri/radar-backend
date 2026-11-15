import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, readdir, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { cleanupStaleTemporaryImages, optimizeToTemporaryFile } from "../src/modules/analyses/temp-image.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

describe("temporary image lifecycle", () => {
  it("normalizes a valid image and removes the temporary file on dispose", async () => {
    const png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#0a0" } }).png().toBuffer();
    const image = await optimizeToTemporaryFile({ buffer: png, mimeType: "image/png" });
    cleanups.push(image.dispose);
    await expect(access(image.temporaryFilePath)).resolves.toBeUndefined();
    const metadata = await sharp(image.buffer).metadata();
    expect(image.mimeType).toBe("image/jpeg");
    expect(metadata.width).toBeLessThanOrEqual(1600);
    await image.dispose();
    await expect(access(image.temporaryFilePath)).rejects.toThrow();
  });

  it("rejects unsupported media types and invalid image bytes", async () => {
    await expect(optimizeToTemporaryFile({ buffer: Buffer.from("x"), mimeType: "text/plain" })).rejects.toMatchObject({ code: "INVALID_IMAGE_TYPE" });
    await expect(optimizeToTemporaryFile({ buffer: Buffer.from("not an image"), mimeType: "image/jpeg" })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    await expect(optimizeToTemporaryFile({ buffer: Buffer.alloc(8 * 1024 * 1024 + 1), mimeType: "image/jpeg" })).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it("sweeps only expired RADAR temporary directories", async () => {
    const old = join(tmpdir(), `radar-analysis-test-${Date.now()}`);
    await mkdir(old);
    const staleDate = new Date(Date.now() - 4 * 60 * 60 * 1000);
    await utimes(old, staleDate, staleDate);
    const removed = await cleanupStaleTemporaryImages();
    expect(removed).toBeGreaterThanOrEqual(1);
    await expect(access(old)).rejects.toThrow();
  });
});

