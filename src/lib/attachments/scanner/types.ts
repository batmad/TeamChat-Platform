export type AttachmentMalwareScanResult = {
  clean: boolean;
  infected: boolean;
  threatName: string | null;
  rawResult: string;
};

export type AttachmentScannerHealth = {
  ok: boolean;
  message?: string;
};

export interface AttachmentMalwareScanner {
  readonly providerId: string;
  readonly providerType: "CLAMAV" | "CUSTOM";
  readonly providerName: string;

  scan(data: Uint8Array): Promise<AttachmentMalwareScanResult>;
  healthCheck(): Promise<AttachmentScannerHealth>;
}
