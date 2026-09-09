# Creature models

Drop a `.glb` here named after the creature id, then add that id to
`manifest.json`. Anything not listed keeps its procedurally generated mesh, so
the roster can be converted one creature at a time without breaking the game.

```
assets/models/bytec.glb      ->  "models": ["bytec"]
```

Ids are the keys in `src/data/species.js` (`bytec`, `ramzon`, `sipio`,
`serverus`, …). Evolved forms use the base id plus `x`: `bytecx`.

## What the loader expects

* **GLB** (`.glb`), glTF 2.0, triangle meshes.
* Textures embedded in the file — external image files are not fetched.
* Any scale, origin or orientation: each model is centred on X/Z, dropped onto
  Y=0 and rescaled to the height the roster says that creature should be.

If a model comes out facing the wrong way, add a correction in
`src3d/gfx/models.js`:

```js
export const MODEL_TWEAKS = {
  bytec: { rotY: Math.PI },   // radians; turn it to face +Z
};
```
`height` overrides the auto-fitted height in world units if a creature needs to
break the size rules.

Skinned animation is not read yet — models are drawn in their bind pose.
