/**
 * Error type definitions for Recode.
 *
 * @author dev
 */

/**
 * Base error type for Recode.
 */
export class RecodeError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Runtime configuration error.
 */
export class ConfigurationError extends RecodeError {}

/**
 * Model response format error.
 */
export class ModelResponseError extends RecodeError {}

/**
 * Raised when the current request is aborted intentionally.
 */
export class OperationAbortedError extends RecodeError {}

/**
 * Raised when the model is stuck repeating the same tool calls.
 */
export class DoomLoopDetectedError extends RecodeError {}

/**
 * Raised when transcript compaction cannot complete safely.
 */
export class ConversationCompactionError extends RecodeError {}

/**
 * Raised when a conversation still exceeds the usable context window.
 */
export class ContextWindowExceededError extends RecodeError {}

/**
 * Tool execution error.
 */
export class ToolExecutionError extends RecodeError {}

/**
 * Workspace path escape error.
 */
export class PathSecurityError extends RecodeError {}
