import { AppError } from "@/lib/api/app-error";

export type AttachmentSignature = {
  name: string;
  detectedMimeType: string;
  compatibleExtensions: readonly string[];
};

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, text: string) {
  if (bytes.length < offset + text.length) return false;
  return [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function containsAscii(bytes: Uint8Array, text: string, maxOffset = bytes.length) {
  const signature = [...text].map((character) => character.charCodeAt(0));
  const limit = Math.min(bytes.length, maxOffset);
  outer: for (let offset = 0; offset <= limit - signature.length; offset += 1) {
    for (let index = 0; index < signature.length; index += 1) {
      if (bytes[offset + index] !== signature[index]) continue outer;
    }
    return true;
  }
  return false;
}

function looksLikeUtf8Text(bytes: Uint8Array) {
  if (bytes.length === 0 || bytes.includes(0)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
    if (!text) return false;
    let acceptable = 0;
    for (const character of text) {
      const code = character.codePointAt(0) ?? 0;
      if (character === "\n" || character === "\r" || character === "\t" || code >= 0x20) {
        acceptable += 1;
      }
    }
    return acceptable / text.length >= 0.98;
  } catch {
    return false;
  }
}

export function detectAttachmentSignature(bytes: Uint8Array): AttachmentSignature | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { name: "JPEG", detectedMimeType: "image/jpeg", compatibleExtensions: ["jpg", "jpeg"] };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { name: "PNG", detectedMimeType: "image/png", compatibleExtensions: ["png"] };
  }
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return { name: "WEBP", detectedMimeType: "image/webp", compatibleExtensions: ["webp"] };
  }
  if (containsAscii(bytes, "%PDF-", 1024)) {
    return { name: "PDF", detectedMimeType: "application/pdf", compatibleExtensions: ["pdf"] };
  }
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    const zipHead = bytes.subarray(0, Math.min(bytes.length, 2 * 1024 * 1024));
    const zipTail = bytes.subarray(Math.max(0, bytes.length - 2 * 1024 * 1024));
    const hasWordEntries = containsAscii(zipHead, "word/") || containsAscii(zipTail, "word/");
    const hasExcelEntries = containsAscii(zipHead, "xl/") || containsAscii(zipTail, "xl/");
    if (hasWordEntries) {
      return {
        name: "OOXML_WORD",
        detectedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        compatibleExtensions: ["docx"],
      };
    }
    if (hasExcelEntries) {
      return {
        name: "OOXML_EXCEL",
        detectedMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        compatibleExtensions: ["xlsx"],
      };
    }
    return {
      name: "ZIP_CONTAINER",
      detectedMimeType: "application/zip",
      compatibleExtensions: ["zip"],
    };
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return {
      name: "OLE_COMPOUND_DOCUMENT",
      detectedMimeType: "application/x-ole-storage",
      compatibleExtensions: ["doc", "xls"],
    };
  }
  if (
    startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]) ||
    startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
  ) {
    return { name: "RAR", detectedMimeType: "application/vnd.rar", compatibleExtensions: ["rar"] };
  }
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return { name: "7Z", detectedMimeType: "application/x-7z-compressed", compatibleExtensions: ["7z"] };
  }
  if (asciiAt(bytes, 0, "ID3") || (bytes[0] === 0xff && bytes.length > 1 && (bytes[1]! & 0xe0) === 0xe0)) {
    return { name: "MP3", detectedMimeType: "audio/mpeg", compatibleExtensions: ["mp3"] };
  }
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE")) {
    return { name: "WAV", detectedMimeType: "audio/wav", compatibleExtensions: ["wav"] };
  }
  if (bytes.length >= 12 && asciiAt(bytes, 4, "ftyp")) {
    return { name: "MP4", detectedMimeType: "video/mp4", compatibleExtensions: ["mp4"] };
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { name: "WEBM", detectedMimeType: "video/webm", compatibleExtensions: ["webm"] };
  }
  if (looksLikeUtf8Text(bytes)) {
    return { name: "UTF8_TEXT", detectedMimeType: "text/plain", compatibleExtensions: ["txt", "csv"] };
  }
  return null;
}

export function assertAttachmentSignatureAllowed(input: {
  bytes: Uint8Array;
  extension: string;
  validationEnabled: boolean;
}) {
  const signature = detectAttachmentSignature(input.bytes);
  if (!input.validationEnabled) return signature;

  if (!signature || !signature.compatibleExtensions.includes(input.extension)) {
    throw new AppError(
      400,
      "ATTACHMENT_SIGNATURE_MISMATCH",
      "Attachment content does not match its file extension",
      {
        extension: input.extension,
        detectedSignature: signature?.name ?? null,
      },
    );
  }

  return signature;
}
