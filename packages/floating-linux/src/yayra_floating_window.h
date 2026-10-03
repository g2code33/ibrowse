#ifndef YAYRA_FLOATING_WINDOW_H
#define YAYRA_FLOATING_WINDOW_H

#include <gtk/gtk.h>
#include <gdk/gdk.h>

#ifdef GDK_WINDOWING_X11
#include <gdk/gdkx.h>
#endif

#ifdef GDK_WINDOWING_WAYLAND
#include <gdk/gdkwayland.h>
#endif

G_BEGIN_DECLS

typedef enum {
    YAYRA_DESKTOP_MODE_CIRCLE_FIRST,
    YAYRA_DESKTOP_MODE_BROWSER_FIRST
} YayraDesktopMode;

typedef struct {
    GtkWidget *bubble_window;
    GtkWidget *browser_window;
    YayraDesktopMode mode;
    gboolean always_on_top;
    gboolean minimize_to_bubble;
    gboolean close_to_tray;
    gboolean is_wayland;
    gboolean supports_global_position;
} YayraFloatingHost;

YayraFloatingHost *yayra_floating_host_new(YayraDesktopMode mode);
void yayra_floating_host_destroy(YayraFloatingHost *host);

GtkWidget *yayra_create_floating_bubble_window(YayraFloatingHost *host, gint width, gint height);
GtkWidget *yayra_create_floating_browser_window(YayraFloatingHost *host, gint width, gint height);

void yayra_floating_host_set_mode(YayraFloatingHost *host, YayraDesktopMode mode);
void yayra_floating_host_show_browser(YayraFloatingHost *host);
void yayra_floating_host_minimize_browser(YayraFloatingHost *host);
void yayra_floating_host_set_always_on_top(YayraFloatingHost *host, gboolean keep_above);
void yayra_floating_host_clamp_to_work_area(GtkWidget *window);

gboolean yayra_is_running_on_wayland(void);

G_END_DECLS

#endif /* YAYRA_FLOATING_WINDOW_H */
