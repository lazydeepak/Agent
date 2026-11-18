/**
 * Agent-relay codebase — module explanation / info.
 * File: desktop/renderer/initialize-toast.ts
 * Purpose: Build the Initialize-pair toast outcome from the validation report,
 *          without hiding non-PASS evidence behind vague wording.
 */
export interface ValidationCheckLike {
  name: string;
  status: string;
  reason: string;
}

export interface ValidationResultLike {
  status?: string;
  checks?: ValidationCheckLike[];
}

export interface InitializeOutcome {
  tone: "ok" | "error";
  message: string;
}

export function initOutcome(pairId: string, result: ValidationResultLike | undefined): InitializeOutcome {
  if (result?.status === "READY") {
    return { tone: "ok", message: `Pair "${pairId}" initialized: ready for relay.` };
  }
  const nonPass = (result?.checks ?? []).filter((check) => check.status !== "PASS");
  if (nonPass.length > 0) {
    const details = nonPass.map((check) => `${check.name}: ${check.reason}`).join(" · ");
    return {
      tone: "error",
      message: `Pair "${pairId}" is not ready — ${nonPass.length} check${nonPass.length === 1 ? "" : "s"} need attention: ${details}`
    };
  }
  // Validator returned a non-READY status with no failing evidence — say exactly that.
  return {
    tone: "error",
    message: `Pair "${pairId}" initialized — validation status "${result?.status ?? "unknown"}" (no failing checks reported). See the pair's activity log and Settings before relying on relay.`
  };
}
