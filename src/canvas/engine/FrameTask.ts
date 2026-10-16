/** Coalesce visual work only; input and persistence must never depend on a frame. */
export class FrameTask {
  private id: number | null = null;
  private task: (() => void) | null = null;

  request(task: () => void): void {
    this.task = task;
    if (this.id !== null) return;
    this.id = requestAnimationFrame(() => {
      this.id = null;
      const next = this.task;
      this.task = null;
      next?.();
    });
  }

  cancel(): void {
    if (this.id !== null) cancelAnimationFrame(this.id);
    this.id = null;
    this.task = null;
  }
}
