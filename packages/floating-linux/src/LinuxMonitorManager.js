/**
 * Yayra Floating Browser - Linux Monitor & GDK Display Manager
 */

export class LinuxMonitorManager {
  constructor(initialMonitors) {
    if (initialMonitors && initialMonitors.length > 0) {
      this.monitors = initialMonitors;
    } else {
      this.monitors = [
        {
          index: 0,
          name: 'eDP-1',
          geometry: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 28, width: 1920, height: 1052 },
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
      const g = monitor.geometry;
      if (
        centerX >= g.x &&
        centerX < g.x + g.width &&
        centerY >= g.y &&
        centerY < g.y + g.height
      ) {
        return monitor;
      }
    }
    return this.getPrimaryMonitor();
  }

  clampToMonitorWorkArea(geometry, monitorIndex, minWidth = 280, minHeight = 240) {
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
}
