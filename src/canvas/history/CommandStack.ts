import { Command } from './Command';

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxDepth = 100;
  private listeners: Array<() => void> = [];

  constructor(maxDepth = 100) {
    this.maxDepth = maxDepth;
  }

  execute(cmd: Command): void {
    cmd.execute();
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.maxDepth) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.notify();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (cmd) {
      cmd.undo();
      this.redoStack.push(cmd);
      this.notify();
    }
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (cmd) {
      cmd.execute();
      this.undoStack.push(cmd);
      this.notify();
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const globalCommandStack = new CommandStack();
