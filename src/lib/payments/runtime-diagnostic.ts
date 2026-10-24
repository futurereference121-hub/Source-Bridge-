/**
 * Presence-only serving-runtime facts. No secrets, env dumps, or Stripe ids.
 */
export type RuntimeDiagnostic = {
  nodeVersion: string;
  deploymentSha: string | null;
};

export function servingDeploymentSha(
  env: NodeJS.Dict<string | undefined> = process.env,
): string | null {
  const sha = String(env.VERCEL_GIT_COMMIT_SHA || "").trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.toLowerCase() : null;
}

export function runtimeDiagnostic(
  env: NodeJS.Dict<string | undefined> = process.env,
  nodeVersion = process.version,
): RuntimeDiagnostic {
  return {
    nodeVersion,
    deploymentSha: servingDeploymentSha(env),
  };
}
