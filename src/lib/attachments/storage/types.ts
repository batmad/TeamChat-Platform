export type AttachmentStorageHealth = {
  ok: boolean;
  message?: string;
};

export type AttachmentStoragePutInput = {
  key: string;
  data: Uint8Array;
  contentType?: string | null;
};

export type AttachmentStoragePutResult = {
  key: string;
  sizeBytes: number;
};

export type AttachmentStorageSignedReadInput = {
  key: string;
  responseContentType?: string | null;
  responseContentDisposition?: string | null;
  maxExpiresInSeconds?: number | null;
};

export interface AttachmentStorageProvider {
  readonly providerId: string;
  readonly providerType: "LOCAL" | "S3" | "MINIO" | "AZURE_BLOB" | "CUSTOM";

  put(input: AttachmentStoragePutInput): Promise<AttachmentStoragePutResult>;
  read(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  healthCheck(): Promise<AttachmentStorageHealth>;

  /**
   * Returns a short-lived private read URL when the provider supports and enables it.
   * Returning null means TeamChat should proxy/stream the bytes instead.
   */
  createSignedReadUrl?(
    input: AttachmentStorageSignedReadInput,
  ): Promise<string | null>;
}
