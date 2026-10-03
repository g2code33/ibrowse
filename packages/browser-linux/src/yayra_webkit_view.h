#ifndef YAYRA_WEBKIT_VIEW_H
#define YAYRA_WEBKIT_VIEW_H

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

G_BEGIN_DECLS

#define YAYRA_TYPE_WEBKIT_VIEW (yayra_webkit_view_get_type())
G_DECLARE_FINAL_TYPE(YayraWebKitView, yayra_webkit_view, YAYRA, WEBKIT_VIEW, GtkBox)

typedef struct _YayraWebKitViewCallbacks {
    void (*on_title_changed)(YayraWebKitView *view, const gchar *title, gpointer user_data);
    void (*on_uri_changed)(YayraWebKitView *view, const gchar *uri, gpointer user_data);
    void (*on_progress_changed)(YayraWebKitView *view, gdouble progress, gpointer user_data);
    void (*on_load_finished)(YayraWebKitView *view, gpointer user_data);
    void (*on_load_error)(YayraWebKitView *view, gint code, const gchar *description, const gchar *failing_uri, gpointer user_data);
    void (*on_tls_error)(YayraWebKitView *view, const gchar *failing_uri, GTlsCertificate *certificate, GTlsCertificateFlags errors, gpointer user_data);
    void (*on_download_started)(YayraWebKitView *view, WebKitDownload *download, const gchar *suggested_filename, gpointer user_data);
} YayraWebKitViewCallbacks;

/**
 * Creates a new hardened Yayra WebKitGTK browser view.
 */
YayraWebKitView *yayra_webkit_view_new(gboolean is_incognito, const YayraWebKitViewCallbacks *callbacks, gpointer user_data);

void yayra_webkit_view_navigate(YayraWebKitView *self, const gchar *uri);
void yayra_webkit_view_go_back(YayraWebKitView *self);
void yayra_webkit_view_go_forward(YayraWebKitView *self);
gboolean yayra_webkit_view_can_go_back(YayraWebKitView *self);
gboolean yayra_webkit_view_can_go_forward(YayraWebKitView *self);
void yayra_webkit_view_reload(YayraWebKitView *self, gboolean ignore_cache);
void yayra_webkit_view_stop(YayraWebKitView *self);
void yayra_webkit_view_set_zoom(YayraWebKitView *self, gdouble zoom_level);
gdouble yayra_webkit_view_get_zoom(YayraWebKitView *self);
void yayra_webkit_view_set_user_agent(YayraWebKitView *self, const gchar *user_agent);
void yayra_webkit_view_destroy_clean(YayraWebKitView *self);

G_END_DECLS

#endif /* YAYRA_WEBKIT_VIEW_H */
