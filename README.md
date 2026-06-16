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
- One guard with patrol, suspicious, chase, stun, and reset behavior
- One key + one locked archive door
- E or F interaction prompt flow
- HUD for health, guard alert, key state, dodge cooldown, and player state
- Centralized control binding layer (`ControlManager`) with a `rebind()` hook for future remapping UI

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
3. Left click near the guard to test melee stagger.
4. Hold right click to block; tap right click just before contact to parry and stun.
5. Press `Space` to dodge and confirm the cooldown updates in the HUD.
6. Sneak past the guard, collect the brass key, and return to the locked door.
7. Press `E` or `F` at the door to unlock it.
8. Walk into the archive chamber to complete the prototype loop.
9. Confirm darkness limits visibility outside the player light radius.
10. Let the guard spot you, then break line-of-sight and watch it reset to patrol.

## Notes

- The guard sight cone is intentionally visible for tuning.
- The current remapping architecture is code-driven; no remap UI yet.
- All art is generated with simple shapes so the slice stays lightweight.
