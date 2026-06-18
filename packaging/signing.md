# Code signing (stub)

The Windows installer ships **unsigned** today, so Microsoft Defender SmartScreen shows an
"unknown publisher" warning on download. This doc is the scaffold for turning signing on. Nothing
here is active yet — the build keeps producing an unsigned installer until you wire one of these up.

## The one hard constraint: sign BEFORE `latest.yml`

Termhalla **auto-updates** (electron-updater reads `latest.yml`, which contains the installer's
SHA-512 + size). So the installer's bytes must be final *before* `latest.yml` is generated. That
means signing has to happen **inline during `electron-builder`**, not as a post-`npm run package`
step. If you sign the `.exe` after packaging, its bytes change, `latest.yml` no longer matches, and
the updater rejects every download. (This is why `release.yml` has only a commented signing stub,
not a post-build signing step.)

Two correct ways to sign inline, cheapest-effort first:

## Option A — Azure Trusted Signing (recommended for a solo/OSS project)

~$10/month, **individual identity** validation (no company required), cloud signing (no hardware
token). electron-builder signs inline via `win.azureSignOptions`, so `latest.yml` reflects the
signed binary automatically.

1. Create an Azure Trusted Signing account + certificate profile; complete identity validation.
2. Add to `electron-builder.yml`:
   ```yaml
   win:
     azureSignOptions:
       publisherName: "<your validated name>"
       endpoint: "https://<region>.codesigning.azure.net/"
       codeSigningAccountName: "<account>"
       certificateProfileName: "<profile>"
   ```
3. Add Azure credentials as GitHub repo **secrets** and map them to env in the `release.yml` build
   step: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (electron-builder's azure
   signing reads these).

## Option B — SignPath (free for eligible open-source projects)

[SignPath Foundation](https://signpath.org/) grants free code signing to qualifying public OSS
projects (MIT qualifies; they review for an established/notable project). SignPath is a managed
signing service; integrate it as electron-builder's **inline signer** so `latest.yml` stays correct:

1. Apply to SignPath Foundation; get an organization, a signing policy, and an API token.
2. Provide a `win.sign` hook (a small JS module) in `electron-builder.yml` that submits the artifact
   to SignPath and waits for the signed file in place — see SignPath's electron-builder guide.
   (Do **not** sign as a separate post-`gh release` step — see the ordering constraint above.)
3. Add GitHub repo **secrets**: `SIGNPATH_API_TOKEN`, `SIGNPATH_ORG_ID`, plus your project /
   signing-policy slugs, and map them to env in the `release.yml` build step.

## Free, no-signing fallbacks (in use today)

Even without a certificate, users can install:

- **winget** (`packaging/winget/`) and **Scoop** (`packaging/scoop/`) — these verify downloads by
  hash and largely sidestep the SmartScreen prompt; recommended for the developer audience.
- **Manual:** on the SmartScreen dialog click **More info → Run anyway**, or
  `Unblock-File .\Termhalla-Setup-<version>.exe` before running.

## When signing is enabled

Remove the "unsigned — Run anyway" note from the README's Install section and from release notes,
and (optionally) retire the Scoop/winget emphasis if a signed direct download is now warning-free.
