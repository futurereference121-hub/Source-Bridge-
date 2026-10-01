/**
 * Sandbox diagnostic release is permanently disabled.
 * The normal release service is unchanged and is not called from here.
 */

import { disabledDiagnosticMutation } from "./preview-diagnostic-guard.ts";

export async function runSandboxE2eRelease() {
  return disabledDiagnosticMutation("e2e");
}
