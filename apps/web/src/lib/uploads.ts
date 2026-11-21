import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertPathInsideWorkspace } from "@uzina/core";
import { resolveDataDir } from "@uzina/db";
import { jsonError } from "./api-utils";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MiB
export const MAX_MULTIPART_CONTENT_LENGTH = 5_767_168; // 5.5 MiB

export type SafeImageFormat =
  | { mimeType: "image/png"; ext: "png" }
  | { mimeType: "image/jpeg"; ext: "jpg" }
  | { mimeType: "image/webp"; ext: "webp" };

const JPEG_VALID_MARKERS = new Set([
  0xe0,
  0xe1,
  0xe2,
  0xdb,
  0xee,
  0xfe,
  0xc0,
  0xc2,
]);

const WEBP_SUBCHUNKS = new Set(["VP8 ", "VP8L", "VP8X"]);

export function checkMultipartContentLength(request: Request) {
  const rawLen = request.headers.get("content-length");
  if (!rawLen) return null;
  const parsed = Number(rawLen);
  if (Number.isFinite(parsed) && parsed > MAX_MULTIPART_CONTENT_LENGTH) {
    return jsonError(413, {
      error: "Payload multipart excede o limite de 5.5 MiB.",
      code: "PAYLOAD_TOO_LARGE",
    });
  }
  return null;
}

export function detectSafeImageFormat(buf: Buffer): SafeImageFormat | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { mimeType: "image/png", ext: "png" };
  }

  if (
    buf.length >= 4 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff &&
    buf[3] !== undefined &&
    JPEG_VALID_MARKERS.has(buf[3])
  ) {
    return { mimeType: "image/jpeg", ext: "jpg" };
  }

  if (
    buf.length >= 16 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP" &&
    WEBP_SUBCHUNKS.has(buf.subarray(12, 16).toString("ascii"))
  ) {
    return { mimeType: "image/webp", ext: "webp" };
  }

  return null;
}

export function getUploadsRootDir(): string {
  const dataDir = resolveDataDir(process.env);
  if (dataDir === ":memory:") {
    return path.resolve(/*turbopackIgnore: true*/ os.tmpdir(), "uzina-test-uploads");
  }
  return path.resolve(/*turbopackIgnore: true*/ dataDir, "uploads");
}

export type SaveUploadResult =
  | {
      ok: true;
      storagePath: string;
      mimeType: SafeImageFormat["mimeType"];
      sizeBytes: number;
    }
  | {
      ok: false;
      status: 400 | 413;
      code: string;
      error: string;
    };

export async function saveProjectImageUpload(
  projectId: string,
  file: File
): Promise<SaveUploadResult> {
  if (file.size <= 0) {
    return {
      ok: false,
      status: 400,
      code: "EMPTY_UPLOAD",
      error: "Arquivo de imagem vazio.",
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      code: "FILE_TOO_LARGE",
      error: "Imagem excede o limite máximo de 5 MiB.",
    };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      status: buf.byteLength > MAX_UPLOAD_BYTES ? 413 : 400,
      code: buf.byteLength > MAX_UPLOAD_BYTES ? "FILE_TOO_LARGE" : "EMPTY_UPLOAD",
      error:
        buf.byteLength > MAX_UPLOAD_BYTES
          ? "Imagem excede o limite máximo de 5 MiB."
          : "Arquivo de imagem vazio.",
    };
  }

  const format = detectSafeImageFormat(buf);
  if (!format) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_IMAGE_FORMAT",
      error:
        "Formato de imagem não permitido. Envie apenas PNG, JPEG ou WEBP válidos (SVG é proibido).",
    };
  }

  const uploadsRoot = getUploadsRootDir();
  const relPath = `${projectId}/${crypto.randomUUID()}.${format.ext}`;
  const targetAbsPath = assertPathInsideWorkspace(uploadsRoot, relPath);

  fs.mkdirSync(path.dirname(/*turbopackIgnore: true*/ targetAbsPath), {
    recursive: true,
  });
  fs.writeFileSync(/*turbopackIgnore: true*/ targetAbsPath, buf);

  return {
    ok: true,
    storagePath: relPath,
    mimeType: format.mimeType,
    sizeBytes: buf.byteLength,
  };
}

export function readProjectImageUpload(storagePath: string): Buffer | null {
  try {
    const uploadsRoot = getUploadsRootDir();
    const targetAbsPath = assertPathInsideWorkspace(uploadsRoot, storagePath);
    if (!fs.existsSync(/*turbopackIgnore: true*/ targetAbsPath)) {
      return null;
    }
    const stat = fs.lstatSync(/*turbopackIgnore: true*/ targetAbsPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return null;
    }
    return fs.readFileSync(/*turbopackIgnore: true*/ targetAbsPath);
  } catch {
    return null;
  }
}

export function deleteUploadBestEffort(
  storagePath: string | null | undefined
): void {
  if (!storagePath) return;
  try {
    const uploadsRoot = getUploadsRootDir();
    const targetAbsPath = assertPathInsideWorkspace(uploadsRoot, storagePath);
    fs.rmSync(/*turbopackIgnore: true*/ targetAbsPath, { force: true });
  } catch {
    // Best-effort cleanup
  }
}
