#include "yayra_webkit_view.h"
#include <string.h>
#include <glib/gstdio.h>

struct _YayraWebKitView {
    GtkBox parent_instance;
    WebKitWebView *web_view;
    WebKitWebContext *web_context;
    WebKitSettings *settings;
    YayraWebKitViewCallbacks callbacks;
    gpointer user_data;
    gboolean is_incognito;
    gulong title_sig;
    gulong uri_sig;
    gulong progress_sig;
    gulong load_changed_sig;
    gulong load_failed_sig;
    gulong tls_error_sig;
    gulong decide_policy_sig;
    gulong permission_sig;
};

G_DEFINE_TYPE(YayraWebKitView, yayra_webkit_view, GTK_TYPE_BOX)

static void yayra_webkit_view_dispose(GObject *object);

static void yayra_webkit_view_class_init(YayraWebKitViewClass *klass) {
    GObjectClass *gobject_class = G_OBJECT_CLASS(klass);
    gobject_class->dispose = yayra_webkit_view_dispose;
}

static void yayra_webkit_view_init(YayraWebKitView *self) {
    gtk_orientable_set_orientation(GTK_ORIENTABLE(self), GTK_ORIENTATION_VERTICAL);
}

/* Signal Handlers */
static void on_notify_title(WebKitWebView *web_view, GParamSpec *pspec, gpointer user_data) {
    YayraWebKitView *self = YAYRA_WEBKIT_VIEW(user_data);
    const gchar *title = webkit_web_view_get_title(web_view);
    if (self->callbacks.on_title_changed) {
        self->callbacks.on_title_changed(self, title ? title : "", self->user_data);
    }
}

static void on_notify_uri(WebKitWebView *web_view, GParamSpec *pspec, gpointer user_data) {
    YayraWebKitView *self = YAYRA_WEBKIT_VIEW(user_data);
    const gchar *uri = webkit_web_view_get_uri(web_view);
    if (self->callbacks.on_uri_changed) {
        self->callbacks.on_uri_changed(self, uri ? uri : "about:blank", self->user_data);
    }
}

static void on_notify_progress(WebKitWebView *web_view, GParamSpec *pspec, gpointer user_data) {
    YayraWebKitView *self = YAYRA_WEBKIT_VIEW(user_data);
    gdouble progress = webkit_web_view_get_estimated_load_progress(web_view);
    if (self->callbacks.on_progress_changed) {
        self->callbacks.on_progress_changed(self, progress, self->user_data);
    }
}

static void on_load_changed(WebKitWebView *web_view, WebKitLoadEvent load_event, gpointer user_data) {
    YayraWebKitView *self = YAYRA_WEBKIT_VIEW(user_data);
    if (load_event == WEBKIT_LOAD_FINISHED) {
        if (self->callbacks.on_load_finished) {
            self->callbacks.on_load_finished(self, self->user_data);
        }
    }
}

static gboolean on_load_failed(WebKitWebView *web_view, WebKitLoadEvent load_event, const gchar *failing_uri, GError *error, gpointer user_data) {
    YayraWebKitView *self = YAYRA_WEBKIT_VIEW(user_data);
    if (self->callbacks.on_load_error && error) {
        self->callbacks.on_load_error(self, error->code, error->message, failing_uri, self->user_data);
    }
    return FALSE; // Let default error page render or handle upstream
}

/* Strict TLS Verification: Load Failed With TLS Errors */
static gboolean on_load_failed_with_tls_errors(WebKitWebView *web_view, const gchar *failing_uri, GTlsCertificate *certificate, GTlsCertificateFlags errors, gpointer user_data) {
    YayraWebKitView *self = YAYRA_WEBKIT_VIEW(user_data);
    if (self->callbacks.on_tls_error) {
        self->callbacks.on_tls_error(self, failing_uri, certificate, errors, self->user_data);
    }
    // Return TRUE to stop loading immediately. Never bypass TLS error!
    return TRUE;
}

/* Policy Decision Mediation (Scheme allowlists and download triggers) */
static gboolean on_decide_policy(WebKitWebView *web_view, WebKitPolicyDecision *decision, WebKitPolicyDecisionType decision_type, gpointer user_data) {
    YayraWebKitView *self = YAYRA_WEBKIT_VIEW(user_data);

    if (decision_type == WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION) {
        WebKitNavigationPolicyDecision *nav_decision = WEBKIT_NAVIGATION_POLICY_DECISION(decision);
        WebKitNavigationAction *action = webkit_navigation_policy_decision_get_navigation_action(nav_decision);
        WebKitURIRequest *request = webkit_navigation_action_get_request(action);
        const gchar *uri = webkit_uri_request_get_uri(request);

        if (!uri) {
            webkit_policy_decision_ignore(decision);
            return TRUE;
        }

        // Block dangerous schemes
        if (g_str_has_prefix(uri, "javascript:") ||
            g_str_has_prefix(uri, "vbscript:") ||
            g_str_has_prefix(uri, "data:text/html") ||
            g_str_has_prefix(uri, "file://")) {
            webkit_policy_decision_ignore(decision);
            return TRUE;
        }

        // Allow HTTP, HTTPS, and internal about: pages
        if (g_str_has_prefix(uri, "https://") ||
            g_str_has_prefix(uri, "http://") ||
            g_str_has_prefix(uri, "about:")) {
            webkit_policy_decision_use(decision);
            return TRUE;
        }

        // Hand off safe external protocols (mailto, tel) to desktop handler
        if (g_str_has_prefix(uri, "mailto:") ||
            g_str_has_prefix(uri, "tel:") ||
            g_str_has_prefix(uri, "geo:")) {
            g_app_info_launch_default_for_uri(uri, NULL, NULL);
            webkit_policy_decision_ignore(decision);
            return TRUE;
        }

        webkit_policy_decision_ignore(decision);
        return TRUE;
    } else if (decision_type == WEBKIT_POLICY_DECISION_TYPE_RESPONSE) {
        WebKitResponsePolicyDecision *res_decision = WEBKIT_RESPONSE_POLICY_DECISION(decision);
        if (!webkit_response_policy_decision_is_mime_type_supported(res_decision)) {
            webkit_policy_decision_download(decision);
            return TRUE;
        }
    }

    return FALSE;
}

/* Explicit Permission Requests */
static gboolean on_permission_request(WebKitWebView *web_view, WebKitPermissionRequest *request, gpointer user_data) {
    // Explicit consent model: Deny by default unless user allows via native dialog
    webkit_permission_request_deny(request);
    return TRUE;
}

YayraWebKitView *yayra_webkit_view_new(gboolean is_incognito, const YayraWebKitViewCallbacks *callbacks, gpointer user_data) {
    YayraWebKitView *self = g_object_new(YAYRA_TYPE_WEBKIT_VIEW, NULL);
    self->is_incognito = is_incognito;
    if (callbacks) {
        self->callbacks = *callbacks;
    }
    self->user_data = user_data;

    // Configure WebContext & WebsiteDataManager
    if (is_incognito) {
        WebKitWebsiteDataManager *data_manager = webkit_website_data_manager_new_ephemeral();
        self->web_context = webkit_web_context_new_with_website_data_manager(data_manager);
        g_object_unref(data_manager);
    } else {
        self->web_context = webkit_web_context_get_default();
        g_object_ref(self->web_context);
    }

    // Configure Hardened Settings
    self->settings = webkit_settings_new();
    webkit_settings_set_enable_developer_extras(self->settings, FALSE);
    webkit_settings_set_enable_file_access_from_file_uris(self->settings, FALSE);
    webkit_settings_set_enable_universal_access_from_file_uris(self->settings, FALSE);
    webkit_settings_set_allow_file_access_from_file_urls(self->settings, FALSE);
    webkit_settings_set_enable_smooth_scrolling(self->settings, TRUE);
    webkit_settings_set_hardware_acceleration_policy(self->settings, WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS);
    webkit_settings_set_enable_encrypted_media(self->settings, TRUE);
    webkit_settings_set_enable_mediasource(self->settings, TRUE);

    // Create WebKitWebView
    self->web_view = WEBKIT_WEB_VIEW(g_object_new(
        WEBKIT_TYPE_WEB_VIEW,
        "web-context", self->web_context,
        "settings", self->settings,
        NULL
    ));

    // Connect Signals
    self->title_sig = g_signal_connect(self->web_view, "notify::title", G_CALLBACK(on_notify_title), self);
    self->uri_sig = g_signal_connect(self->web_view, "notify::uri", G_CALLBACK(on_notify_uri), self);
    self->progress_sig = g_signal_connect(self->web_view, "notify::estimated-load-progress", G_CALLBACK(on_notify_progress), self);
    self->load_changed_sig = g_signal_connect(self->web_view, "load-changed", G_CALLBACK(on_load_changed), self);
    self->load_failed_sig = g_signal_connect(self->web_view, "load-failed", G_CALLBACK(on_load_failed), self);
    self->tls_error_sig = g_signal_connect(self->web_view, "load-failed-with-tls-errors", G_CALLBACK(on_load_failed_with_tls_errors), self);
    self->decide_policy_sig = g_signal_connect(self->web_view, "decide-policy", G_CALLBACK(on_decide_policy), self);
    self->permission_sig = g_signal_connect(self->web_view, "permission-request", G_CALLBACK(on_permission_request), self);

    gtk_container_add(GTK_CONTAINER(self), GTK_WIDGET(self->web_view));
    gtk_widget_show(GTK_WIDGET(self->web_view));

    return self;
}

void yayra_webkit_view_navigate(YayraWebKitView *self, const gchar *uri) {
    if (!self || !self->web_view || !uri) return;
    webkit_web_view_load_uri(self->web_view, uri);
}

void yayra_webkit_view_go_back(YayraWebKitView *self) {
    if (!self || !self->web_view) return;
    if (webkit_web_view_can_go_back(self->web_view)) {
        webkit_web_view_go_back(self->web_view);
    }
}

void yayra_webkit_view_go_forward(YayraWebKitView *self) {
    if (!self || !self->web_view) return;
    if (webkit_web_view_can_go_forward(self->web_view)) {
        webkit_web_view_go_forward(self->web_view);
    }
}

gboolean yayra_webkit_view_can_go_back(YayraWebKitView *self) {
    if (!self || !self->web_view) return FALSE;
    return webkit_web_view_can_go_back(self->web_view);
}

gboolean yayra_webkit_view_can_go_forward(YayraWebKitView *self) {
    if (!self || !self->web_view) return FALSE;
    return webkit_web_view_can_go_forward(self->web_view);
}

void yayra_webkit_view_reload(YayraWebKitView *self, gboolean ignore_cache) {
    if (!self || !self->web_view) return;
    if (ignore_cache) {
        webkit_web_view_reload_bypass_cache(self->web_view);
    } else {
        webkit_web_view_reload(self->web_view);
    }
}

void yayra_webkit_view_stop(YayraWebKitView *self) {
    if (!self || !self->web_view) return;
    webkit_web_view_stop_loading(self->web_view);
}

void yayra_webkit_view_set_zoom(YayraWebKitView *self, gdouble zoom_level) {
    if (!self || !self->web_view) return;
    webkit_web_view_set_zoom_level(self->web_view, zoom_level);
}

gdouble yayra_webkit_view_get_zoom(YayraWebKitView *self) {
    if (!self || !self->web_view) return 1.0;
    return webkit_web_view_get_zoom_level(self->web_view);
}

void yayra_webkit_view_set_user_agent(YayraWebKitView *self, const gchar *user_agent) {
    if (!self || !self->settings) return;
    webkit_settings_set_user_agent(self->settings, user_agent);
}

void yayra_webkit_view_destroy_clean(YayraWebKitView *self) {
    if (!self) return;
    if (self->web_view) {
        webkit_web_view_stop_loading(self->web_view);
        if (self->title_sig) g_signal_handler_disconnect(self->web_view, self->title_sig);
        if (self->uri_sig) g_signal_handler_disconnect(self->web_view, self->uri_sig);
        if (self->progress_sig) g_signal_handler_disconnect(self->web_view, self->progress_sig);
        if (self->load_changed_sig) g_signal_handler_disconnect(self->web_view, self->load_changed_sig);
        if (self->load_failed_sig) g_signal_handler_disconnect(self->web_view, self->load_failed_sig);
        if (self->tls_error_sig) g_signal_handler_disconnect(self->web_view, self->tls_error_sig);
        if (self->decide_policy_sig) g_signal_handler_disconnect(self->web_view, self->decide_policy_sig);
        if (self->permission_sig) g_signal_handler_disconnect(self->web_view, self->permission_sig);

        gtk_widget_destroy(GTK_WIDGET(self->web_view));
        self->web_view = NULL;
    }
    if (self->settings) {
        g_object_unref(self->settings);
        self->settings = NULL;
    }
    if (self->web_context) {
        g_object_unref(self->web_context);
        self->web_context = NULL;
    }
}

static void yayra_webkit_view_dispose(GObject *object) {
    YayraWebKitView *self = YAYRA_WEBKIT_VIEW(object);
    yayra_webkit_view_destroy_clean(self);
    G_OBJECT_CLASS(yayra_webkit_view_parent_class)->dispose(object);
}
