# Over-the-Shoulder Spike Decision

## Goal
Validate the least-risk path for converting the prototype from top-down stealth into an over-the-shoulder dungeon crawler while preserving:

- darkness pressure
- stealth readability
- guard threat escalation
- key + locked door loop
- attack / block-parry / dodge / interact readability

## Repo baseline
The repo started as a single-scene Phaser 3 top-down slice with 2D Arcade Physics, circular player light, and line-vs-rectangle visibility checks.

## Compared paths

| Path | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| Keep Phaser and fake 2.5D | Reuses existing stack and project shape | Would need custom depth sorting, wall occlusion, camera obstruction handling, fake shoulder framing, and a visibility model that still feels 3D while running on 2D physics assumptions | **Rejected for this milestone** |
| Move the slice to Three.js | Native 3D camera, real wall occlusion, easier shoulder follow camera, browser-friendly, small dependency footprint inside existing Vite app | Requires re-authoring the slice and replacing the old Phaser scene | **Chosen** |

## Why Phaser was the wrong fit for this milestone
The blocker was not raw rendering power. The blocker was readability cost.

To keep Phaser, the port would still need to fake or rebuild all of the following:

1. shoulder camera framing around walls and corners
2. camera push-in when geometry obstructs the player
3. believable corridor occlusion instead of top-down sight masks
4. melee/parry readability from behind the player instead of above them
5. stealth lines that make sense in 3D space rather than in a flat map projection

That is a lot of bespoke glue for a milestone whose real risk is camera/combat readability. Three.js gives those pieces a natural home instead of fighting the original assumptions.

## Spike verdict
**VALIDATED**

A lightweight Three.js rebuild is the least-risk path for the vertical slice in this repo.

## Implemented in the spike
The code now ships a playable shoulder-perspective browser slice with:

- behind-the-player shoulder camera
- camera obstruction push-in via wall raycast
- player-relative WASD movement
- mouse-look facing
- attack, block/parry, dodge, and interact actions
- one guard patrol with suspicious / chase / return / stunned states
- line-of-sight stealth checks using corridor blockers
- key pickup + locked archive door loop
- exit zone for slice completion
- darkness/torch tradeoff where torch improves visibility but increases detection risk

## Known follow-ups
1. Split the monolithic scene logic into modules (`world`, `combat`, `ai`, `input`, `ui`).
2. Add hound behavior as a second pressure type.
3. Replace primitive meshes with authored dungeon props once the feel is locked.
4. Add footstep/noise hooks so stealth is not only line-of-sight based.
5. Add a real minimap or diegetic navigation aid only after camera/combat tuning settles.
