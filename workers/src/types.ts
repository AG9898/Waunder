// Shared types for the automation worker. These mirror the structured
// payloads Rails generates and approves before dispatching a submit task.

/** ATS platforms the worker may support. Mirrors route types in the plan. */
export type AtsKind = "greenhouse" | "lever" | "ashby" | "linkedin_easy_apply";

/** A single answer to a form field, prepared and approved by the backend. */
export interface FieldAnswer {
  /** Stable field identifier (label, name, or selector hint). */
  field: string;
  /** The value to fill. */
  value: string;
}

/** An approved application submission task received from Rails. */
export interface ApplicationTask {
  /** Rails-side application record id, for status reporting. */
  applicationId: string;
  ats: AtsKind;
  /** The application form URL to drive. */
  applyUrl: string;
  /** Structured, pre-approved field answers. */
  answers: FieldAnswer[];
  /** Resume file reference (URL or path) when the form requires upload. */
  resumeRef?: string;
}

/** Rails response for the worker task poll endpoint. */
export interface WorkerTaskResponse {
  tasks: ApplicationTask[];
}

/** Terminal outcome of attempting a task. */
export type TaskStatus = "submitted" | "paused" | "failed";

/** Result reported back to Rails, with an audit trail. */
export interface TaskResult {
  applicationId: string;
  status: TaskStatus;
  /** Human-readable reason, required for paused/failed. */
  reason?: string;
  /** Screenshot references captured during the run, for auditing. */
  screenshots: string[];
  logs: string[];
}
