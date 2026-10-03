#ifndef YAYRA_WEBKIT_RUNTIME_DETECTOR_H
#define YAYRA_WEBKIT_RUNTIME_DETECTOR_H

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    YAYRA_WEBKIT_FLAVOR_NONE = 0,
    YAYRA_WEBKIT_FLAVOR_GTK3_WEBKIT2_4_1 = 1,
    YAYRA_WEBKIT_FLAVOR_GTK4_WEBKIT_6_0 = 2,
    YAYRA_WEBKIT_FLAVOR_LEGACY_WEBKIT2_4_0 = 3
} YayraWebKitFlavor;

typedef struct {
    bool is_available;
    YayraWebKitFlavor flavor;
    const char *flavor_name;
    const char *library_soname;
    const char *gtk_soname;
    const char *installed_version;
    const char *installation_command;
    const char *debian_packages;
} YayraWebKitRuntimeInfo;

/**
 * Detects system WebKitGTK and GTK shared libraries via dlopen probing
 * and system library search paths.
 */
YayraWebKitRuntimeInfo yayra_detect_webkit_runtime(void);

/**
 * Checks if the current display session is running under native Wayland or X11.
 */
bool yayra_is_wayland_session(void);

#ifdef __cplusplus
}
#endif

#endif /* YAYRA_WEBKIT_RUNTIME_DETECTOR_H */
