# RTS Business Android (in development)

The Android shell opens the hosted RTS Business mobile workspace. Restaurant
catalog, supplies, tables, shared orders, quotes, checkout, receipts, and
administrator setup flows are available through the hosted surface. Full
renderer parity is still tracked separately for loyalty, returns, advanced
financial workflows, and shop-specific management; do not describe this APK as
feature-complete until those gates and real-device validation pass.

The shell opens only `https://rts-royal.pages.dev/business-mobile/`. Web changes
deploy independently; native capabilities require a new signed APK. JavaScript
messages use AndroidX WebKit's origin- and main-frame-checked listener. The
printer bridge opens Android's system print flow; thermal printers and cash
drawers are not supported. The app can check the hosted version manifest and
download a newer signed APK through Android's package installer.

The Android build uses Java 17, Android SDK 35 and Gradle 8.10.2. The
`Android build` GitHub workflow builds a debug APK; a manually dispatched
release requires the repository's dedicated `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`
secrets. It verifies the release signing certificate before uploading an
artifact. It does not publish an APK.

The Firebase client identifiers are public build configuration. The backend
uses a separate server-only FCM service account. Push needs Android notification
permission, a registered device, the deployed server migration and dispatcher,
and network/Google Play services. Delivery can be delayed by Android or network
policy; a force-stopped app cannot be relied on to receive notifications. A
registration expires after 30 days and is revalidated against account status,
role/password version and licence on each send. Unregistering at logout requires
connectivity.
