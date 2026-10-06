import { useState, useEffect, useCallback, useRef } from "react";
import { AgentRelayClient } from "./api-client.js";
import { getConnectionContext } from "./tauri-bridge.js";

interface ConnectionContext { endpoint: string; token: string; }
const POLL_MS = 3000;

function cls(id: string, on: boolean) { return id + (on ? "" : " hidden"); }

export default function App() {
  const [ctx, setCtx] = useState<ConnectionContext | null>(null);
  const [connState, setConnState] = useState("Disconnected");
  const [statusData, setStatusData] = useState<unknown>(null);
  const [projectPairs, setProjectPairs] = useState<unknown[]>([]);
  const [pairs, setPairs] = useState<unknown[]>([]);
  const [sessions, setSessions] = useState<unknown[]>([]);
  const [attentionData, setAttentionData] = useState<unknown[]>([]);
  const [eventsData, setEventsData] = useState<unknown[]>([]);
  const [selectedProjectPairId, setSelectedProjectPairId] = useState("");
  const [selectedPairId, setSelectedPairId] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
  const [newRepoPath, setNewRepoPath] = useState("/Users/lazydeepak/dev/agent-relay");
  const [newProjectSlug, setNewProjectSlug] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [archives, setArchives] = useState<unknown[]>([]);
  const [theme, setTheme] = useState("System");
  const [showWorker, setShowWorker] = useState(false);
  const [proposalData, setProposalData] = useState<unknown[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clientFor = useCallback((o?: Partial<ConnectionContext>) => {
    const c = ctx ?? { endpoint: "http://127.0.0.1:8181", token: "" };
    return new AgentRelayClient({ endpoint: o?.endpoint ?? c.endpoint, token: o?.token ?? c.token });
  }, [ctx]);

  useEffect(() => {
    (async () => {
      try {
        if (window.__TAURI__) {
          const t = await getConnectionContext();
          if (t) { setCtx(t); setConnState("Connecting"); return; }
        }
      } catch {}
      setCtx({ endpoint: "http://127.0.0.1:8181", token: "" });
      setConnState("Connecting");
    })();
  }, []);

  useEffect(() => {
    if (!ctx) return;
    const c = clientFor();
    pollRef.current = setInterval(async () => {
      try {
        const st = await c.getStatus();
        setStatusData(st);
        setConnState("Connected");
      } catch { setConnState("ServiceUnavailable"); }
    }, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [ctx, clientFor]);

  const refresh = useCallback(async () => {
    if (!ctx) return;
    const c = clientFor();
    try {
      const [st, pp, pl, ev, ar] = await Promise.all([
        c.getStatus(), c.listProjectPairs(), c.listPairs(),
        c.getTimeline({ limit: 50 }), c.listArchive(),
      ]);
      setStatusData(st);
      setProjectPairs(Array.isArray((pp as any)?.data) ? (pp as any).data : (pp as any)?.projectPairs ?? []);
      setPairs(Array.isArray((pl as any)?.data) ? (pl as any).data : (pl as any)?.pairs ?? []);
      setEventsData(Array.isArray((ev as any)?.data) ? (ev as any).data : []);
      setArchives(Array.isArray((ar as any)?.data) ? (ar as any).data : []);
      setConnState("Connected");
    } catch (e) { console.error("Refresh failed:", e); }
  }, [ctx, clientFor]);

  useEffect(() => { if (connState === "Connected") refresh(); }, [connState, refresh]);

  const handleCreateProject = useCallback(async () => {
    if (!ctx) return;
    try {
      await clientFor().createProjectPair({
        projectPairId: newProjectId || undefined,
        worker: { repoPath: newRepoPath },
        planner: { projectSlug: newProjectSlug || newProjectId || "default", projectName: newProjectId },
      });
      setCreateMessage("Created project."); setNewProjectId(""); setNewProjectSlug("");
      await refresh();
    } catch (e: any) { setCreateMessage("Error: " + (e?.message || e)); }
  }, [ctx, clientFor, newProjectId, newRepoPath, newProjectSlug, refresh]);

  const handleDiscover = useCallback(async (pairId: string) => {
    if (!ctx) return;
    try {
      const r = await clientFor().discoverWorkerSessions(pairId);
      setSessions(Array.isArray((r as any)?.data) ? (r as any).data : (r as any)?.sessions ?? []);
      setSelectedPairId(pairId);
    } catch (e) { console.error("Discover failed:", e); }
  }, [ctx, clientFor]);

  const handleBind = useCallback(async () => {
    if (!ctx || !selectedPairId) return;
    try {
      await clientFor().rebindWorker(selectedPairId, sessions[0]?.sessionId ?? "");
      setSessions([]); setSelectedPairId(""); await refresh();
    } catch (e) { console.error("Bind failed:", e); }
  }, [ctx, clientFor, selectedPairId, sessions, refresh]);

  const toggleExpandProject = useCallback((id: string) => {
    setExpandedProjects(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const toggleExpandSession = useCallback((id: string) => {
    setExpandedSessions(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const handleStartProject = useCallback(async (id: string) => {
    if (!ctx) return;
    try { await clientFor().startProject(id); await refresh(); } catch (e) { console.error(e); }
  }, [ctx, clientFor, refresh]);

  const handlePauseProject = useCallback(async (id: string) => {
    if (!ctx) return;
    try { await clientFor().pauseProject(id); await refresh(); } catch (e) { console.error(e); }
  }, [ctx, clientFor, refresh]);

  const handleStartAll = useCallback(async () => { if (ctx) try { await clientFor().startAll(); await refresh(); } catch (e) { console.error(e); } }, [ctx, clientFor, refresh]);
  const handleStopAll = useCallback(async () => { if (ctx) try { await clientFor().stopAll(); await refresh(); } catch (e) { console.error(e); } }, [ctx, clientFor, refresh]);

  const handleApprove = useCallback(async (_id?: string) => {
    // approve proposal
  }, []);

  const handleReject = useCallback(async (_id?: string) => {
    // reject proposal
  }, []);

  const handleRemoveProject = useCallback(async (id: string) => {
    if (!ctx) return;
    try { await clientFor().removeProjectPair(id); await refresh(); } catch (e) { console.error(e); }
  }, [ctx, clientFor, refresh]);

  const filteredPairs = selectedProjectPairId ? pairs.filter((p: any) => p.projectPairId === selectedProjectPairId) : pairs;
  const pairStatus = (p: any) => p?.runtimeStatus ?? p?.status ?? "UNKNOWN";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui", background: "#f6f5f0", color: "#181818" }}>
      {/* Top bar */}
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid #ddd9cf", background: "#fff", flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Agent Relay</span>
        <span style={{ fontSize: 11, color: "#6a6a6a" }}>config: config/pairs.local.json</span>
        <span style={{ fontSize: 11, background: "#d0f0d8", color: "#2a6a3a", padding: "2px 8px", borderRadius: 12 }}>mode: relay</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12 }}>Theme</span>
          <select value={theme} onChange={e => setTheme(e.target.value)} style={{ padding: "4px 8px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}>
            <option>System</option><option>Light</option><option>Dark</option>
          </select>
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={showWorker} onChange={e => setShowWorker(e.target.checked)} />
            Show worker when started
          </label>
          <button onClick={refresh} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#eae8db", color: "#181818", fontSize: 12, cursor: "pointer" }}>Refresh</button>
          <button onClick={handleStartAll} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2a7a4a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Start All</button>
          <button onClick={handleStopAll} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#b05c5c", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Stop All</button>
        </div>
      </header>

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left sidebar */}
        <aside style={{ width: 320, flexShrink: 0, borderRight: "1px solid #ddd9cf", background: "#fff", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px 4px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, margin: 0 }}>Projects</h2>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { const all = new Set(projectPairs.map(p => p.projectPairId)); setExpandedProjects(all); }} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #ccc", fontSize: 11, cursor: "pointer", background: "#fff" }}>Expand all</button>
                <button onClick={() => setExpandedProjects(new Set())} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid #ccc", fontSize: 11, cursor: "pointer", background: "#fff" }}>Collapse all</button>
                <button style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#2a54a8", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Add Session</button>
                <button onClick={() => { setSelectedProjectPairId(""); setNewProjectId(""); }} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#2a54a8", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>+ Add Project</button>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 12px" }}>
            {projectPairs.length === 0
              ? <p style={{ fontSize: 12, color: "#6a6a6a" }}>No projects</p>
              : projectPairs.map((pp: any) => {
                  const isExp = expandedProjects.has(pp.projectPairId);
                  const ppPairs = pairs.filter(p => p.projectPairId === pp.projectPairId);
                  return (
                    <div key={pp.projectPairId} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eae8db" }}>
                        <button onClick={() => toggleExpandProject(pp.projectPairId)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, padding: "0 4px", color: "#6a6a6a" }}>
                          {isExp ? "▼" : "▶"}
                        </button>
                        <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{pp.projectPairId}</span>
                        <span style={{ fontSize: 10, color: "#6a6a6a", marginRight: 8 }}>{ppPairs.length} pairs</span>
                        <button onClick={() => handleRemoveProject(pp.projectPairId)} style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #ccc", fontSize: 10, cursor: "pointer", background: "#fff", color: "#b05c5c" }}>Remove</button>
                      </div>
                      {isExp && ppPairs.length > 0 && (
                        <div style={{ paddingLeft: 16 }}>
                          {ppPairs.map((p: any) => (
                            <div key={p.pairId} style={{ padding: "6px 0", borderBottom: "1px solid #eae8db" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <button onClick={() => toggleExpandSession(p.pairId)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 10, padding: "0 2px", color: "#6a6a6a" }}>
                                  {expandedSessions.has(p.pairId) ? "▼" : "▶"}
                                </button>
                                <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{p.pairId}</span>
                                <span style={{ fontSize: 10, color: pairStatus(p) === "RUNNING" ? "#3fa34d" : pairStatus(p) === "STOPPED" ? "#8a8680" : "#b05c5c", fontWeight: 600 }}>{pairStatus(p)}</span>
                              </div>
                              {expandedSessions.has(p.pairId) && (
                                <div style={{ padding: "6px 0 6px 16", fontSize: 11, color: "#555" }}>
                                  <div>Worker: {p.worker?.repoPath ?? "—"}</div>
                                  <div>Session: {p.worker?.sessionId ?? "—"}</div>
                                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                    <button onClick={() => handleStartProject(p.pairId)} style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#2a7a4a", color: "#fff", fontSize: 10, cursor: "pointer" }}>Start relay</button>
                                    <button style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#eae8db", color: "#181818", fontSize: 10, cursor: "pointer" }}>Open worker session</button>
                                    <button style={{ padding: "3px 8px", borderRadius: 4, border: "none", background: "#eae8db", color: "#181818", fontSize: 10, cursor: "pointer" }}>View Progress</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
            }
          </div>
          <div style={{ borderTop: "1px solid #ddd9cf", padding: "12px 16px" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, margin: "0 0 8px 0" }}>Archive</h3>
            {archives.length === 0
              ? <p style={{ fontSize: 12, color: "#6a6a6a" }}>No archived pairs</p>
              : archives.map((a: any, i: number) => (
                <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #eae8db", fontSize: 12 }}>
                  <div style={{ fontWeight: 600 }}>{a.pairId ?? a.projectPairId ?? "Archived pair"}</div>
                  <div style={{ fontSize: 10, color: "#6a6a6a" }}>{a.archiveDate ?? a.archivedAt ?? ""}</div>
                </div>
              ))
            }
          </div>
        </aside>

        {/* Center area */}
        <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div style={{ flex: 1, padding: "16px 24px", overflowY: "auto" }}>
            {/* New Project */}
            <section style={{ marginBottom: 20, padding: "12px 16px", background: "#fff", border: "1px solid #ddd9cf", borderRadius: 8 }}>
              <h3 style={{ fontSize: 14, margin: "0 0 8px 0" }}>New Project</h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input value={newProjectId} onChange={e => setNewProjectId(e.target.value)} placeholder="project id" style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #ccc", fontSize: 12, minWidth: 160 }} />
                <input value={newRepoPath} onChange={e => setNewRepoPath(e.target.value)} placeholder="repo path" style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #ccc", fontSize: 12, minWidth: 240 }} />
                <input value={newProjectSlug} onChange={e => setNewProjectSlug(e.target.value)} placeholder="planner slug (optional)" style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #ccc", fontSize: 12, minWidth: 180 }} />
                <button onClick={handleCreateProject} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#2a7a4a", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Create Project</button>
              </div>
              {createMessage && <p style={{ fontSize: 11, color: "#2a7a4a", margin: "4px 0 0 0" }}>{createMessage}</p>}
            </section>

            {/* Pairs */}
            <section style={{ padding: "12px 16px", background: "#fff", border: "1px solid #ddd9cf", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h3 style={{ fontSize: 14, margin: 0 }}>Sessions</h3>
                <span style={{ fontSize: 11, color: "#6a6a6a" }}>{filteredPairs.length} pairs</span>
              </div>
              {proposalData.length > 0 && (
                <div style={{ marginBottom: 12, padding: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{proposalData.length} pending proposals</span>
                </div>
              )}
              {filteredPairs.length === 0
                ? <p style={{ fontSize: 12, color: "#6a6a6a" }}>No pairs</p>
                : filteredPairs.map((p: any) => (
                  <div key={p.pairId} style={{ padding: "12px 0", borderBottom: "1px solid #eae8db" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.pairId}</div>
                        <div style={{ fontSize: 11, color: "#555" }}>Worker: {p.worker?.repoPath ?? "—"}</div>
                      </div>
                      <span style={{ fontSize: 10, color: pairStatus(p) === "RUNNING" ? "#3fa34d" : "#8a8680", fontWeight: 600 }}>{pairStatus(p)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <button onClick={() => handleStartProject(p.pairId)} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#2a7a4a", color: "#fff", fontSize: 11, cursor: "pointer" }}>Start relay</button>
                      <button style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#eae8db", color: "#181818", fontSize: 11, cursor: "pointer" }}>Open worker session</button>
                      <button style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#eae8db", color: "#181818", fontSize: 11, cursor: "pointer" }}>View Progress</button>
                      <button onClick={() => handlePauseProject(p.pairId)} style={{ padding: "4px 10px", borderRadius: 4, border: "none", background: "#b05c5c", color: "#fff", fontSize: 11, cursor: "pointer" }}>Stop</button>
                    </div>
                  </div>
                ))
              }
            </section>
          </div>

          {/* Right sidebar */}
          <aside style={{ width: 280, flexShrink: 0, borderLeft: "1px solid #ddd9cf", background: "#fff", overflowY: "auto", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #eae8db", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, margin: 0 }}>Events</h3>
              <span style={{ fontSize: 11, color: "#6a6a6a" }}>{eventsData.length} events</span>
            </div>
            <div style={{ flex: 1, padding: "8px 16px", overflowY: "auto" }}>
              {eventsData.length === 0
                ? <p style={{ fontSize: 12, color: "#6a6a6a" }}>No events</p>
                : eventsData.map((ev: any, i: number) => (
                  <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #f0f0f0", fontSize: 11 }}>
                    <div style={{ fontWeight: 600, color: "#181818" }}>{ev.type ?? ev.event ?? "Event"}</div>
                    <div style={{ color: "#6a6a6a" }}>{ev.detail ?? ev.message ?? ""}</div>
                    <div style={{ color: "#8a8680", fontSize: 10 }}>{ev.timestamp ?? ev.time ?? ""}</div>
                  </div>
                ))
              }
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}