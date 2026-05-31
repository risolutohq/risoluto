export class WorkflowExecutorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowExecutorError";
  }
}
