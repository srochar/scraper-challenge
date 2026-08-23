import { PortalState } from "../types";

export class PortalSessionState {
  private state?: PortalState;

  get(): PortalState | undefined {
    return this.state;
  }

  require(): PortalState {
    if (!this.state) {
      throw new Error("Portal client is not initialized");
    }
    return this.state;
  }

  replace(next: PortalState): PortalState {
    this.state = next;
    return next;
  }

  merge(patch: Partial<PortalState>): PortalState {
    const current = this.require();
    this.state = {
      ...current,
      ...patch,
    };
    return this.state;
  }
}
