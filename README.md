# Dungeon Crawler Prototype

Small vertical-slice prototype for the prison wing milestone.

## What is in the build

- Top-down Phaser 3 browser prototype
- One prison-wing layout with collision boundaries
- WASD / arrow-key movement
- Mouse 1 melee strike
- Mouse 2 guard / parry hold
- Space dodge with cooldown and brief invulnerability
- Darkness layer powered by Phaser lights with a player sight radius
- Pick-up torch with a manual light toggle (`Q` or `T`)
- Kennel countdown HUD that accelerates while the torch is lit
- One guard with patrol, suspicious, chase, stun, and reset behavior
- One released hound with idle/released/search/chase/attack/reset behavior
- One key + one locked archive door
- E or F interaction prompt flow
- HUD for health, torch state, kennel countdown, guard/hound alert state, dodge cooldown, and player state
- Procedural placeholder cue synth for guard footsteps + keys, torch pickup/use, hound growls/barks, door unlocks, and alert triggers
- Centralized balance constants in `src/gameBalance.ts`

## Run locally

```bash
npm install
npm run dev
```

Vite will print a local URL, usually `http://localhost:5173/`.

## Validation

```bash
npm run typecheck
npm run build
```

## Playtest checklist

1. Start at the left side of the wing.
2. Move with `WASD` (or arrow keys) and confirm wall collision works.
3. Pick up the torch in the lower-left corridor.
4. Tap `Q` or `T` to light and douse the torch; confirm the sight radius changes.
5. Watch the kennel timer tick faster while the torch is lit.
6. Let the guard see you with and without the torch to verify the detectability tradeoff.
7. Left click near the guard to test melee stagger.
8. Hold right click to block; time it tightly to parry and stun.
9. Press `Space` to dodge and confirm the cooldown updates in the HUD.
10. Grab the brass key, return to the locked door, and unlock it with `E` or `F`.
11. Wait out the countdown and confirm the hound releases with obvious sound + screen warning.
12. Kite the hound through release/search/chase/attack/reset behavior.
13. Hit the hound twice to verify its lower health and temporary reset.
14. Walk into the archive chamber to complete the prototype loop.

## Tuning notes

- `src/gameBalance.ts` is the single place to tune speeds, sight ranges, countdown pressure, torch penalty, and hound recovery.
- The torch currently trades safety for information in two ways: it speeds up the countdown and expands enemy detection range.
- The hound is intentionally faster than the guard and hits for 2 HP so the release event changes the room’s emotional temperature immediately.
- All audio is generated with tiny oscillator-based placeholder cues so the prototype stays asset-light while still telegraphing danger.
