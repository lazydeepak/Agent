/**
 * Agent-relay codebase — module explanation / info.
 * File: src/sessions/project-pairs.ts
 * Purpose: Project-pair identity / ownership service.
 */
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { ProjectPair, ProjectPairsConfig } from "../types.js";

const projectPairIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Normalized ChatGPT project key: the `g-p-<id>` segment head without any display-name suffix.
 * Id chars: alphanumerics plus `-` (UUID-style ids contain hyphens) and `_`.
 */
export const chatGptProjectSlugPattern = /^g-p-[A-Za-z0-9_-]+$/;

const workerProjectSchema = z
  .object({
    repoPath: z
      .string()
      .trim()
      .min(1, "Worker repoPath is required.")
      .refine((value) => isAbsolute(value), "Worker repoPath must be an absolute path."),
    projectId: z.string().trim().min(1, "Worker projectId cannot be empty.").optional()
  })
  .strict();

const plannerProjectSchema = z
  .object({
    projectSlug: z
      .string()
      .trim()
      .regex(
        chatGptProjectSlugPattern,
        "Planner projectSlug must look like g-p-<id> (the /g/<slug> segment of a project conversation URL)."
      ),
    projectName: z.string().trim().min(1, "Planner projectName cannot be empty.").optional()
  })
  .strict();

// `opencode` / `chatgpt` are the legacy spellings of `worker` / `planner` and are normalized on read.
const legacyProjectPairSchema = z
  .object({
    projectPairId: z
      .string()
      .trim()
      .regex(
        projectPairIdPattern,
        "projectPairId must use lowercase letters, numbers, and single hyphens, starting with a letter."
      ),
    worker: workerProjectSchema.optional(),
    opencode: workerProjectSchema.optional(),
    planner: plannerProjectSchema.optional(),
    chatgpt: plannerProjectSchema.optional()
  })
  .strict()
  .transform((value, ctx): ProjectPair => {
    const worker = value.worker ?? value.opencode;
    const planner = value.planner ?? value.chatgpt;
    if (!worker) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A worker repoPath is required." });
      return z.NEVER;
    }
    if (!planner) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A planner projectSlug is required." });
      return z.NEVER;
    }
    return { projectPairId: value.projectPairId, worker, planner };
  });

const projectPairsConfigSchema = z
  .object({
    projectPairs: z.array(legacyProjectPairSchema)
  })
  .strict();

export class ProjectPairConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid project pairs configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ProjectPairConfigError";
    this.issues = issues;
  }
}

export function parseProjectPairsConfig(input: unknown): ProjectPairsConfig {
  const parsed = projectPairsConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new ProjectPairConfigError(parsed.error.issues.map(formatZodIssue));
  }

  validateUniqueProjectPairs(parsed.data.projectPairs);

  return parsed.data;
}

function validateUniqueProjectPairs(pairs: ProjectPair[]): void {
  const issues = [
    ...findDuplicates(pairs, (pair) => pair.projectPairId).map(
      (id) => `Duplicate projectPairId "${id}". Each project pair must have a stable unique id.`
    ),
    ...findDuplicates(pairs, (pair) => pair.worker.repoPath).map(
      (repoPath) =>
        `Duplicate worker project ownership "${repoPath}". One worker project can belong to only one project pair.`
    ),
    ...findDuplicates(pairs, (pair) => pair.planner.projectSlug).map(
      (slug) =>
        `Duplicate planner project ownership "${slug}". One planner project can belong to only one project pair.`
    )
  ];

  if (issues.length > 0) {
    throw new ProjectPairConfigError(issues);
  }
}

function findDuplicates<T>(items: T[], keyForItem: (item: T) => string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const item of items) {
    const key = keyForItem(item);
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }

  return [...duplicates];
}

function formatZodIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}
