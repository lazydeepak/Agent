/**
 * Error thrown when a submission was not attempted before a delivery
 * outcome was determined. This ensures we only record failures or
 * delivered states for messages that actually went through the send
 * path, preventing ambiguous duplicate or phantom records.
 */
export class SubmissionNotAttemptedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SubmissionNotAttemptedError";
  }
}
