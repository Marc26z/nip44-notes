# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Email **marc26z@proton.me**. Please don't open a public issue for anything security-sensitive.

Include what's affected, steps to reproduce, and the version you tested (release tag or APK version). For sensitive details, encrypt your report with this PGP key:

Fingerprint `B8B1 4CAD 25D5 DAC6 DA3A 4D79 973A 79EF 8B0B A72A`

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEZxqJNhYJKwYBBAHaRw8BAQdAyeqtaRWKxXRyebi5nXCltfu7Bz9JfLOLFr5D
Oody/se0JW1hcmMyNnpAcHJvdG9uLm1lIDxtYXJjMjZ6QHByb3Rvbi5tZT6IjAQQ
FgoAPgWCZxqJNgQLCQcICZCXOnnviwunKgMVCAoEFgACAQIZAQKbAwIeARYhBLix
TK0l1drG2jpNeZc6ee+LC6cqAACRrAD+KpY/AlfbTgqr/Dp0TfRM20lNIFVIvDf7
f3fHZeK6VZ4A/1rRwzQI7yNuyvriAW1HtGNJiy18hdKxeNaGmBTxzHoDuDgEZxqJ
NhIKKwYBBAGXVQEFAQEHQB+cdcUuQUzgtfS7g1AaTngBRbwZtoNsJmTC5mBsLKon
AwEIB4h4BBgWCgAqBYJnGok2CZCXOnnviwunKgKbDBYhBLixTK0l1drG2jpNeZc6
ee+LC6cqAAAR5gEAjz8AQw2D6547YsNaU0XGZersdzFFbd8JoFPJR2iw9G4A+gJi
f302hDDIrQDP5ybMFu/xFhnHmzIGtOy84N6H7YEA
=div5
-----END PGP PUBLIC KEY BLOCK-----
```

## Scope

The app's whole promise is that notes are encrypted in the page with NIP-44 before anything is written to disk, and that the key never leaves the device. Anything that leaks plaintext, key material, or weakens that promise is in scope — as are the web app, the APK wrapper, and the build itself.

## What to expect

Reports are acknowledged within 72 hours. There is no bounty program; credit is given on request. Please allow a reasonable time for a fix before disclosing publicly.
