#include "yayra_webkit_runtime_detector.h"
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

YayraWebKitRuntimeInfo yayra_detect_webkit_runtime(void) {
    YayraWebKitRuntimeInfo info;
    memset(&info, 0, sizeof(YayraWebKitRuntimeInfo));

    info.installation_command = "sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0 libsoup-3.0-0";
    info.debian_packages = "libwebkit2gtk-4.1-0, libgtk-3-0, libsoup-3.0-0";

    // 1. Probe WebKitGTK 4.1 (GTK3 / libsoup-3.0 - Default Debian 11/12 & Ubuntu 22.04+)
    void *handle_4_1 = dlopen("libwebkit2gtk-4.1.so.0", RTLD_LAZY | RTLD_LOCAL);
    if (handle_4_1) {
        void *gtk3_handle = dlopen("libgtk-3.so.0", RTLD_LAZY | RTLD_LOCAL);
        if (gtk3_handle) {
            info.is_available = true;
            info.flavor = YAYRA_WEBKIT_FLAVOR_GTK3_WEBKIT2_4_1;
            info.flavor_name = "WebKitGTK 4.1 (GTK 3 + libsoup 3.0)";
            info.library_soname = "libwebkit2gtk-4.1.so.0";
            info.gtk_soname = "libgtk-3.so.0";
            info.installed_version = "4.1";
            dlclose(gtk3_handle);
            dlclose(handle_4_1);
            return info;
        }
        dlclose(handle_4_1);
    }

    // 2. Probe WebKitGTK 6.0 (GTK4 / libsoup-3.0 - Modern Debian 12 & Ubuntu 24.04+)
    void *handle_6_0 = dlopen("libwebkitgtk-6.0.so.4", RTLD_LAZY | RTLD_LOCAL);
    if (handle_6_0) {
        void *gtk4_handle = dlopen("libgtk-4.so.1", RTLD_LAZY | RTLD_LOCAL);
        if (gtk4_handle) {
            info.is_available = true;
            info.flavor = YAYRA_WEBKIT_FLAVOR_GTK4_WEBKIT_6_0;
            info.flavor_name = "WebKitGTK 6.0 (GTK 4 + libsoup 3.0)";
            info.library_soname = "libwebkitgtk-6.0.so.4";
            info.gtk_soname = "libgtk-4.so.1";
            info.installed_version = "6.0";
            dlclose(gtk4_handle);
            dlclose(handle_6_0);
            return info;
        }
        dlclose(handle_6_0);
    }

    // 3. Probe legacy WebKitGTK 4.0 (GTK3 / libsoup-2.4 - Ubuntu 20.04 legacy)
    void *handle_4_0 = dlopen("libwebkit2gtk-4.0.so.37", RTLD_LAZY | RTLD_LOCAL);
    if (handle_4_0) {
        info.is_available = true;
        info.flavor = YAYRA_WEBKIT_FLAVOR_LEGACY_WEBKIT2_4_0;
        info.flavor_name = "WebKitGTK 4.0 Legacy (GTK 3 + libsoup 2.4)";
        info.library_soname = "libwebkit2gtk-4.0.so.37";
        info.gtk_soname = "libgtk-3.so.0";
        info.installed_version = "4.0";
        dlclose(handle_4_0);
        return info;
    }

    info.is_available = false;
    info.flavor = YAYRA_WEBKIT_FLAVOR_NONE;
    info.flavor_name = "Not Installed";
    return info;
}

bool yayra_is_wayland_session(void) {
    const char *wayland_display = getenv("WAYLAND_DISPLAY");
    if (wayland_display && strlen(wayland_display) > 0) {
        return true;
    }
    const char *xdg_session_type = getenv("XDG_SESSION_TYPE");
    if (xdg_session_type && strcmp(xdg_session_type, "wayland") == 0) {
        return true;
    }
    return false;
}
