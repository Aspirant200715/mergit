import { describe, expect, it } from "vitest";
import { describeReport } from "./report";

describe("describeReport", () => {
  it("never calls a v0 receipt attested", () => {
    const d = describeReport({ status: "unattested_valid", reasons: ["UNATTESTED"], phi_holds: true });
    expect(d.tone).toBe("ok");
    expect(d.label).toBe("Verified, unattested (development key)");
    expect(d.reasons).toEqual([]);
    expect(d.phi).toBe("The task's check passed");
  });

  it("lists every reason for an invalid receipt in plain words", () => {
    const d = describeReport({ status: "invalid", reasons: ["ROOT_MISMATCH", "UNATTESTED"], phi_holds: true });
    expect(d.tone).toBe("bad");
    expect(d.label).toBe("Invalid receipt");
    expect(d.reasons).toEqual(["The Merkle root does not match the steps (ROOT_MISMATCH)"]);
  });

  it("keeps an unknown reason code visible rather than dropping it", () => {
    expect(describeReport({ status: "invalid", reasons: ["SOMETHING_NEW"], phi_holds: null }).reasons).toEqual([
      "SOMETHING_NEW",
    ]);
  });

  it("says when the task's check failed or could not be read", () => {
    expect(describeReport({ status: "unattested_valid", reasons: ["UNATTESTED"], phi_holds: false }).phi).toBe(
      "The task's check failed",
    );
    expect(describeReport({ status: "invalid", reasons: ["BLOB_MISSING"], phi_holds: null }).phi).toBe(
      "The task's check result could not be read",
    );
  });
});
