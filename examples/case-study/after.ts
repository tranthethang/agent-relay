/**
 * Shaped demo — cleaned version after self-review + cross-review.
 * See narrative.md for which stage caught which issue.
 */

type User = { id: string; role: "admin" | "user" };

type ProbeDeps = {
  getReady: () => Promise<boolean>;
};

export async function healthz(deps: ProbeDeps): Promise<{ status: number; body: string }> {
  try {
    const ready = await deps.getReady();
    return ready
      ? { status: 200, body: "ok" }
      : { status: 503, body: "not-ready" };
  } catch {
    return { status: 503, body: "error" };
  }
}

export async function adminReady(
  user: User | null,
  deps: ProbeDeps,
): Promise<{ status: number; body: string }> {
  if (!user) {
    return { status: 401, body: "unauthorized" };
  }
  if (user.role !== "admin") {
    return { status: 403, body: "forbidden" };
  }
  const ready = await deps.getReady();
  return { status: ready ? 200 : 503, body: ready ? "ready" : "not-ready" };
}
