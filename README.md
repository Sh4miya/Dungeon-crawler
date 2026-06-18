# Dungeon Crawler Prototype

Small browser vertical slice for the prison wing milestone, now rebuilt as an **over-the-shoulder Three.js prototype**.

## What is in the build

- Over-the-shoulder camera with wall-obstruction push-in
- Player-relative WASD movement
- Mouse-look facing and aiming
- Left click melee strike
- Right click block / parry hold
- Space dodge with cooldown and brief invulnerability
- Toggle torch on `Q` for visibility-vs-detection risk
- One guard with patrol, suspicious, chase, stun, and reset behavior
- One key + one locked archive door
- `E` or `F` interaction prompt flow
- HUD for health, guard alert, key state, dodge cooldown, and torch state
- Small prison-wing corridor loop ending in an archive exit zone
- Engine decision notes in `docs/over-the-shoulder-spike.md`

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

## Controls

1. Click the game viewport to capture the mouse.
2. Move with `WASD` (or arrow keys).
3. Move the mouse to aim/focus the shoulder camera.
4. Left click near the guard to test melee stagger.
5. Hold right click to block; click it just before contact to parry and stun.
6. Press `Space` to dodge and confirm the cooldown updates in the HUD.
7. Press `Q` to toggle the torch.
8. Sneak past the guard, collect the brass key, and return to the locked door.
9. Press `E` or `F` at the door to unlock it.
10. Walk into the archive chamber to complete the prototype loop.

## Playtest goals

- Camera stays readable in narrow corridors.
- Guard can spot, chase, lose, and reset around blockers.
- Torch makes navigation easier but increases detection risk.
- Attack / block-parry / dodge feel fair from the shoulder view.

## Notes

- The art remains primitive on purpose so the milestone can focus on movement, stealth, and camera feel.
- The current implementation is still intentionally compact; follow-up work should split scene, AI, and combat systems into modules.
