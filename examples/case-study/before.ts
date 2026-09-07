/**
 * Shaped demo — intentional bugs for the agent-relay case study.
 * Not from a real pipeline run; see narrative.md.
 */

type User = { id: string; role: "admin" | "user" };

type ProbeDeps = {
  getReady: () => Promise<boolean>;
};

// BUG (self-review): readiness ignored + errors swallowed — always looks healthy.
export async function healthz(deps: ProbeDeps): Promise<{ status: number; body: string }> {
  try {
    await deps.getReady();
    return { status: 200, body: "ok" };
  } catch {
    return { status: 200, body: "ok" };
  }
}

// BUG (cross-review): authz gap — any caller can read admin-only probe detail.
export async function adminReady(
  user: User | null,
  deps: ProbeDeps,
): Promise<{ status: number; body: string }> {
  // Incomplete authz: only verifies "signed in", not role.
  if (!user) {
    return { status: 401, body: "unauthorized" };
  }
  const ready = await deps.getReady();
  return { status: ready ? 200 : 503, body: ready ? "ready" : "not-ready" };
}
