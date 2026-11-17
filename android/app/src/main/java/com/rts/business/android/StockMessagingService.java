package com.rts.business.android;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class StockMessagingService extends FirebaseMessagingService {
    static final String CHANNEL = "low_stock";

    @Override public void onMessageReceived(RemoteMessage message) {
        if (!"low-stock".equals(message.getData().get("type"))) return;
        Notification notification = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_more)
                .setContentTitle("RTS Business")
                .setContentText("يوجد تنبيه مخزون. افتح التطبيق للمراجعة.")
                .setContentIntent(PendingIntent.getActivity(this, 0,
                        new Intent(this, MainActivity.class),
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .setAutoCancel(true)
                .build();
        getSystemService(NotificationManager.class).notify(1001, notification);
    }
}
