# Aurelia — Monster Quest

משחק הרפתקה בסגנון ה-RPG הקלאסי של אספנות מפלצות (בנוסח FireRed), עם **גרפיקה
מחודשת**: כל הפיקסל במשחק מצויר בזמן ריצה על גבי Canvas — אין ולו קובץ תמונה או
צליל אחד.

> כל היצורים, הסוגים, המהלכים, השמות והמפות במשחק הם **מקוריים**. אין שימוש
> בנכסים או בשמות מוגני זכויות יוצרים.

## איך מריצים

**הדרך הקלה — בלי שום התקנה:** הורד את הקובץ `aurelia.html` ולחץ עליו פעמיים.
זהו. הוא מכיל את המשחק כולו — קוד, עיצוב, גרפיקה וסאונד — בקובץ אחד שרץ ישירות
מהדפדפן, בלי שרת, בלי טרמינל ובלי הרשאות מנהל. מתאים גם למחשב עבודה נעול.

<div dir="ltr">

**For development**, the game is plain ES modules with no build step, but
browsers refuse to load modules over `file://`, so serve the folder:

```bash
npx http-server -p 8080 .     # or: python3 -m http.server 8080
```

then open <http://localhost:8080>.

Rebuild the standalone file after changing anything under `src/`:

```bash
node tools/build-standalone.mjs      # -> aurelia.html
```

It inlines every module (each in its own scope, so same-named module-level
constants cannot collide) plus the CSS into one page, and fails loudly if
`index.html` stops matching the tags it replaces.

## Controls

| Action | Keys |
| --- | --- |
| Move | arrow keys / WASD |
| Confirm, talk, attack | `Z` · `Enter` · `Space` |
| Cancel, back | `X` · `Esc` |
| Menu (party, bag, catalogue, save) | `Tab` |
| Run | hold `Shift` (after you find the Runner Boots) |
| Mute | `M` |

On phones and tablets an on-screen D-pad and A/B buttons appear automatically.

</div>

## מה יש במשחק

- **עולם משובץ** עם 14 מפות: עיירת פתיחה, שני נתיבים, עיר שנייה, מערה, פסגה
  ושבעה פנימיים (בית, מעבדה, מרכז שיקום, חנות, אולם מבחן ועוד).
- **36 יצורים** ב-13 סוגים, כולל שלושה קווי התפתחות של יצורי פתיחה, קווים
  נוספים בטבע ויצור־שיא אחד בפסגה.
- **קרבות תורות מלאים**: נוסחת נזק בסגנון הדור השלישי, יתרון סוגים, מכה
  קריטית, STAB, דרגות מאפיינים, חמישה מצבי סטטוס, בלבול, רתיעה, ריקול, ניקוז
  חיים, מהלכים מרובי־פגיעות ומהלכי קדימות.
- **לכידה** לפי נוסחת הנענועים הקלאסית, עם בונוס למצב סטטוס ולסוג הספֵרה.
- **התקדמות**: נקודות ניסיון, עליית רמות, לימוד מהלכים (כולל בחירת מהלך
  להחלפה), והתפתחות עם אנימציה.
- **מאמנים** שמזהים אותך בקו הראייה, ניגשים אליך ופותחים בקרב; מנהיגת אולם
  שפותחת את הדרך צפונה.
- **מרכז שיקום, חנות, פריטים על הקרקע, שלטים, מדרונות חד־כיווניים** ותיבת
  אחסון כשהצוות מלא.
- **שמירה** ל-`localStorage`, כולל מסך "המשך מסע".

## פרטיות

המשחק לא מבצע ולו בקשת רשת אחת — אין CDN, אין גופנים חיצוניים, אין טלמטריה.
הכול רץ מקומית, והשמירה נשמרת ב-`localStorage` של הדפדפן שלך בלבד.

## הגרפיקה

<div dir="ltr">

Everything is procedural, which is what keeps the repo tiny and the art
consistent:

| Layer | How it is made |
| --- | --- |
| Creatures (`src/gfx/monster.js`) | Eight body archetypes (quad, biped, serpent, avian, insect, aquatic, golem, spirit) composed from bezier blobs with gradients, rim light and outlines. Each species supplies a small `design` block — palette, ears, tail, eyes, markings, wings, aura — and the renderer animates breathing, blinking, tail sway, ear twitch and an elemental particle aura every frame. |
| Terrain (`src/gfx/terrain.js`) | Value-noise fbm textures baked once into offscreen canvases, four variants per material, 16 animated water frames, plus feathered edges so paths bleed into grass. Trees, cliffs, boulders, fences and signs are drawn once at boot and blitted. |
| Characters (`src/gfx/actor.js`) | Four-direction humanoids with a walk cycle, built from a colour table — a new NPC costs one line. |
| Battle FX (`src/battle/fx.js`) | 20 hand-written move animations (beams, lightning polylines, closing jaws, quake cracks, elemental bursts) plus a pooled particle system. |
| Audio (`src/core/audio.js`) | A WebAudio sequencer: six chiptune tracks written as note strings, drums from filtered noise, ~20 sound effects, and a deterministic "cry" per species derived from its own id. |

## Layout

```
aurelia.html          generated: the whole game in one double-clickable file
index.html            page shell + on-screen gamepad
tools/
  build-standalone.mjs bundles src/ + styles.css into aurelia.html
styles.css            page chrome, responsive scaling, touch controls
src/
  main.js             canvas setup, game loop, scene switchboard, transitions
  core/
    util.js           math, seeded RNG, value noise, colour helpers
    input.js          keyboard + touch -> named actions
    audio.js          WebAudio music sequencer and SFX
    save.js           localStorage persistence
  data/
    types.js          13 elemental types + effectiveness chart
    moves.js          ~60 moves with effects and animation ids
    species.js        36 creatures: stats, learnsets, evolutions, art specs
    items.js          balls, potions, cures, key items
    maps.js           14 ASCII maps + warps, NPCs, trainers, encounter tables
  gfx/
    monster.js        procedural creature renderer
    terrain.js        procedural tiles and decorations
    actor.js          procedural human sprites
    ui.js             panels, RTL-aware text, bars, chips, selections
    particles.js      pooled particle system
  world/
    tiles.js          tile legend
    tilemap.js        collision, warps, encounter lookup
    overworld.js      movement, NPCs, cutscenes, y-sorted renderer
  battle/
    engine.js         pure turn resolution -> event list
    fx.js             move animations
    scene.js          battle presentation and menus
  game/
    creature.js       stats, exp, levelling, evolution
    state.js          save-file shape
    dialogue.js       typewriter dialogue + choices
    menus.js          party, summary, bag, catalogue, card, save, shop
    title.js          title screen and new-game setup
```

## Adding content

- **A creature**: one entry in `src/data/species.js`. The `design` block is all
  the art it needs.
- **A move**: one line in `src/data/moves.js`; pick an existing `fx` name or add
  one to `src/battle/fx.js`.
- **A map**: an ASCII grid in `src/data/maps.js` (see `src/world/tiles.js` for
  the character legend) plus warps, NPCs and an encounter table.

</div>
