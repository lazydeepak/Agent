# Global Relay Automation Rules Contract

**Version:** 1.1 — Consolidated Final Candidate, Alignment Revision 2 (ratified)
**Authority:** Operator  
**Ratified:** 2026-11-14 by explicit operator instruction ("we need to align to new policy").  
**Status:** ACTIVE v1.1 — supersedes Global Relay Automation Rules v1.0 per Appendix A.  
**Implementation status:** This repository is mid-alignment. See `docs/v1.1-alignment-tracker.md` for the clause-by-clause implementation status. Claims of conformity require the audit in that tracker, not this ratification alone.

> Baseline for edits: any divergence between this document and v1.0 resolves in favor of this v1.1 text. The v1.0 file is retained in git history only.

---

## 1. Governance, precedence, and roles

1. The operator alone establishes, changes, accepts, or removes governing behavior rules. AI suggestions are not automatically policy. For a genuinely uncovered policy decision, ask the operator; ordinary engineering choices within approved rules do not need approval.
2. Precedence: explicit operator restrictions and lifecycle commands; mandatory transport/execution/ownership and permission safety fences; authorized deterministic recovery; scoped Recovery Agent decisions; Planner project decisions; routine relay automation. Lower authority cannot bypass higher authority.
3. **Planner** selects Worker jobs and project progress. **Worker** performs jobs and reports actual results. **Core Relay Engine** manages capture, readiness, delivery, evidence, sequencing, and safe continuation, not project planning or substantive job correctness. **Local Recovery Controller** performs bounded deterministic procedures. **Recovery Agent** is the dedicated OpenCode recovery session and successor to the legacy **Recovery Agent** role; they are not competing authorities.
4. Different pairs may work concurrently. Jobs within each pair are sequential; a failure of one pair must not block healthy independent pairs except where a genuinely shared safety dependency exists.
5. Global rules apply to all managed projects; provider-specific mechanisms and project implementation plans may differ. Exceptions require operator approval. An unsupported capability must be reported and handled conservatively, not presumed present.

## 2. Universal Planner–Worker relay (supersedes v1.0 universal policy only where explicitly stated)

1. In a configured managed relay workflow, a completed Planner response with **exactly one unambiguous structured `writing_block` Worker prompt** is eligible for immediate delivery to the bound Worker without a new semantic approval token or Planner authorization. **Immediate** means as soon as readiness, ordering, identity, durable admission, and safety fences permit; no Planner prose may arbitrarily veto it.
2. With zero or multiple qualifying blocks, ask Planner **once** for an unambiguous Worker prompt. If the next completed response remains invalid, forward the **exact Planner response verbatim** to the configured Recovery Agent. If the Agent is unavailable, preserve the issue and apply the applicable escalation rule; do not silently drop it.
3. Worker job failures return actual completed work, errors, and pending work to Planner; Planner determines the next job. If Worker cannot operate, escalate model/session diagnosis to Recovery Agent subject to model permissions.
4. A Worker report is relayed only when its source session, ownership, and operation correlation are established. Planner conversation may continue while Worker works; Bot waits for a safe interaction boundary to deliver the report. Manual user messages and user-delivered handoffs are not automatically managed relay operations. Overlapping manual activity must be reconciled before further managed dispatch.
5. No automated dispatch of unrelated user conversation; only configured managed responses are eligible.

## 3. Message identity, durable admission, and evidence

1. Every **relay message** carries a compact visible globally unique Relay ID and UTC timestamp watermark, preserving v1.0 Rule 14. Internally correlate pair, assignment/job, source/destination session, provider message identity where available, attempt generation, and evidence.
2. Durably admit the intended operation **before** external send, recording destination, message class, payload identity/integrity, generation, authorization, and state. If durable admission fails, do not send. If a crash occurs after admission, treat the result as uncertain until reconciled.
3. Maintain causally linked but distinct dispatch-attempt, delivery, execution, continuation, and closure facts. A successful provider call does not by itself prove execution. A Planner/Agent declaration cannot manufacture transport evidence.
4. Prevent known duplicate or conflicting Worker execution to the extent enforceable. **Universal exactly-once execution is not guaranteed** across nontransactional providers. When an earlier instruction may have been delivered/executed, do not blindly resend or start conflicting work.
5. Verify exact destination delivery using available message identity, history, and independent evidence. If uncertain, wait **two minutes** before the next verification retry and use alternative methods. If confirmed present, do not resend; if confirmed absent **and attributable execution is excluded**, a controlled retry is permitted. Otherwise hold and escalate. The two-minute interval is separate from connection retry timing.
6. Unknown remains unknown. Administrative abandonment or closure does not prove non-delivery or non-execution. Preserve unresolved safety evidence through restart and routine cleanup; storage/corruption failure blocks new unsafe admission and is reported.

## 4. Narrow startup/resume control-prompt exception

1. A Planner **startup activation** or **resume reconciliation** prompt is a control-plane request needed where the application has no independent start trigger. It is not a Worker job instruction. A bounded repeat may be permitted even if earlier activation delivery is uncertain; this is the **only** exception to ordinary uncertain-delivery resend restrictions.
2. One durable startup-operation identity binds the exact Planner/Worker sessions and Fresh Start/Resume mode. Each attempt has its own identifier, durable pre-send record, capture context, and configurable retry/time budget.
3. Before a repeat: verify destination identity; inspect available response evidence; confirm no attributable completed response was accepted; confirm no Worker instruction was admitted from that startup operation; ensure capture is armed and no operator/safety prohibition applies. Do not repeat when an attributable completed response already exists.
4. Admit **at most one** Planner response as the first continuation using a durable atomic acceptance fence **before** Worker dispatch. When multiple attributable responses exist, prefer the **latest completed response** only if its session identity, ordering, and causal relationship to the active startup operation are established and no earlier response has already been accepted or produced Worker dispatch. Otherwise hold for reconciliation; do not choose by text similarity, arrival order alone, or a guessed timestamp. Delayed, repeated, or competing responses cannot independently generate additional Worker jobs. Correlate and quarantine them; if correlation is insufficient, hold and reconcile rather than guess.
5. A new startup operation cannot erase unresolved earlier activation evidence. Retry exhaustion yields an explicit startup hold and operator notification. The exception never applies to Worker instructions, Worker reports as new events, or side-effecting recovery actions.

## 5. Pair lifecycle and operator controls (explicitly supersedes v1.0 Rules 17–19)

1. Expose only the primary paired controls **Pause/Resume** and **Stop/Start**, plus global **Stop All**. Internal holds and recovery statuses do not require additional primary action buttons.
2. **Pause** gracefully allows an active Worker operation to reach a safe boundary, captures report/state, and prevents the next relay dispatch. **Resume** restores capture and reconciliation, not an automatic license to replay work.
3. **Stop** ends the selected pair's relay transport; an already-running Worker may finish, with its report retained but not automatically forwarded. Stop disables that pair's Auto Resume and makes it ineligible for automatic continuation. **Start** is immediately available as an operator command without a separate release step; offer Fresh Start or Resume and perform mandatory capture-first checks. Start may enter a safety hold rather than dispatch conflicting work.
4. **Stop All** is a one-time command, **not** a persistent lock. Block all relay transport; issue ownership-scoped termination for **Bot-owned Worker executions**, preserving Bot and the shared OpenCode service; disable Auto Resume and automatic eligibility for all pairs; retain all operation/termination evidence. Distinguish **termination requested**, **termination verified**, and **termination unverified**; do not report the command as proof that every Worker stopped. Afterward the operator may Start any pair normally without a global unlock or additional confirmation, subject only to ordinary execution-safety reconciliation.
5. Unverified termination is **not** successful termination. Record and notify, preserve ownership evidence, and prohibit conflicting new Worker execution until reconciled. Never terminate unrelated external processes merely because they share OpenCode.
6. An operator Stop or Stop All cannot be undone by an agent, ordinary recovery, or Auto Resume. A fresh explicit Start is permitted, but does not override safety holds. The former v1.0 Emergency Stop Pair and Emergency Stop All semantics are **replaced** by this lifecycle design; Stop Pair does not imply immediate Worker termination, while Stop All requests Bot-owned Worker termination.

## 6. State, restart, and Auto Resume (supersedes v1.0 Rule 15 where different)

1. Record separately: operator intent (Running/Paused/Stopped), runtime condition, per-pair Auto Resume configuration, resume eligibility, and active safety restrictions. Runtime observations must not silently rewrite operator intent.
2. Auto Resume defaults **OFF** (remain paused / require operator action). After ordinary restart, previously **Running or Paused** pairs are eligible; **Stopped** or **Stop All-affected** pairs are ineligible. Eligibility is not permission: Auto Resume must be enabled and safety checks passed.
3. During the current runtime, manual Pause remains in force until operator Resume. If Auto Resume is **ON**, an explicitly Paused pair **may automatically continue after application restart**. Settings must state this plainly. Stop/Stop All disable automatic continuation regardless of stale settings.
4. Restart clears transient process state, **not** durable operation records, unresolved delivery/execution evidence, operator restrictions, or relevant configuration. Rediscover exact sessions and reconcile current evidence; if recorded and current state are proven to match, continue from the verified point; otherwise request Planner reconciliation. An unresolved delivery hazard cannot be cleared by a Planner handshake.
5. Ordinary recovery of a temporarily disconnected pair may resume automatically only if operator intent and applicable recovery policy allow it and no unresolved safety restriction blocks it.

## 7. Capture-first Start/Resume and busy-session handling

1. **Start → arm capture on both sides → establish observation boundary → inspect both sessions → select starting side → continue.** Both sides must be reachable for ordinary relay startup. If not, wait and use approved connection recovery; never presume partial capture complete.
2. Prefer provider cursors/replay or a provably overlapping subscription/snapshot with deduplication. Snapshot plus subscription alone is not proof of atomic capture. When gap-free observation cannot be established, mark completeness unknown and hold any action that depends on missing evidence.
3. Planner busy / Worker idle: capture Planner's next completed output. Worker busy / Planner idle: capture Worker's next completed report **only after ownership/correlation is established**. Both idle: initiate Planner handshake. Both busy: ask the operator which side establishes the first turn; continue capturing both, preserve the unselected output, and do not choose automatically.
4. If both are busy and operator selection is pending, show **Awaiting Starting-Side Selection**. Buffering is bounded; overflow marks completeness unknown, preserves available evidence, and blocks unsafe continuation. No silent loss or invented continuity.
5. **Fresh Start** establishes a new baseline and asks Planner for the next job; it does not replay old Worker instructions. **Resume** uses direct continuation only when latest recorded and current session state are proven consistent. Otherwise provide Planner last known state, latest relevant Worker report (mark possible prior delivery), uncertainties, and request the next job. This decides project continuation, not transport safety.
6. Use stable session/message identities and ordering where available. Text similarity alone is insufficient. If responses cannot be safely correlated, hold and notify.

## 8. Planner and Worker connectivity recovery (retains v1.0 Rules 4–10 with explicit changes)

1. **Planner unavailable:** refresh the exact session and retry; if needed close/reopen the exact Planner session URL and retry. Reconcile whether Worker report reached Planner and whether Planner already replied. Deliver only genuinely missing, safely correlated handoffs; apply the one-clarification rule for invalid responses. Escalate continuing unavailability to Recovery Agent. Do not replay completed handoffs.
2. **OpenCode Worker disconnected:** retry once; if unsuccessful wait **ten minutes** and retry; then contact Recovery Agent and require its response before entrusted repair. If unresolved, visibly hold/pause affected pair with reason. The legacy fallback allowing shared OpenCode termination merely because no other pair has a *responding* Worker is **superseded** by Section 9's stricter verified-idle requirement.
3. Pause/hold only affected pairs where feasible; healthy independent pairs continue. Verify original Worker session, job, messages, and Planner state before ordinary recovery continuation.
4. Monitor using **OpenCode service API first**, desktop UI second, Recovery Agent investigation last. Legitimate active jobs have no fixed execution timeout. Start the **one-hour continuous unverifiable-progress** timer when progress first becomes unverifiable, not at job start; clear it when progress becomes verifiable. At one hour escalate investigation, not automatic termination.
5. Following a monitoring interruption, restore the original session, recover available events, reconcile outstanding operations, and mark unrecoverable gaps explicitly; do not invent completeness.

## 9. Shared OpenCode recovery (supersedes v1.0 Rule 5 fallback)

1. Local Recovery Controller may perform a predefined shared-service recovery only when the **operation and scope** are already authorized. Recovery Agent shared-service changes require an applicable explicit grant; routing a request through the Controller does not expand authority.
2. Before shared OpenCode restart, verify **every potentially affected Worker is idle**. Active, unreachable, or unobservable is **not** idle. Do not restart while any such state remains. This deliberately replaces the old *no other responding Worker* criterion.
3. Wait only within a configurable deadline. If verified safe, temporarily pause affected running pairs, restart the shared service, verify restoration, and restore only previously running eligible pairs. Previously paused/stopped pairs stay unchanged except where the explicit Auto Resume restart policy applies to an actual application restart.
4. On deadline exhaustion, do not restart. Record **Awaiting Operator — Shared-Service Restart Unsafe**, notify operator, and permit authorized investigation without bypassing the idle requirement. Re-evaluation on new evidence does not reset recovery limits. Unrelated safe work may continue.

## 10. Recovery Agent authority and availability (supersedes v1.0 Rule 11 only as specified)

1. Each automation project has one persistent dedicated OpenCode Recovery Agent session, idle until escalated. Legacy **Recovery Agent** references refer to this successor role where the integration has migrated; an unmigrated deployment must identify its configured equivalent and must not assume migration is complete.
2. Agent may inspect and operate on the affected pair using granted permissions, reconnect sessions, request authorized runtime repairs, and change Worker models **only within the operator-approved model list**. Outside-list model changes, source-code changes, and Planner/Worker session replacement require explicit operator approval. Monitor context usage where measurable and warn near limits; never replace sessions automatically.
3. Agent may request Resume within scope, without case-by-case Bot approval for an already permitted action. It **cannot** resume a pair explicitly Stopped, Stop All-affected, operator-suspended, permission-revoked, or blocked by unresolved transport/execution safety. A rejected request is recorded and reported; a permitted request still performs normal capture and reconciliation.
4. Agent-reported recovery, restored connectivity, verified operational health, and reconciled transport are distinct facts. Only the Relay Engine's appropriately supported evidence permits verified operational resolution.
5. **Agent unavailable:** preserve the incident/queue, notify the operator immediately, and attempt **bounded reconnection to the same existing Agent session** through the already-authorized connection-monitoring path. This permits reattaching to the original session, not replacing it, changing its identity, restarting shared OpenCode, or modifying runtime state. If reconnecting requires a disruptive action, new permission, or session replacement, stop and request operator authorization. Continue queued recovery only after original-session identity and current evidence are verified; otherwise hold. For the specific OpenCode-disconnection sequence, the Local Recovery Controller may proceed only with Section 9's already-authorized verified-idle shared-service procedure; otherwise hold and notify. **This explicitly supersedes v1.0 Rule 11's prohibition on automatic Recovery Agent recovery only for bounded, non-disruptive reconnection to the same session.**
6. Agent session replacement requires operator authorization. Replacement begins as a new conversation with a fresh briefing drawn from durable incident evidence; it does not silently inherit conversation history.

## 11. Recovery incidents, limits, and permissions

1. Classify incidents locally and attempt only permitted deterministic recovery; escalate unresolved cases to Recovery Agent subject to specific rules. Process recovery incidents sequentially: critical system-wide first, otherwise oldest first. Revalidate queued incidents after each resolution.
2. Each briefing identifies pair/session, evidence, failure, previous actions, unresolved uncertainty, and permission scope. An **attempt** is an **initiated corrective action whether successful or not** (e.g. reconnection or restart). Passive inspection and evidence gathering are logged but do not consume corrective-action attempts. Repetition counts again; changing strategy does not reset counts.
3. Enforce independently configurable maximum corrective attempts and maximum active recovery duration. The first exhausted limit ends corrective automation and yields an explicit hold/escalation. The one-hour unverifiable-progress threshold is a separate trigger, not a budget reset.
4. Repeated matching failures within a configured window suspend automated recovery for the affected pair. **Only operator** may release that suspension. Releasing resets the repeat counter but preserves history.
5. Permissions are project-scoped and least-privilege by default. Additional authority requires operator approval: one-time incident/action grants by default, or explicitly scoped permanent grants. Revocation blocks **new admission immediately**; cancel ongoing work where supported and safe, otherwise stop at the earliest enforceable boundary and record irreversible external effects. Keep append-only audit history.
6. If Agent is unavailable, preserve queue and notify. Queue/storage limits and stale-data indicators must be defined. Never silently discard unresolved safety evidence; if durable recording cannot proceed, block unsafe new operations.
7. Terminal incident dispositions include resolved with evidence, held, awaiting operator, authorized abandonment, verified termination, unverified termination, and unresolved. Abandonment does not prove nonexecution.

## 12. Recovery dashboard and settings

1. Recovery dashboard groups: **Requires Attention → Active → Queued → Resolved**, newest first within each. Show affected pair, current status, corrective attempts, evidence, chronological incident detail, and verified versus agent-reported outcomes. Use event updates or polling; visibly mark stale/unavailable data.
2. Recovery incident Pause/Resume/Cancel controls are separate from the three primary pair controls. Cancel leaves the affected pair paused/held unless operator explicitly changes pair state.
3. Save operator settings immediately where safe; current Worker operation ordinarily completes under existing rules, with changed behavior applied at next safe boundary. Revoked safety permissions take effect at the earliest enforceable boundary as Section 11 specifies. Model changes apply to next applicable request.
4. Per-pair Auto Resume defaults OFF. Operator-approved model lists remain enforceable before any full model-management UI exists. Session-context warnings do not authorize session replacement.
5. Operator configures retention in Settings. Routine resolved-history archiving/deletion follows configuration; unresolved transport, ownership, and incident safety evidence remains protected. Detailed Activity and UI design may live in separate design specifications.

## 13. Authorization coordination and optional Bot V2 modules

1. Operator-level permission blockers are distinct from Planner's internal Worker permissions. Authorization Coordination must not add approval to a valid eligible `writing_block` dispatch.
2. When Planner reports an operator-level blocker, Bot may ask whether an independent already-authorized job is available **without delaying an already valid Worker prompt**. If no eligible work remains and a real operator permission decision is needed, surface it. Only operator grants/denies; delivery of that decision is a separately correlated durable operation.
3. No further eligible job without an outstanding operator permission request is normal idle/completion, not automatically an authorization incident.
4. Advanced loop detection, full AI Model Management, project management, and full project prompt/report archives are optional future modules requiring separate discussion/authorization. Core Relay retains essential safety-critical evidence regardless.
5. **Bot-only planning record, not global runtime policy:** priority order recorded in the uploaded v1.1 draft was (1) review/commit/push approved changes to `main`, (2) OpenCode Server Integration, (3) Bot Engine V2. This is historical project sequencing and requires confirmation before treating it as a current implementation plan.

## 14. Verification, capability limits, and acceptance

1. Test durable write-before-dispatch; crash recovery; duplicate/competing-dispatch fences; startup retries and late responses; exact session identity; capture gaps and bounded overflow; busy-side selection; lifecycle and Auto Resume; Bot-owned termination; shared-service verified-idle gating; Agent permissions; recovery budgets; stale/unknown evidence and retention.
2. No integration may claim gap-free capture, universal exactly-once execution, reliable external termination, or instant cancellation without corresponding evidence. Where the provider lacks required capabilities, expose **Unknown/Held** and block only operations whose safety depends on the missing evidence; do not invent verification.
3. Repository/source feasibility verification and runtime validation are separate from accepting policy intent. A test pass covers only tested scenarios; existing repositories cannot claim compliance until audited.
4. **Rule 23 remains intentionally unassigned.** Legacy v1.0 numbered rules are retained in substance where not explicitly superseded here; this consolidated document is the sole candidate v1.1 text, not a requirement to consult draft amendments at runtime.
5. On explicit operator ratification, this document becomes the governing v1.1 policy. Ratification alone does not authorize implementation, runtime actions, or permission expansion. Until then **v1.0 remains authoritative**.

## Appendix A — Explicit v1.0 supersession map

| v1.0 provision | v1.1 treatment |
|---|---|
| Global governance; universal `writing_block` forwarding | Retained with transport safety, managed-scope, and Recovery Agent terminology clarifications (§§1–3) |
| Rules 1–3: failure, model diagnosis, pair concurrency | Retained (§§1–2, 10) |
| Rule 4: Planner unavailable | Retained with exact-session reconciliation (§8) |
| Rule 5: Worker disconnection | Ten-minute sequence retained; unsafe shared-process fallback **replaced** by verified-idle gating (§§8–9) |
| Rules 6–10: affected-pair pause, ordinary recovery, monitoring, one-hour threshold | Retained with explicit safety precedence (§§6, 8) |
| Rule 11: Recovery Agent unavailable | **Amended:** immediate operator notification retained; bounded, non-disruptive reconnection to the same Recovery Agent session allowed; autonomous replacement and disruptive repair prohibited; Rule 5 exception constrained (§10) |
| Rules 12–14: verification, two-minute interval, visible watermark | Retained, with durable admission and narrow startup exception (§§3–4) |
| Rule 15: restart | Replaced by explicit intent/eligibility and paused-pair Auto Resume semantics (§6) |
| Rule 16: changes during execution | Retained with permission revocation boundary (§§11–12) |
| Rules 17–19: Graceful Pause / Emergency Stop Pair / Emergency Stop All | **Replaced** by Pause/Resume, Stop/Start, Stop All (§5) |
| Rules 20–22: approved models, operational repair, context limits | Retained under Recovery Agent authority (§10) |
| Rule 23 | Intentionally absent |
| Rule 24: retention | Retained with unresolved-evidence exception (§12) |
| Uploaded draft V2 amendments A–F | Integrated as managed transport, recovery, authorization, models, optional modules, and historical project plan (§§1–3, 10–13) |

## Appendix B — Outstanding non-policy verification

- Confirm provider-level session/message identities, event replay and startup-response correlation.
- Audit durable admission and crash-consistent dispatch fences in actual Bot source.
- Verify process ownership and cancellation/termination evidence across local and remote OpenCode execution.
- Validate all-pair verified-idle checks and shared-service restart isolation.
- Validate dashboard staleness, recovery budget persistence, and permission enforcement.
- Obtain explicit operator acceptance of this consolidated text; until then it remains a candidate.

## Appendix C — Final alignment decisions

1. **Startup responses:** the latest completed response is preferred only when reliably correlated, causally ordered, and not superseded by an already admitted continuation; ambiguous responses hold rather than produce duplicate work (§4).
2. **Stop All:** one-time termination request, not a persistent lock or guarantee of successful termination; unverified executions remain safety constraints, but ordinary Start needs no extra release (§5).
3. **Recovery Agent availability:** bounded non-disruptive reconnection of the original Agent session is permitted and explicitly supersedes the narrow v1.0 Rule 11 restriction; session replacement and disruptive recovery still require operator permission (§10).
