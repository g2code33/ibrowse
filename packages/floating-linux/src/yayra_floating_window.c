#include "yayra_floating_window.h"

gboolean yayra_is_running_on_wayland(void) {
    GdkDisplay *display = gdk_display_get_default();
    if (!display) return FALSE;
#ifdef GDK_WINDOWING_WAYLAND
    return GDK_IS_WAYLAND_DISPLAY(display);
#else
    return FALSE;
#endif
}

static gboolean on_bubble_button_press(GtkWidget *widget, GdkEventButton *event, gpointer user_data) {
    YayraFloatingHost *host = (YayraFloatingHost *)user_data;
    if (event->type == GDK_BUTTON_PRESS && event->button == GDK_BUTTON_PRIMARY) {
        // Begin interactive window drag
        gtk_window_begin_move_drag(
            GTK_WINDOW(widget),
            event->button,
            (gint)event->x_root,
            (gint)event->y_root,
            event->time
        );
        return TRUE;
    }
    return FALSE;
}

static gboolean on_bubble_button_release(GtkWidget *widget, GdkEventButton *event, gpointer user_data) {
    YayraFloatingHost *host = (YayraFloatingHost *)user_data;
    if (event->button == GDK_BUTTON_PRIMARY) {
        yayra_floating_host_show_browser(host);
        return TRUE;
    }
    return FALSE;
}

static gboolean on_draw_rgba_background(GtkWidget *widget, cairo_t *cr, gpointer user_data) {
    cairo_set_source_rgba(cr, 0.05, 0.09, 0.21, 0.88);
    cairo_set_operator(cr, CAIRO_OPERATOR_SOURCE);
    cairo_paint(cr);
    return FALSE;
}

GtkWidget *yayra_create_floating_bubble_window(YayraFloatingHost *host, gint width, gint height) {
    GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(window), "Yayra Bubble");
    gtk_window_set_decorated(GTK_WINDOW(window), FALSE);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(window), TRUE);
    gtk_window_set_skip_pager_hint(GTK_WINDOW(window), TRUE);
    gtk_window_set_keep_above(GTK_WINDOW(window), host->always_on_top);
    gtk_window_set_default_size(GTK_WINDOW(window), width, height);

    // Apply RGBA transparency visual
    GdkScreen *screen = gtk_widget_get_screen(window);
    GdkVisual *visual = gdk_screen_get_rgba_visual(screen);
    if (visual && gdk_screen_is_composited(screen)) {
        gtk_widget_set_visual(window, visual);
    }
    gtk_widget_set_app_paintable(window, TRUE);
    g_signal_connect(window, "draw", G_CALLBACK(on_draw_rgba_background), NULL);

    gtk_widget_add_events(window, GDK_BUTTON_PRESS_MASK | GDK_BUTTON_RELEASE_MASK | GDK_POINTER_MOTION_MASK);
    g_signal_connect(window, "button-press-event", G_CALLBACK(on_bubble_button_press), host);
    g_signal_connect(window, "button-release-event", G_CALLBACK(on_bubble_button_release), host);

    return window;
}

GtkWidget *yayra_create_floating_browser_window(YayraFloatingHost *host, gint width, gint height) {
    GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(window), "Yayra Floating Browser");
    gtk_window_set_decorated(GTK_WINDOW(window), FALSE);
    gtk_window_set_skip_taskbar_hint(GTK_WINDOW(window), FALSE);
    gtk_window_set_keep_above(GTK_WINDOW(window), host->always_on_top);
    gtk_window_set_resizable(GTK_WINDOW(window), TRUE);
    gtk_window_set_default_size(GTK_WINDOW(window), width, height);

    // RGBA visual
    GdkScreen *screen = gtk_widget_get_screen(window);
    GdkVisual *visual = gdk_screen_get_rgba_visual(screen);
    if (visual && gdk_screen_is_composited(screen)) {
        gtk_widget_set_visual(window, visual);
    }
    gtk_widget_set_app_paintable(window, TRUE);
    g_signal_connect(window, "draw", G_CALLBACK(on_draw_rgba_background), NULL);

    return window;
}

YayraFloatingHost *yayra_floating_host_new(YayraDesktopMode mode) {
    YayraFloatingHost *host = g_new0(YayraFloatingHost, 1);
    host->mode = mode;
    host->always_on_top = TRUE;
    host->minimize_to_bubble = TRUE;
    host->close_to_tray = TRUE;
    host->is_wayland = yayra_is_running_on_wayland();
    host->supports_global_position = !host->is_wayland;

    host->bubble_window = yayra_create_floating_bubble_window(host, 56, 56);
    host->browser_window = yayra_create_floating_browser_window(host, 800, 600);

    yayra_floating_host_set_mode(host, mode);
    return host;
}

void yayra_floating_host_destroy(YayraFloatingHost *host) {
    if (!host) return;

    if (host->browser_window) {
        gtk_widget_destroy(host->browser_window);
        host->browser_window = NULL;
    }

    if (host->bubble_window) {
        gtk_widget_destroy(host->bubble_window);
        host->bubble_window = NULL;
    }

    g_free(host);
}

void yayra_floating_host_set_mode(YayraFloatingHost *host, YayraDesktopMode mode) {
    if (!host) return;
    host->mode = mode;

    if (mode == YAYRA_DESKTOP_MODE_CIRCLE_FIRST) {
        if (host->bubble_window) gtk_widget_show_all(host->bubble_window);
        if (host->browser_window) gtk_widget_hide(host->browser_window);
    } else {
        if (host->bubble_window) gtk_widget_hide(host->bubble_window);
        if (host->browser_window) gtk_widget_show_all(host->browser_window);
    }
}

void yayra_floating_host_show_browser(YayraFloatingHost *host) {
    if (!host) return;
    if (host->browser_window) {
        gtk_widget_show_all(host->browser_window);
        gtk_window_present(GTK_WINDOW(host->browser_window));
    }
    if (host->mode == YAYRA_DESKTOP_MODE_BROWSER_FIRST && host->bubble_window) {
        gtk_widget_hide(host->bubble_window);
    }
}

void yayra_floating_host_minimize_browser(YayraFloatingHost *host) {
    if (!host) return;
    if (host->browser_window) {
        gtk_widget_hide(host->browser_window);
    }
    if (host->minimize_to_bubble && host->bubble_window) {
        gtk_widget_show_all(host->bubble_window);
    }
}

void yayra_floating_host_set_always_on_top(YayraFloatingHost *host, gboolean keep_above) {
    if (!host) return;
    host->always_on_top = keep_above;
    if (host->bubble_window) {
        gtk_window_set_keep_above(GTK_WINDOW(host->bubble_window), keep_above);
    }
    if (host->browser_window) {
        gtk_window_set_keep_above(GTK_WINDOW(host->browser_window), keep_above);
    }
}

void yayra_floating_host_clamp_to_work_area(GtkWidget *window) {
    if (!window || yayra_is_running_on_wayland()) return;

    GdkWindow *gdk_win = gtk_widget_get_window(window);
    if (!gdk_win) return;

    GdkDisplay *display = gtk_widget_get_display(window);
    GdkMonitor *monitor = gdk_display_get_monitor_at_window(display, gdk_win);
    if (!monitor) return;

    GdkRectangle workarea;
    gdk_monitor_get_workarea(monitor, &workarea);

    gint x, y, width, height;
    gtk_window_get_position(GTK_WINDOW(window), &x, &y);
    gtk_window_get_size(GTK_WINDOW(window), &width, &height);

    gint clamped_x = MAX(workarea.x, MIN(workarea.x + workarea.width - width, x));
    gint clamped_y = MAX(workarea.y, MIN(workarea.y + workarea.height - height, y));

    if (clamped_x != x || clamped_y != y) {
        gtk_window_move(GTK_WINDOW(window), clamped_x, clamped_y);
    }
}
