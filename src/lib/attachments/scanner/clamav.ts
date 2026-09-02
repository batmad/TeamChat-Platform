import "server-only";

import net, { type Socket } from "node:net";
import { Buffer } from "node:buffer";

import type {
  AttachmentMalwareScanner,
  AttachmentMalwareScanResult,
  AttachmentScannerHealth,
} from "@/lib/attachments/scanner/types";

export type ClamAvScannerConfig = {
  host?: string;
  port?: number;
  socketPath?: string;
  timeoutMs: number;
  chunkSizeBytes: number;
};

export function parseClamdScanResponse(response: string): AttachmentMalwareScanResult {
  const normalized = response.replace(/\0/g, "").trim();
  if (/\bOK$/i.test(normalized)) {
    return { clean: true, infected: false, threatName: null, rawResult: normalized };
  }

  const found = normalized.match(/:\s*(.+?)\s+FOUND$/i);
  if (found) {
    return {
      clean: false,
      infected: true,
      threatName: found[1]?.trim() || "UNKNOWN",
      rawResult: normalized,
    };
  }

  throw new Error(`Unexpected clamd scan response: ${normalized || "EMPTY_RESPONSE"}`);
}

function connect(config: ClamAvScannerConfig): Socket {
  return config.socketPath
    ? net.createConnection({ path: config.socketPath })
    : net.createConnection({ host: config.host ?? "127.0.0.1", port: config.port ?? 3310 });
}

function waitForResponse(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("ClamAV response timed out"));
    }, timeoutMs);

    const finish = (error?: Error) => {
      clearTimeout(timer);
      socket.removeAllListeners();
      if (error) reject(error);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };

    socket.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk));
      if (chunk.includes(0)) finish();
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => finish());
  });
}

async function writeWithBackpressure(socket: Socket, data: Uint8Array) {
  if (socket.write(data)) return;
  await new Promise<void>((resolve, reject) => {
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("drain", onDrain);
      socket.off("error", onError);
    };
    socket.once("drain", onDrain);
    socket.once("error", onError);
  });
}

export class ClamAvAttachmentScanner implements AttachmentMalwareScanner {
  readonly providerType = "CLAMAV" as const;

  constructor(
    readonly providerId: string,
    readonly providerName: string,
    private readonly config: ClamAvScannerConfig,
  ) {}

  async scan(data: Uint8Array): Promise<AttachmentMalwareScanResult> {
    const socket = connect(this.config);
    socket.setTimeout(this.config.timeoutMs, () => socket.destroy(new Error("ClamAV socket timed out")));

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    const responsePromise = waitForResponse(socket, this.config.timeoutMs);
    await writeWithBackpressure(socket, Buffer.from("zINSTREAM\0", "utf8"));

    for (let offset = 0; offset < data.byteLength; offset += this.config.chunkSizeBytes) {
      const chunk = data.subarray(offset, Math.min(data.byteLength, offset + this.config.chunkSizeBytes));
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.byteLength, 0);
      await writeWithBackpressure(socket, length);
      await writeWithBackpressure(socket, chunk);
    }

    await writeWithBackpressure(socket, Buffer.alloc(4));
    const response = await responsePromise;
    socket.end();
    return parseClamdScanResponse(response);
  }

  async healthCheck(): Promise<AttachmentScannerHealth> {
    try {
      const socket = connect(this.config);
      socket.setTimeout(this.config.timeoutMs, () => socket.destroy(new Error("ClamAV socket timed out")));
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      const responsePromise = waitForResponse(socket, this.config.timeoutMs);
      socket.write(Buffer.from("zPING\0", "utf8"));
      const response = (await responsePromise).replace(/\0/g, "").trim();
      socket.end();
      return response === "PONG" ? { ok: true } : { ok: false, message: response || "Empty response" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "ClamAV health check failed" };
    }
  }
}
