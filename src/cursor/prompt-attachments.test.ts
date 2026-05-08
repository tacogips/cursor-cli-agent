import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { validatePromptAttachments } from "./prompt-attachments";

const minimalPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Minimal JPEG header (SOI + APP0 marker)
const minimalJpegBytes = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);

describe("validatePromptAttachments", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "attach-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("accepts PNG and resolves relative paths against workspace", async () => {
    const imgPath = join(dir, "photo.png");
    await writeFile(imgPath, new Uint8Array(minimalPng));
    const now = (): Date => new Date("2026-05-09T12:00:00.000Z");
    const r = await validatePromptAttachments(
      [{ kind: "image", path: "photo.png" }],
      { workspace: dir, source: "cli", now },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.imagePaths.length).toBe(1);
      expect(r.value.imagePaths[0]).toBe(join(dir, "photo.png"));
      expect(r.value.attachments[0]?.sha256?.length).toBe(64);
      expect(r.value.attachments[0]?.mediaType).toBe("image/png");
      expect(r.value.attachments[0]?.status).toBe("validated");
    }
  });

  test("rejects urls", async () => {
    const now = (): Date => new Date();
    const r = await validatePromptAttachments(
      [{ kind: "image", path: "http://evil/x.png" }],
      { workspace: dir, source: "cli", now },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invalid_scheme");
  });

  test("deduplicates same resolved path", async () => {
    const imgPath = join(dir, "a.png");
    await writeFile(imgPath, new Uint8Array(minimalPng));
    const now = (): Date => new Date();
    const r = await validatePromptAttachments(
      [
        { kind: "image", path: "a.png" },
        { kind: "image", path: "./a.png" },
      ],
      { workspace: dir, source: "group", now },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.imagePaths.length).toBe(1);
  });

  test("rejects relative path that escapes workspace as unsafe_path", async () => {
    const now = (): Date => new Date();
    const r = await validatePromptAttachments(
      [{ kind: "image", path: "../secret.png" }],
      { workspace: dir, source: "cli", now },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unsafe_path");
  });

  test("returns stat_failed for missing file", async () => {
    const now = (): Date => new Date();
    const r = await validatePromptAttachments(
      [{ kind: "image", path: "nonexistent.png" }],
      { workspace: dir, source: "cli", now },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("stat_failed");
  });

  test("returns not_regular_file for directory input", async () => {
    await mkdir(join(dir, "subdir"));
    const now = (): Date => new Date();
    const r = await validatePromptAttachments(
      [{ kind: "image", path: "subdir" }],
      { workspace: dir, source: "cli", now },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_regular_file");
  });

  test("returns unsupported_media for magic-extension mismatch (JPEG content with .png extension)", async () => {
    const fakePng = join(dir, "fake.png");
    await writeFile(fakePng, minimalJpegBytes);
    const now = (): Date => new Date();
    const r = await validatePromptAttachments(
      [{ kind: "image", path: "fake.png" }],
      { workspace: dir, source: "cli", now },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unsupported_media");
  });
});
