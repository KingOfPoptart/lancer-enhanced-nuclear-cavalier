# Changelog

## 1.1.0

Bugfix: a weapon's own self-heat could wrongly trigger Nuclear Cavalier on
the same shot that caused it.

- **Danger Zone is now snapshotted before the attack's own self-heat
  resolves**, not checked live at damage-roll time. Per Heat Self's wording
  ("immediately after using this weapon or system, the user takes X Heat"),
  that heat is an effect of the attack, not a precondition of it — so a shot
  whose own self-heat pushes the mech into the Danger Zone no longer
  triggers Aggressive Heat Bleed or Fusion Hemorrhage on that same shot; the
  trigger becomes available starting the mech's next attack instead.
  Thanks to u/SearchForSunnyD on r/LancerRPG for catching this.
- Added a world setting, **"Allow same-shot self-heat trigger"** (off by
  default), for tables that prefer the old v1.0.0 behavior.

## 1.0.0

Initial release. Both Danger Zone-triggered ranks of Nuclear Cavalier are
automated and verified in-world.

- **Aggressive Heat Bleed** (rank 1): the first attack roll you make on your
  turn while in the Danger Zone deals +2 Heat on a hit.
- **Fusion Hemorrhage** (rank 2): the first ranged or melee attack roll you
  make on your turn while in the Danger Zone converts its base damage type
  from Kinetic/Explosive to Energy and adds +1d6 Energy bonus damage on a
  hit. The weapon's damage type is reverted afterward, including if the
  damage roll is cancelled.
- **Danger Zone is computed live** from current heat, so a weapon whose own
  self-heat pushes the mech into the Danger Zone still triggers on that same
  shot.
- **Multi-target attacks**: per FAQ ruling, each target's roll is a separate
  "attack roll," and the rules don't specify which one resolves first — so a
  prompt asks which target counts as the first roll, before any dice are
  rolled. Only that target's hit can trigger either talent; the rest resolve
  with no bonus.
- Both talents are tracked per-actor, once per round, on the mech's first
  qualifying attack roll — even if it misses, since that was the mech's only
  chance that round. Multiple mechs with Nuclear Cavalier trigger
  independently in the same round.
- Rank 3 (Here, Catch!) is out of scope — already handled elsewhere.
