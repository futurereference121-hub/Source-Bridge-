/**
 * Sandbox fixture restore is permanently disabled.
 * Existing fixture rows are not deleted or rewritten.
 */

import { disabledDiagnosticMutation } from "./preview-diagnostic-guard.ts";

export async function restorePreviewSandboxFixture() {
  return disabledDiagnosticMutation("restore");
}
