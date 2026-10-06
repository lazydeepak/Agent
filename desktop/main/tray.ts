import { Menu, Tray, nativeImage } from "electron";
import type { ManagedState } from "../../src/application/desktop-service.js";

const ICON_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMiIgaGVpZ2h0PSIyMiIgdmlld0JveD0iMCAwIDIyIDIyIj48cmVjdCB4PSIxIiB5PSIxIiB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHJ4PSI1IiBmaWxsPSIjMTIxNjFkIi8+PHBhdGggZD0iTTcgMTFoOE03IDExbDItMk03IDExbDIgMiIgc3Ryb2tlPSIjNGFkZTgwIiBzdHJva2Utd2lkdGg9IjEuOCIgZmlsbD0ibm9uZSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+";

const STATE_LABELS: Record<ManagedState, string> = {
  RUNNING: "Relay is running",
  ARMED: "Relay is armed (dormant)",
  FAILED: "Relay needs attention",
  STOPPED: "Relay is stopped"
};

export interface TrayCallbacks {
  onOpenDashboard: () => void;
  onStartAll: () => void;
  onStopAll: () => void;
  onQuit: () => void;
}

export function createManagedTray(callbacks: TrayCallbacks): ManagedTray {
  const image = nativeImage.createFromDataURL(ICON_DATA_URL);
  const tray = new Tray(image);
  const managed = new ManagedTray(tray, callbacks);
  managed.update("STOPPED");
  tray.on("click", () => callbacks.onOpenDashboard());
  return managed;
}

export class ManagedTray {
  private state: ManagedState = "STOPPED";

  constructor(
    private readonly tray: Tray,
    private readonly callbacks: TrayCallbacks
  ) {}

  update(state: ManagedState): void {
    this.state = state;
    this.tray.setToolTip(`Agent Relay — ${STATE_LABELS[state]}`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Agent Relay — ${STATE_LABELS[state]}`, enabled: false },
        { type: "separator" },
        { label: "Open Dashboard", click: () => this.callbacks.onOpenDashboard() },
        { label: "Start All", click: () => this.callbacks.onStartAll() },
        { label: "Stop All", click: () => this.callbacks.onStopAll() },
        { type: "separator" },
        { label: "Quit Agent Relay", click: () => this.callbacks.onQuit() }
      ])
    );
  }

  get current(): ManagedState {
    return this.state;
  }

  destroy(): void {
    this.tray.destroy();
  }
}
