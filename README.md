# NIP44 Notes

Markdown notes encrypted with [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) and stored as ordinary files you control. No account and no server: the key never leaves the device.

Available as a progressive web app and as a signed Android APK.

## Features

- Create a new Nostr key, import an `nsec`, or use a NIP-07 browser signer with NIP-44 support.
- Every note is encrypted with NIP-44 before it is written to disk.
- Notes are `.nip44` files in a folder you choose (File System Access API), or in private app storage (OPFS/IndexedDB) when no folder is available.
- Markdown editor with live, sanitized preview.
- Search, edit, and delete notes; deleted notes leave tombstones so other devices do not resurrect them.
- Works offline; installable as a PWA.

## Run the web app

```sh
npm install
npm run build
npm run serve
```

Open the printed URL. `npm run build` writes the static app to `dist/`.

## Install the Android app

Download the APK from the [latest release](https://github.com/Marc26z/nip44-notes/releases/latest) and open it on the phone. The app is the same web app wrapped with [zapstore/goapk](https://github.com/zapstore/goapk).

## Build the APK

Requires [goapk](https://github.com/zapstore/goapk):

```sh
go install github.com/zapstore/goapk@latest
npm install
npm run apk
```

The signed APK is written to `dist/nip44notes-<version>.apk`. A release keystore (`keystore.p12`) and its password (`.keystore-password`) are generated on the first build; keep both and reuse them so future versions update in place.

## Test

```sh
npm test        # unit tests
npm run test:e2e  # browser end-to-end checks
```

## File format

Each note is a small JSON envelope written to a `.nip44` file. The filename is derived from the note id, and the payload (title, body, timestamps) is encrypted with a NIP-44 conversation key between your key and itself. Files can be backed up, synced, or moved with any file tool.

## License

MIT
