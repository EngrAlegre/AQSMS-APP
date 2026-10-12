#!/usr/bin/env node
/**
 * Points the Android release build at the real AQSMS keystore.
 *
 * `expo prebuild` regenerates android/ from the Expo template, and that
 * template signs *release* builds with the throwaway debug keystore. Run this
 * script after every prebuild (the build commands in BUILD_ANDROID.md do it for
 * you) so release APKs are signed with the project key instead.
 *
 * Credentials live in frontend/credentials/, outside the generated android/
 * directory, so a prebuild cannot delete them. If that directory is missing the
 * build still works and silently falls back to debug signing, so this script
 * fails loudly instead of letting that happen unnoticed.
 *
 * Idempotent: running it twice is a no-op.
 */
const fs = require("fs");
const path = require("path");

const MARKER = "AQSMS release signing";
const gradleFile = path.join(__dirname, "..", "android", "app", "build.gradle");
const credsDir = path.join(__dirname, "..", "credentials");
const propsFile = path.join(credsDir, "keystore.properties");

function fail(msg) {
  console.error(`\n  apply-release-signing: ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(gradleFile)) {
  fail(`android/app/build.gradle not found.\n  Run "npx expo prebuild --platform android" first.`);
}
if (!fs.existsSync(propsFile)) {
  fail(
    `credentials/keystore.properties not found.\n` +
      `  Generate a release key first (see BUILD_ANDROID.md), or the APK would be\n` +
      `  signed with Android's public debug key.`,
  );
}

const props = Object.fromEntries(
  fs
    .readFileSync(propsFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

for (const key of ["storeFile", "storePassword", "keyAlias", "keyPassword"]) {
  if (!props[key]) fail(`credentials/keystore.properties is missing "${key}".`);
}
const keystore = path.join(credsDir, props.storeFile);
if (!fs.existsSync(keystore)) fail(`keystore not found at credentials/${props.storeFile}.`);

let gradle = fs.readFileSync(gradleFile, "utf8");

if (gradle.includes(MARKER)) {
  console.log("apply-release-signing: already applied, nothing to do.");
  process.exit(0);
}

// 1. Add a "release" signing config that reads the external credentials file.
const signingAnchor = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const signingReplacement = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        // ${MARKER} — credentials are kept in frontend/credentials/, outside
        // this generated directory, and are never committed.
        release {
            def aqsmsProps = rootProject.file('../credentials/keystore.properties')
            if (aqsmsProps.exists()) {
                def loaded = new Properties()
                aqsmsProps.withInputStream { loaded.load(it) }
                storeFile rootProject.file('../credentials/' + loaded.getProperty('storeFile'))
                storePassword loaded.getProperty('storePassword')
                keyAlias loaded.getProperty('keyAlias')
                keyPassword loaded.getProperty('keyPassword')
            }
        }
    }`;

if (!gradle.includes(signingAnchor)) {
  fail(
    `could not find the expected signingConfigs block in android/app/build.gradle.\n` +
      `  The Expo template changed; update this script to match.`,
  );
}
gradle = gradle.replace(signingAnchor, signingReplacement);

// 2. Make the release build type use it.
const releaseAnchor = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const releaseReplacement = `        release {
            // ${MARKER}: use the project keystore, not the debug key.
            def aqsmsKeys = rootProject.file('../credentials/keystore.properties')
            if (aqsmsKeys.exists()) {
                signingConfig signingConfigs.release
            } else {
                signingConfig signingConfigs.debug
            }`;

if (!gradle.includes(releaseAnchor)) {
  fail(
    `could not find the expected release buildType block in android/app/build.gradle.\n` +
      `  The Expo template changed; update this script to match.`,
  );
}
gradle = gradle.replace(releaseAnchor, releaseReplacement);

fs.writeFileSync(gradleFile, gradle);
console.log(`apply-release-signing: release builds now use credentials/${props.storeFile}`);
