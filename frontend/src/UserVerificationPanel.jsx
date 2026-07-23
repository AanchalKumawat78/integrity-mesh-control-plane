import { useEffect, useState } from "react";

export default function UserVerificationPanel({ apiFetch }) {
  const [verifications, setVerifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionPendingId, setActionPendingId] = useState(null);

  async function loadVerifications() {
    try {
      const data = await apiFetch("/api/admin/login-verifications");
      setVerifications(data.verifications || []);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load verification requests");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadVerifications();
    const interval = setInterval(() => {
      void loadVerifications();
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  async function handleApprove(requestId) {
    setActionPendingId(requestId);
    try {
      await apiFetch(`/api/admin/login-verifications/${requestId}/approve`, {
        method: "POST",
      });
      await loadVerifications();
    } catch (err) {
      alert(`Approval error: ${err.message}`);
    } finally {
      setActionPendingId(null);
    }
  }

  async function handleReject(requestId) {
    setActionPendingId(requestId);
    try {
      await apiFetch(`/api/admin/login-verifications/${requestId}/reject`, {
        method: "POST",
      });
      await loadVerifications();
    } catch (err) {
      alert(`Rejection error: ${err.message}`);
    } finally {
      setActionPendingId(null);
    }
  }

  const pendingRequests = verifications.filter((item) => item.status === "pending");
  const recentRequests = verifications.filter((item) => item.status !== "pending");

  return (
    <section className="user-verification-panel" style={{ padding: "1.5rem" }}>
      <div className="panel-title-row" style={{ marginBottom: "1.5rem" }}>
        <div>
          <span className="eyebrow">Admin Governance</span>
          <h2 style={{ fontSize: "1.5rem", fontWeight: "600", marginTop: "0.25rem" }}>
            User Login Verification Requests
          </h2>
          <p style={{ color: "#94a3b8", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            Non-admin login attempts require administrator approval. Approving a request generates and verifies the associated OTP.
          </p>
        </div>
        <span className="activity-count status-live" style={{ padding: "0.25rem 0.75rem", borderRadius: "9999px" }}>
          {pendingRequests.length} Pending
        </span>
      </div>

      {error ? (
        <div className="login-error" style={{ marginBottom: "1rem", color: "#f87171" }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "1.5rem" }}>
        <article className="policy-card">
          <h3 style={{ fontSize: "1.125rem", marginBottom: "1rem", color: "#38bdf8" }}>
            Pending Verification Requests ({pendingRequests.length})
          </h3>
          {loading && verifications.length === 0 ? (
            <div className="empty-state">Loading verification queue...</div>
          ) : pendingRequests.length === 0 ? (
            <div className="empty-state">No pending user login requests right now.</div>
          ) : (
            <div style={{ display: "grid", gap: "1rem" }}>
              {pendingRequests.map((req) => (
                <div
                  key={req.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "1rem 1.25rem",
                    background: "rgba(15, 23, 42, 0.6)",
                    border: "1px solid rgba(56, 189, 248, 0.3)",
                    borderRadius: "0.5rem",
                    gap: "1rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <strong style={{ fontSize: "1.1rem", color: "#f8fafc" }}>{req.full_name}</strong>
                      <span className="mini-badge" style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8" }}>
                        {req.role}
                      </span>
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                      Username: <code style={{ color: "#cbd5e1" }}>{req.username}</code>
                    </div>
                    <div style={{ marginTop: "0.5rem", display: "inline-block" }}>
                      <span style={{ fontSize: "0.8rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Generated OTP:
                      </span>{" "}
                      <strong
                        style={{
                          fontSize: "1.25rem",
                          letterSpacing: "0.15em",
                          color: "#4ade80",
                          fontFamily: "monospace",
                          background: "rgba(74, 222, 128, 0.1)",
                          padding: "0.2rem 0.6rem",
                          borderRadius: "0.25rem",
                          border: "1px solid rgba(74, 222, 128, 0.3)",
                        }}
                      >
                        {req.otp}
                      </strong>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.75rem" }}>
                    <button
                      type="button"
                      className="primary-button small-button"
                      style={{ background: "#22c55e", borderColor: "#16a34a" }}
                      disabled={actionPendingId === req.id}
                      onClick={() => handleApprove(req.id)}
                    >
                      {actionPendingId === req.id ? "Processing..." : "Approve Login"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button small-button"
                      style={{ color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.4)" }}
                      disabled={actionPendingId === req.id}
                      onClick={() => handleReject(req.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        {recentRequests.length > 0 ? (
          <article className="policy-card">
            <h3 style={{ fontSize: "1rem", marginBottom: "1rem", color: "#94a3b8" }}>
              Recent Verification History
            </h3>
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {recentRequests.slice(0, 10).map((req) => (
                <div
                  key={req.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.6rem 1rem",
                    background: "rgba(15, 23, 42, 0.3)",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    borderRadius: "0.375rem",
                    fontSize: "0.85rem",
                  }}
                >
                  <div>
                    <strong style={{ color: "#e2e8f0" }}>{req.username}</strong> ({req.role})
                    <span style={{ color: "#64748b", marginLeft: "0.5rem" }}>OTP: {req.otp}</span>
                  </div>
                  <span
                    style={{
                      padding: "0.15rem 0.5rem",
                      borderRadius: "0.25rem",
                      fontSize: "0.75rem",
                      fontWeight: "600",
                      textTransform: "uppercase",
                      color: req.status === "approved" || req.status === "completed" ? "#4ade80" : "#f87171",
                      background: req.status === "approved" || req.status === "completed" ? "rgba(74, 222, 128, 0.1)" : "rgba(248, 113, 113, 0.1)",
                    }}
                  >
                    {req.status}
                  </span>
                </div>
              ))}
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
}
