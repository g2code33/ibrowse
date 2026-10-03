/**
 * Yayra Floating Browser - Windows Monitor & Display Scaling Manager
 * Handles multi-monitor topologies, per-monitor DPI scaling (Per-Monitor V2),
 * coordinate translation, and work area boundary clamping.
 */

import { WindowGeometry } from '../../shared-core/src/types.js';

export interface MonitorInfo {
  id: string;
  index: number;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  dpi: number; // default 96 (100% scale)
  scaleFactor: number; // 1.0, 1.25, 1.5, 2.0, etc.
  isPrimary: boolean;
}

export class WindowsMonitorManager {
  private monitors: MonitorInfo[] = [];

  constructor(initialMonitors?: MonitorInfo[]) {
    if (initialMonitors && initialMonitors.length > 0) {
      this.monitors = initialMonitors;
    } else {
      // Default primary monitor: 1920x1080 @ 96 DPI (100% scaling)
      this.monitors = [
        {
          id: 'MONITOR-0',
          index: 0,
          name: '\\\\.\\DISPLAY1 (Primary)',
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1040 }, // 40px taskbar at bottom
          dpi: 96,
          scaleFactor: 1.0,
          isPrimary: true
        }
      ];
    }
  }

  public getMonitors(): MonitorInfo[] {
    return [...this.monitors];
  }

  public getPrimaryMonitor(): MonitorInfo {
    const primary = this.monitors.find((m) => m.isPrimary);
    return primary || this.monitors[0];
  }

  public getMonitorByIndex(index: number): MonitorInfo {
    return this.monitors[index] || this.getPrimaryMonitor();
  }

  public setMonitors(monitors: MonitorInfo[]): void {
    if (monitors.length > 0) {
      this.monitors = monitors;
    }
  }

  /**
   * Identifies which monitor contains the given window coordinates or center.
   */
  public getMonitorForWindow(geometry: WindowGeometry): MonitorInfo {
    const centerX = geometry.x + geometry.width / 2;
    const centerY = geometry.y + geometry.height / 2;

    for (const monitor of this.monitors) {
      const b = monitor.bounds;
      if (
        centerX >= b.x &&
        centerX < b.x + b.width &&
        centerY >= b.y &&
        centerY < b.y + b.height
      ) {
        return monitor;
      }
    }

    return this.getPrimaryMonitor();
  }

  /**
   * Clamps window position and dimensions strictly inside the target monitor's usable work area.
   */
  public clampToMonitorWorkArea(
    geometry: WindowGeometry,
    monitorIndex?: number,
    minWidth = 320,
    minHeight = 240
  ): WindowGeometry {
    const monitor = monitorIndex !== undefined
      ? this.getMonitorByIndex(monitorIndex)
      : this.getMonitorForWindow(geometry);

    const wa = monitor.workArea;

    // Enforce minimum dimension limits
    const width = Math.max(minWidth, Math.min(geometry.width, wa.width));
    const height = Math.max(minHeight, Math.min(geometry.height, wa.height));

    // Clamp X and Y inside work area bounds
    const maxX = wa.x + wa.width - width;
    const maxY = wa.y + wa.height - height;

    const x = Math.max(wa.x, Math.min(maxX, geometry.x));
    const y = Math.max(wa.y, Math.min(maxY, geometry.y));

    return {
      x,
      y,
      width,
      height,
      monitorIndex: monitor.index
    };
  }

  /**
   * Calculates magnetic edge snapping within a snap threshold (e.g. 16px) against monitor work area edges.
   */
  public calculateEdgeSnap(
    geometry: WindowGeometry,
    snapThreshold = 16,
    monitorIndex?: number
  ): { snappedGeometry: WindowGeometry; snappedEdges: { left: boolean; right: boolean; top: boolean; bottom: boolean } } {
    const monitor = monitorIndex !== undefined
      ? this.getMonitorByIndex(monitorIndex)
      : this.getMonitorForWindow(geometry);

    const wa = monitor.workArea;
    let newX = geometry.x;
    let newY = geometry.y;

    const snappedEdges = {
      left: false,
      right: false,
      top: false,
      bottom: false
    };

    // Snap to left edge
    if (Math.abs(geometry.x - wa.x) <= snapThreshold) {
      newX = wa.x;
      snappedEdges.left = true;
    }
    // Snap to right edge
    const rightDiff = Math.abs((wa.x + wa.width) - (geometry.x + geometry.width));
    if (rightDiff <= snapThreshold) {
      newX = wa.x + wa.width - geometry.width;
      snappedEdges.right = true;
    }

    // Snap to top edge
    if (Math.abs(geometry.y - wa.y) <= snapThreshold) {
      newY = wa.y;
      snappedEdges.top = true;
    }
    // Snap to bottom edge
    const bottomDiff = Math.abs((wa.y + wa.height) - (geometry.y + geometry.height));
    if (bottomDiff <= snapThreshold) {
      newY = wa.y + wa.height - geometry.height;
      snappedEdges.bottom = true;
    }

    return {
      snappedGeometry: {
        x: newX,
        y: newY,
        width: geometry.width,
        height: geometry.height,
        monitorIndex: monitor.index
      },
      snappedEdges
    };
  }

  /**
   * Converts logical DIPs to physical pixels according to the monitor DPI.
   */
  public logicalToPhysical(dips: number, dpi: number): number {
    return Math.round(dips * (dpi / 96));
  }

  /**
   * Converts physical pixels to logical DIPs according to the monitor DPI.
   */
  public physicalToLogical(pixels: number, dpi: number): number {
    return Math.round(pixels / (dpi / 96));
  }
}
