# MSFS Livery Studio Web v0.7.1 Alpha

Standalone GitHub Pages build.

## v0.7.0 — orthographic editor rebuild

The previous v0.6 guide masks were not usable as human-facing aircraft views.

v0.7 replaces all 12 editing views with recognizable orthographic guides:

- Body · Left Side
- Body · Right Side
- Body · Top
- Body · Bottom
- Tail · Left Side
- Tail · Right Side
- Wings · Top
- Wings · Bottom
- Engine 1 · Left Outer
- Engine 2 · Left Inner
- Engine 3 · Right Inner
- Engine 4 · Right Outer

The surface masks, 15 UV bake maps, and preview-mesh sample coordinates were remapped together.
The user still never edits a UV sheet directly.

Each guide now includes:
- clear aircraft orientation
- NOSE / TAIL or FORWARD direction
- editable blue surface
- gray context geometry that is not part of the selected surface
- simple aircraft reference details

## Google cloud projects

Google login / Drive save from v0.6.1 is retained.

Cloud project data includes paint, logos, editable text, positions/sizes, package fields,
current surface, mirror state, and guide state.

The app uses the Google Drive `appDataFolder` scope.

## Upload

Upload the contents of this ZIP directly to a new repository root, then enable:

Settings → Pages → Deploy from a branch → main → /(root)

## Google OAuth setup

Enable Google Drive API, create an OAuth 2.0 Web Client, and add your GitHub Pages origin
(for example `https://YOUR-USERNAME.github.io`) as an Authorized JavaScript origin.

Paste the client ID in the app's **Connect Google** dialog or into `google-config.js`.

## Alpha export limitation

The web build exports PNG texture sources plus the MSFS package skeleton.
Native BC7/DDS compression remains a future WebAssembly/local-helper step.

## Asset notice

Review `LICENSE_NOTICES.txt` before public distribution of A380X-derived profile data.


## Google OAuth preconfigured

This package already contains the OAuth **Client ID** from the supplied Google credential file.

Authorized JavaScript origin found in the credential:
`https://msfs-livery-studio.github.io`

The Google `client_secret` from the downloaded credential JSON is intentionally **not included** in this repository package.
Browser applications must not publish or depend on that secret.
