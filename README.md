# MSFS Livery Studio Web v0.6.0 Alpha

Standalone GitHub Pages build.

## Upload

Upload the **contents of this ZIP directly to the root of a new GitHub repository**.

Required root structure:

```text
index.html
styles.css
app.js
bake-worker.js
manifest.webmanifest
sw.js
.nojekyll
LICENSE_NOTICES.txt
Profiles/
  A380X/
    profile.json
    preview_mesh.bin
    surface_guides/
    surface_masks/
    bake_maps/
```

Do not place the files inside an extra outer folder after uploading.

## Enable GitHub Pages

Repository → Settings → Pages

- Source: Deploy from a branch
- Branch: main
- Folder: /(root)

After GitHub finishes deployment, open the Pages URL shown in Settings.

## Web workflow

The normal user workflow hides UV sheets:

Surface Designer → automatic UV baking → GPU 3D Preview → Livery ZIP export.

The A380X profile contains 12 simplified editing surfaces, 15 UV bake maps, and the reduced preview mesh.

## Current Alpha limitation

The browser version exports PNG texture sources and an MSFS package skeleton.
Native BC7/DDS compression is not yet performed in-browser.

## Public distribution notice

Read `LICENSE_NOTICES.txt` before publishing this repository. The bundled A380X-derived masks,
bake maps, and reduced preview geometry were generated from model files supplied for the project;
redistribution rights for those derived assets should be verified before public distribution.
