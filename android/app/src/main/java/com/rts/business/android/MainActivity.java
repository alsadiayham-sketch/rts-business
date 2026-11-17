package com.rts.business.android;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.Collections;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://rts-royal.pages.dev";
    private WebView web;
    private boolean firebaseReady;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(
                StockMessagingService.CHANNEL, "تنبيهات المخزون", NotificationManager.IMPORTANCE_DEFAULT));
        firebaseReady = !FirebaseApp.getApps(this).isEmpty();
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"https".equals(uri.getScheme()) || !"rts-royal.pages.dev".equals(uri.getHost())
                        || (uri.getPort() != -1 && uri.getPort() != 443)
                        || !("/business-mobile/".equals(uri.getPath())
                            || "/business-mobile/index.html".equals(uri.getPath()));
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "RTSNative", Collections.singleton(ORIGIN),
                    (view, message, source, mainFrame, reply) -> {
                        if (!mainFrame || !ORIGIN.equals(source.toString())) return;
                        String command = message.getData();
                        if ("print".equals(command)) {
                            PrintManager manager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                            manager.print("RTS Business", web.createPrintDocumentAdapter("RTS Business"), null);
                        } else if ("notifications".equals(command)) {
                            if (!firebaseReady) {
                                reply.postMessage("{\"type\":\"notifications-unavailable\"}");
                                return;
                            }
                            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                                    != PackageManager.PERMISSION_GRANTED) {
                                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 100);
                                reply.postMessage("{\"type\":\"permission-requested\"}");
                                return;
                            }
                            NotificationManager current = getSystemService(NotificationManager.class);
                            NotificationChannel channel = current.getNotificationChannel(StockMessagingService.CHANNEL);
                            if (!current.areNotificationsEnabled() || (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE)) {
                                reply.postMessage("{\"type\":\"notifications-disabled\"}");
                                return;
                            }
                            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(result -> {
                                try {
                                    JSONObject response = new JSONObject();
                                    response.put("type", result.isSuccessful() ? "notification-token" : "notifications-unavailable");
                                    if (result.isSuccessful()) response.put("token", result.getResult());
                                    reply.postMessage(response.toString());
                                } catch (Exception ignored) {
                                    reply.postMessage("{\"type\":\"notifications-unavailable\"}");
                                }
                            });
                        }
                    });
        }
        setContentView(web);
        web.loadUrl(ORIGIN + "/business-mobile/");
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
