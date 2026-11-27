# Android build, push notifications and background location

The app is configured for **EAS Build** (Expo's cloud build service), so you don't need Android Studio, the Android SDK or Java on your PC. Everything below runs from `apps/mobile`.

Already done in the repo: build profiles (`eas.json`), permissions and background location (`app.json`), Maps and Firebase keys read from environment variables (`app.config.ts`), push channels and token registration (`src/push.ts`), the background location task (`src/backgroundLocation.ts`). `npx expo-doctor` passes all checks, and `expo prebuild` generates a valid Android project with the background-location, foreground-service and notification permissions.

## 1. The three commands (first install on a phone)

```bash
npx eas-cli@latest login
```
Sign in to (or create) your free Expo account.

```bash
npx eas-cli@latest init
```
Creates the project on Expo and writes its `projectId` into `app.json`. Commit that change.

```bash
npx eas-cli@latest build --profile development --platform android
```
Takes ~10–15 min in the cloud. When it finishes, open the link or scan the QR code on your Android phone to install the APK.

Then run the JS on your PC and open the app on the phone:

1. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to your PC's Wi-Fi IP (`ipconfig` → IPv4 Address), e.g. `http://192.168.1.10:4100/v1`.
2. Start the API (`cd ../api && npm run dev`), then `npx expo start --dev-client`.
3. Phone and PC on the same Wi-Fi; allow Node through Windows Firewall (ports 4100 and 8081) when asked.

That first build works without any Google keys, but the map is blank and push notifications won't arrive. Add the keys below, then build again.

## 2. Google Maps key (map on Android)

1. Google Cloud Console → enable **Maps SDK for Android** → create an API key.
2. Restrict it to Android apps: package `app.onspot.mobile` plus the SHA-1 shown by `npx eas-cli@latest credentials` (Android → development keystore).
3. Store it on EAS (not in the repo):

```bash
npx eas-cli@latest env:create --name GOOGLE_MAPS_ANDROID_API_KEY --value YOUR_KEY --environment development --environment preview --environment production --visibility sensitive
```

## 3. Push notifications (Firebase Cloud Messaging)

1. [Firebase console](https://console.firebase.google.com) → create a project → **Add app → Android**, package `app.onspot.mobile` → download `google-services.json` into `apps/mobile/` (it's git-ignored).
2. Give the file to EAS builds:

```bash
npx eas-cli@latest env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment development --environment preview --environment production --visibility sensitive
```

3. Let Expo's push service send through FCM: Firebase → Project settings → Service accounts → **Generate new private key**, then `npx eas-cli@latest credentials` → Android → **Push Notifications: FCM V1** → upload that JSON.
4. Rebuild (`build --profile development`) and reinstall.

## 4. What to test on the phone

| Check | How |
|---|---|
| Push: offer with the app closed | Partner signed in on the phone, go online, close the app. Create a request from the customer web app → "New … request" notification within seconds; tapping it opens the offer. |
| Push: customer updates | Customer on the phone; partner accepts/arrives from the web → "… is on the way", "Your pro has arrived". |
| Background location | Partner online → Android shows a persistent "You're online on OnSpot" notification. Lock the phone and walk/drive: the partner's dot keeps moving on the ops console map. Go offline → notification disappears and updates stop. |
| Battery mode switch | Accept a job → notification changes to "On a job · sharing your location" (high accuracy); finish → back to idle mode. |
| Permission disclosure | First time online: the in-app explanation appears before Android's "Allow all the time" prompt (Google Play requires this). Choosing "Only while using" still works, with jobs only while the app is open. |

## 5. Builds for testers and the Play Store

```bash
npx eas-cli@latest build --profile preview --platform android
```
Installable APK with the JS bundled in, for testers (set `EXPO_PUBLIC_API_URL` as an EAS environment variable for `preview`, pointing at a deployed **https** API).

```bash
npx eas-cli@latest build --profile production --platform android
```
Play Store app bundle (needs the deployed API, privacy policy and the Play "background location" declaration form, with a short video of the disclosure above).
