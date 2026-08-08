# MSFS Livery Studio Web v0.7.4 Alpha

v0.7.4 combines the v0.7.3 high-detail 3D viewer with the original Google Drive cloud-project workflow.

## High-detail 3D

- 1,070,062 render triangles
- 985,631 indexed vertices
- 15 original Paintkit material/UV groups
- `Loading 3D Preview...` spinner and progress detail
- background mesh decode through `mesh-worker.js`
- background livery texture bake through `bake-worker.js`

## Google project save

Restored:

- Google button
- Connect Google
- Save Cloud
- Load Cloud
- 10-second debounced cloud autosave
- Google Drive `appDataFolder` project storage

The configured OAuth JavaScript origin is:

`https://msfs-livery-studio.github.io`

`google-config.js` contains only the browser OAuth Client ID. The private credential value from the downloaded JSON is not included in this package.

For public logins, set the Google OAuth app to **In production** in Google Auth Platform. If it is left in Testing, only configured Test users can sign in.

## Other features retained

- orthographic 2D Surface Designer
- automatic UV Preview
- livery ZIP export

## GitHub Pages

Upload all files/folders to the repository root:

Settings → Pages → Deploy from a branch → main → /(root)
