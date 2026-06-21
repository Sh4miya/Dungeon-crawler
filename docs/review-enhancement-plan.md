# Dungeon Crawler Review and Enhancement Plan

## Scope

This review is based on a local playtest of the browser prototype plus a code/readme pass. The current slice is a compact over-the-shoulder prison escape loop: talk to prisoners, find a torch, recover a shiv, secure a brass key, unlock the gate, and survive the Warden encounter.

Validation performed:

- `npm install`
- `npm run build`
- `npm run typecheck`
- Browser playtest at the Vite dev URL

## Comparable games

| Game | Comparable strengths | Useful lesson for this prototype |
| --- | --- | --- |
| **Dark and Darker** | First-person fantasy dungeon extraction with high tension, limited information, PvPvE pressure, and valuable loot goals. | Keep the prison loop tense with readable risk/reward choices: torch visibility vs. stealth, route shortcuts vs. guard exposure, and clear loot/objective payoffs. |
| **Exanima** | Dark fantasy dungeon crawling with deliberate melee and strong physicality. | The Warden/parry combat should feel weighty and readable. Telegraph attacks strongly, give collision and hit reactions more animation/sound feedback, and avoid making melee feel like abstract stat checks. |
| **Legend of Grimrock** | Grid-like dungeon navigation, locks/keys, authored rooms, and environmental discovery. | The current key/gate loop is a good fit; add stronger room landmarks, puzzle-like gates, and map-readable spatial identity so navigation becomes memorable rather than just dark corridors. |
| **Styx: Master of Shadows** | Stealth-forward fantasy spaces built around shadows, patrols, and vertical/route choices. | Lean harder into stealth: patrol tells, hiding spots, alternate routes, prisoner distractions, and torch/no-torch consequences should be legible at a glance. |
| **Barony** | Compact first-person dungeon runs with readable pickups, hostile encounters, and fast iteration. | Improve pickup silhouettes and moment-to-moment reward feedback so the player immediately recognizes tools, keys, weapons, and threats. |

## What works now

- The prison-break goal is clear and stronger than a generic dungeon premise: framed prisoner, helper clues, kennel countdown, brass key, locked gate, Warden.
- The torch tradeoff is a good core mechanic because it links navigation readability to detection risk.
- Prisoner roles give the compact map narrative texture without needing expensive content.
- The authored room loop is the right size for a prototype; it is small enough to polish rather than sprawl.
- The HUD exposes useful state: health, weapon, key, guard, hound, dodge, torch, current room, and objective chain.

## Main issues found

### 1. Visual readability is the largest design risk

The dark mood fits the premise, but the play space is often too low-contrast to parse quickly. Walls, exits, NPCs, pickups, and route choices need clearer silhouettes.

Recommended changes:

- Add stronger local light pools around interactables, doors, and important route bends.
- Use accent colors consistently: cyan for allies/info, brass/gold for keys/objectives, red/orange for danger, cold blue/gray for neutral dungeon geometry.
- Give each room a distinct landmark: barred cells, dripping pipe, guard desk, kennel gate, archive shelves, Warden banner, exit portcullis.
- Add pickup outlines, bobbing, icon plates, or small diegetic labels so the shiv/key/torch do not disappear into the floor.

### 2. Title/menu and remap UI need polish

On the title screen, the control binding list is visible immediately under the title actions, which makes the `Controls & remap` button feel redundant. On a 680px-high viewport the card also feels cramped/clipped.

Recommended changes:

- Hide the binding grid on the default title state; show it only after choosing `Controls & remap` or pressing `C`.
- Add a max-height and internal scroll to `.screen-card` for short viewports.
- Add a short subtitle that sells the actual premise, e.g. `Break the prison wing before the Warden seals it.`
- Add a simple key/gate/torch visual motif to distinguish the game from the placeholder title `Dungeon Crawler`.

### 3. HUD information is useful but crowded

The HUD currently presents objective, state, timer, controls, prompt, and mouse-lock hint at once. It is helpful for testing but heavy for play.

Recommended changes:

- Keep only the current objective, prompt, health, weapon/key state, and critical enemy alert visible by default.
- Move the full control summary behind `C` or a first-run tooltip.
- Turn guard/hound/player states into small icons/meters rather than dense debug-like text.
- Make the kennel timer visually prominent only once it starts to matter.

### 4. Navigation feedback needs clearer orientation

The minimap concept is good, especially because it only reveals discovered rooms, locked doors, and hints. However, the player needs stronger orientation cues in-world.

Recommended changes:

- Add a player arrow and current-room highlight on the minimap if not already visible in every state.
- Add door plaques or environmental signs for room transitions.
- Use light/color gradients to lead the player from cell block → tunnel → barracks/kennel → gate.
- Add short objective text after each major pickup: `Shiv recovered — key is near the kennel rail.`

### 5. Combat and stealth need more readable feedback

The mechanics are promising, but melee/block/parry/dodge need clear telegraphs and outcomes from the shoulder view.

Recommended changes:

- Give guard/Warden attacks a wind-up pose, sound cue, and flash/outline at the parry timing window.
- Make successful parry/stagger distinct: hit stop, spark, guard stumble animation, and a message that confirms the player did the right thing.
- Add footstep/suspicion audio and visual cone/awareness hints for guard detection during early playtests.
- Let prisoners or notes teach combat indirectly: `His swing is slow after the lantern dips.`

## Art direction recommendations

### Characters

Current primitive characters are serviceable for mechanics, but the game would benefit from low-poly silhouettes:

- Player prisoner: ragged tunic, shackles/bandage, small torch/shiv attachment.
- Helper/coward/informant/hostile/silent prisoners: one distinct color/accent prop each.
- Guard/Warden: larger silhouette, helmet/pauldron, lantern, key ring, or baton.
- Hound: low, angular body with bright eyes/collar tag for instant threat recognition.

### Items

- Torch: warm emissive flame cone; visibly changes the scene when toggled.
- Shiv: small bright specular blade on cloth or crate.
- Brass key: exaggerated scale, warm gold material, ring silhouette.
- Notes: parchment rectangle with readable glow or icon.
- Locked door/gate: unique bars and brass lock plate so the player remembers it.

## Free resources to enhance characters, textures, music, and sound

Always keep an in-repo `CREDITS.md` and record the exact asset title, author, URL, license, and any required attribution at the time of download.

| Need | Suggested free source | License/credit note | How to use it here |
| --- | --- | --- | --- |
| Low-poly characters, guards, creatures, medieval props | **Quaternius** — https://quaternius.com/ | FAQ says assets may be used for free in commercial/educational/personal projects without attribution; models are CC0. Credit as `Quaternius` anyway for goodwill. | Prototype prisoner/guard/hound silhouettes, medieval props, modular dungeon dressing. |
| Modular dungeon kits, UI icons, input prompts, textures, audio | **Kenney Assets** — https://kenney.nl/assets | Kenney support page says game assets are public domain licensed CC0; attribution not required, but credit as `Kenney`. | Replace placeholder UI prompts, add dungeon/texture packs, pickup icons, input glyphs. |
| PBR textures, HDRIs, some models | **Poly Haven** — https://polyhaven.com/license | Poly Haven states assets are CC0; no attribution required, but appreciated. | Stone walls, wet floors, metal bars, wood crates/doors, subtle environment lighting. |
| Sound effects | **Freesound** — https://freesound.org/help/faq/#licenses | Freesound uses CC0, CC BY, and other Creative Commons licenses; filter for CC0 or record CC BY attribution precisely. | Footsteps, metal gate, key pickup, torch flame, dog growls/barks, guard alert. |
| Royalty-free music | **Incompetech** — https://incompetech.com/music/royalty-free/licenses/ | Incompetech offers a no-charge Creative Commons option that requires credit, or paid no-attribution licenses. | Low drone/stealth loop, Warden chase cue, victory sting. |
| Mixed 2D/3D art, textures, music, SFX | **OpenGameArt** — https://opengameart.org/ | Licenses vary by asset; use CC0 when possible, otherwise follow the listed CC BY/GPL/OGA terms exactly. | Extra dungeon textures, music loops, UI frames, and quick placeholder effects. |

## Recommended next production pass

1. **Polish readability first:** room landmarks, pickup silhouettes, interactable lighting, and the title/control UI.
2. **Add a credits pipeline:** create `CREDITS.md` before importing assets.
3. **Replace placeholders gradually:** start with torch/key/shiv/guard/hound because these directly affect comprehension.
4. **Improve combat feedback:** Warden telegraph, parry window cue, stagger confirmation.
5. **Trim HUD for players:** keep debug-rich state available behind a dev flag or `C`, but reduce default clutter.

## Sources checked

- Kenney assets and support/license note: https://kenney.nl/assets and https://kenney.nl/support
- Quaternius FAQ/license note: https://quaternius.com/faq.html
- Poly Haven license: https://polyhaven.com/license
- Freesound FAQ/licenses: https://freesound.org/help/faq/#licenses
- Incompetech music licenses: https://incompetech.com/music/royalty-free/licenses/
- OpenGameArt FAQ: https://opengameart.org/content/faq
- Dark and Darker Steam page: https://store.steampowered.com/app/2016590/Dark_and_Darker/
- Exanima Steam page: https://store.steampowered.com/app/362490/Exanima/
- Styx official site: https://www.styx-thegame.com/
