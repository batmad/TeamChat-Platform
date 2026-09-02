import { describe, expect, it } from "vitest";
import { parseClamdScanResponse } from "@/lib/attachments/scanner/clamav";

describe("parseClamdScanResponse", () => {
  it("accepts clean response", () => {
    expect(parseClamdScanResponse("stream: OK\0")).toMatchObject({ clean: true, infected: false });
  });

  it("extracts malware signature", () => {
    expect(parseClamdScanResponse("stream: Eicar-Test-Signature FOUND\0")).toMatchObject({
      clean: false,
      infected: true,
      threatName: "Eicar-Test-Signature",
    });
  });

  it("fails closed for unknown response", () => {
    expect(() => parseClamdScanResponse("stream: scan error ERROR\0")).toThrow();
  });
});
