import fs from 'node:fs/promises';
import path from 'node:path';
import { WriteError } from './errors.js';
import type { ByteSource } from './source.js';

const COPY_CHUNK_SIZE = 1024 * 1024;

export type WriteChunk =
  | Uint8Array
  | {
      source: ByteSource;
      offset: number;
      length: number;
    };

export interface AtomicWriteOptions {
  atomic: boolean;
  backup: boolean;
  dryRun: boolean;
}

export interface AtomicWriteResult {
  bytesWritten: number;
  atomic: boolean;
}

/**
 * Write chunks to `filePath`.
 *
 * The default path writes to a temporary file in the same directory, flushes
 * it, and renames it over the destination. The source ranges are read lazily,
 * so large audio payloads are copied in chunks rather than loaded into memory.
 */
export async function writeChunks(
  filePath: string,
  chunks: readonly WriteChunk[],
  options: AtomicWriteOptions
): Promise<AtomicWriteResult> {
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunkLength(chunk), 0);

  if (options.dryRun) {
    return { bytesWritten: totalBytes, atomic: options.atomic };
  }

  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const temporaryPath = path.join(
    directory,
    `.${baseName}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`
  );

  let mode: number | undefined;
  try {
    mode = (await fs.stat(filePath)).mode;
  } catch {
    // Destination does not exist yet; use the process default.
  }

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporaryPath, 'wx', mode ?? 0o666);
    for (const chunk of chunks) {
      if (chunk instanceof Uint8Array) {
        await writeAll(handle, chunk);
        continue;
      }
      let remaining = chunk.length;
      let offset = chunk.offset;
      while (remaining > 0) {
        const length = Math.min(remaining, COPY_CHUNK_SIZE);
        const data = await chunk.source.read(offset, length);
        await writeAll(handle, data);
        offset += data.length;
        remaining -= data.length;
      }
    }
    await handle.sync();
    await handle.close();
    handle = undefined;

    if (mode !== undefined) {
      await fs.chmod(temporaryPath, mode & 0o7777);
    }

    if (options.backup) {
      await backupFile(filePath);
    }

    if (options.atomic) {
      await fs.rename(temporaryPath, filePath);
    } else {
      await fs.copyFile(temporaryPath, filePath);
      await fs.unlink(temporaryPath);
    }

    return { bytesWritten: totalBytes, atomic: options.atomic };
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
    await fs.unlink(temporaryPath).catch(() => undefined);
    if (error instanceof WriteError) {
      throw error;
    }
    throw new WriteError(`Failed to write '${filePath}'`, { cause: error });
  }
}

async function backupFile(filePath: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return;
    }
    await fs.copyFile(filePath, `${filePath}.bak`);
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
}

function chunkLength(chunk: WriteChunk): number {
  return chunk.length;
}

async function writeAll(
  handle: Awaited<ReturnType<typeof fs.open>>,
  data: Uint8Array
): Promise<void> {
  let offset = 0;
  while (offset < data.length) {
    const result = await handle.write(data, offset, data.length - offset);
    if (result.bytesWritten === 0) {
      throw new WriteError('Failed to write chunk: zero bytes written');
    }
    offset += result.bytesWritten;
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
