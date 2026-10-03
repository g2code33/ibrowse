/**
 * Yayra Floating Browser - Windows Monitor & Display Scaling Manager
 */

export class WindowsMonitorManager {
  constructor(initialMonitors) {
    if (initialMonitors && initialMonitors.length > 0) {
      this.monitors = initialMonitors;
    } else {
      this.monitors = [
        {
          id: 'MONITOR-0',
          index: 0,
          name: '\\\\.\\DISPLAY1 (Primary)',
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          dpi: 96,
          scaleFactor: 1.0,
          isPrimary: true
        }
      ];
    }
  }

  getMonitors() {
    return [...this.monitors];
  }

  getPrimaryMonitor() {
    const primary = this.monitors.find((m) => m.isPrimary);
    return primary || this.monitors[0];
  }

  getMonitorByIndex(index) {
    return this.monitors[index] || this.getPrimaryMonitor();
  }

  setMonitors(monitors) {
    if (monitors.length > 0) {
      this.monitors = monitors;
    }
  }

  getMonitorForWindow(geometry) {
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

  clampToMonitorWorkArea(geometry, monitorIndex, minWidth = 320, minHeight = 240) {
    const monitor = monitorIndex !== undefined
      ? this.getMonitorByIndex(monitorIndex)
      : this.getMonitorForWindow(geometry);

    const wa = monitor.workArea;

    const width = Math.max(minWidth, Math.min(geometry.width, wa.width));
    const height = Math.max(minHeight, Math.min(geometry.height, wa.height));

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

  calculateEdgeSnap(geometry, snapThreshold = 16, monitorIndex) {
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

    if (Math.abs(geometry.x - wa.x) <= snapThreshold) {
      newX = wa.x;
      snappedEdges.left = true;
    }
    const rightDiff = Math.abs((wa.x + wa.width) - (geometry.x + geometry.width));
    if (rightDiff <= snapThreshold) {
      newX = wa.x + wa.width - geometry.width;
      snappedEdges.right = true;
    }

    if (Math.abs(geometry.y - wa.y) <= snapThreshold) {
      newY = wa.y;
      snappedEdges.top = true;
    }
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

  logicalToPhysical(dips, dpi) {
    return Math.round(dips * (dpi / 96));
  }

  physicalToLogical(pixels, dpi) {
    return Math.round(pixels / (dpi / 96));
  }
}
