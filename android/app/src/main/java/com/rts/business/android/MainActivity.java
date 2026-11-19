package com.rts.business.android;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintManager;
import android.provider.Settings;
import android.app.DownloadManager;
import android.database.Cursor;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.JavaScriptReplyProxy;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.regex.Pattern;
import java.util.Collections;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://rts-royal.pages.dev";
    private static final Pattern APK_URL = Pattern.compile(
            "^https://rts-royal\\.pages\\.dev/download/rts-business-android/?$");
    private WebView web;
    private boolean firebaseReady;
    private long updateDownloadId = -1L;
    private boolean updateReceiverRegistered;
    private final BroadcastReceiver updateReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())
                    || intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) != updateDownloadId) return;
            DownloadManager manager = getSystemService(DownloadManager.class);
            DownloadManager.Query query = new DownloadManager.Query().setFilterById(updateDownloadId);
            try (Cursor cursor = manager.query(query)) {
                if (cursor == null || !cursor.moveToFirst()
                        || cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                        != DownloadManager.STATUS_SUCCESSFUL) {
                    notifyWeb("{\"type\":\"update-failed\"}");
                    return;
                }
                Uri apk = manager.getUriForDownloadedFile(updateDownloadId);
                if (apk == null) {
                    notifyWeb("{\"type\":\"update-failed\"}");
                    return;
                }
                Intent install = new Intent(Intent.ACTION_VIEW, apk);
                install.setDataAndType(apk, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(install);
            } catch (Exception error) {
                notifyWeb("{\"type\":\"update-failed\"}");
            }
        }
    };

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
                        } else if (command.startsWith("update:")) {
                            handleUpdate(command.substring("update:".length()), reply);
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

    private void handleUpdate(String payload, JavaScriptReplyProxy reply) {
        try {
            JSONObject update = new JSONObject(payload);
            String url = update.optString("apkUrl", "");
            int versionCode = update.optInt("versionCode", 0);
            if (!APK_URL.matcher(url).matches() || versionCode <= currentVersionCode()) {
                reply.postMessage("{\"type\":\"update-unavailable\"}");
                return;
            }
            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                startActivity(settings);
                reply.postMessage("{\"type\":\"update-permission-required\"}");
                return;
            }
            DownloadManager manager = getSystemService(DownloadManager.class);
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle("تحديث RTS Business")
                    .setDescription("جارٍ تنزيل تحديث التطبيق")
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "RTS-Business.apk");
            updateDownloadId = manager.enqueue(request);
            reply.postMessage("{\"type\":\"update-started\"}");
        } catch (Exception error) {
            reply.postMessage("{\"type\":\"update-failed\"}");
        }
    }

    private int currentVersionCode() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? (int) info.getLongVersionCode() : info.versionCode;
        } catch (Exception error) {
            return Integer.MAX_VALUE;
        }
    }

    private void notifyWeb(String message) {
        if (web != null) web.post(() -> {
            if (web.getUrl() != null && web.getUrl().startsWith(ORIGIN)) {
                web.evaluateJavascript("window.RTSNative?.onmessage?.({data:" + JSONObject.quote(message) + "})", null);
            }
        });
    }

    @Override public void onStart() {
        super.onStart();
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(updateReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                    Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(updateReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
        }
        updateReceiverRegistered = true;
    }

    @Override public void onStop() {
        if (updateReceiverRegistered) {
            unregisterReceiver(updateReceiver);
            updateReceiverRegistered = false;
        }
        super.onStop();
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
