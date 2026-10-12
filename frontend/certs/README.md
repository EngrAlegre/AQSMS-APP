# certs/

Build-time input for `plugins/with-pi-certificate.js`.

## What goes here

`aqsms-ca.crt` — the **public** CA certificate generated on the Raspberry Pi by
`pi-server/make-cert.sh`. The Android build bundles it so the app trusts that
one Pi's HTTPS certificate.

```
# run on the machine that holds the app source
scp <pi-user>@<pi-address>:pi-server/certs/aqsms-ca.crt frontend/certs/aqsms-ca.crt
```

## What must NOT go here

`aqsms-ca.key`, `pi-server.key` — the private keys. They stay on the Pi. The
files in this directory are public certificates and contain no secret, but the
private keys sit beside them on the Pi under `pi-server/certs/`, which is
gitignored.

## If this file is missing

The build succeeds, the plugin logs a warning, and the APK is produced without
the pinned CA. In that state the app does not trust the Pi's HTTPS certificate
and reports a connection failure for an `https://` address, while plain `http://`
continues to work.

## Rebuilding

The certificate names the exact address the Pi was issued for. If the Pi's LAN
address changes, or the certificate expires, regenerate it on the Pi, copy the
new `aqsms-ca.crt` here, and rebuild the APK.
