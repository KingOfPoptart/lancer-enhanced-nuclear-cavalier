/**
 * Lancer Enhanced Nuclear Cavalier
 * --------------------------------
 * Automates the two Danger Zone-triggered ranks of the Nuclear Cavalier
 * talent (`t_nuclear_cavalier`), which the LANCER system does not roll for
 * you. Per the system's own talent data (not the icon-glyph core book text):
 *
 *   Rank 1 - Aggressive Heat Bleed: the first attack roll you make on your
 *     turn while in the Danger Zone deals +2 Heat on a hit.
 *   Rank 2 - Fusion Hemorrhage: the first ranged or melee attack roll you
 *     make on your turn while in the Danger Zone deals Energy instead of
 *     Kinetic or Explosive, and deals +1d6 Energy bonus damage on a hit.
 *
 * Rank 3 (Here, Catch! - the integrated Fuel Rod Gun) is already handled
 * elsewhere and is out of scope here.
 *
 * How it works, without touching the system:
 *
 * Both effects are `DamageRollFlow` steps, registered through
 * `lancer.registerFlows` and inserted after `initDamageData` (the same slot
 * used for this style of automation elsewhere) - before the Damage HUD opens,
 * so pushed `bonus_damage` flows through into what the HUD (and the player)
 * actually see and roll. Bonus damage is the only thing that flows through
 * `state.data` like this, though: the HUD's displayed/rolled *base* damage
 * type is read straight off the weapon item's own `active_profile`, not from
 * `state.data.damage` (which is empty at this point and only ever seeds a
 * separate HUD-only "extra base damage" list) - see the comment on
 * `fusionHemorrhageStep` for how the type conversion actually works.
 *
 * Danger Zone is computed from `mech.system.heat` (value * 2 >= max) - not
 * read from `mech.system.statuses.dangerzone`, which only mirrors a
 * `dangerzone` status effect actually applied to the actor and is never set
 * from heat by the base system on its own; reading it would silently never
 * trigger.
 *
 * It is NOT computed live at `DamageRollFlow` time, though - it's snapshotted
 * earlier, in `WeaponAttackFlow`, by `captureDangerZoneBeforeSelfHeat`
 * (inserted after `showAttackHUD`, alongside `reorderFirstAttackTarget`).
 * `WeaponAttackFlow` runs `applySelfHeat` (a weapon's own `Heat X (self)`
 * tag) and persists it to the actor before `DamageRollFlow` ever starts, so a
 * live check in the damage flow would see a shot's own self-heat as having
 * already put the mech in the Danger Zone and wrongly trigger on that same
 * shot. Per Heat Self's own wording ("immediately after using this weapon or
 * system, the user takes X Heat"), that heat is an effect of the attack, not
 * a precondition of it - so if a shot's self-heat is what crosses the mech
 * into the Danger Zone, the trigger isn't available until the mech's *next*
 * attack, not this one. The snapshot is stashed as an actor flag (NOT on
 * `state.data` - confirmed by testing that a custom `state.data` field placed
 * in `WeaponAttackFlow` does not survive into the later, separately-started
 * `DamageRollFlow`, even though `hit_results`/`acc_diff.targets` do; only an
 * actor flag reliably carries across), tagged with the weapon's uuid so
 * `snapshotDangerZone` only trusts a snapshot taken for *this* weapon's
 * attack. `aggressiveHeatBleedStep`/`fusionHemorrhageStep` read it in
 * preference to a live check; a live check remains the fallback whenever
 * there's no matching snapshot - a damage roll that didn't come through
 * `WeaponAttackFlow` (e.g. a tech attack, which has no weapon item and so
 * never matches), or a snapshot that's actually stale (a second weapon
 * attack queued before the first one's damage was rolled).
 *
 * A world-scope setting, `allowSelfHeatTrigger` (off by default), restores
 * the pre-1.0.1 same-shot-trigger behavior for tables that prefer it: when
 * on, both trigger checks call `inDangerZone(mech)` live instead of reading
 * the snapshot, same as v1.0.0 did unconditionally. See `allowSelfHeatTrigger()`.
 *
 * "First attack this turn" is tracked the same way as the sibling module's
 * "1/round" lock: an actor flag storing `{combat, round}`, one flag per
 * effect (`ahb`, `fh`) since a pilot's first attack of the turn and first
 * ranged/melee attack of the turn are not always the same attack (e.g. a
 * tech attack could come first). The flag is set as soon as a qualifying
 * attack roll happens while in the Danger Zone, whether it hits or misses -
 * RAW keys the trigger to the attack roll itself, not to landing a hit. If
 * that first qualifying attack roll misses, that talent gets nothing else
 * that turn - it doesn't wait for a later attack that hits.
 *
 * Multi-target handling (both ranks): per the FAQ, a multi-target action
 * (Blast/Burst/Cone/Line, or just targeting several tokens) resolves as a
 * separate attack roll per target, each counting individually as "an attack
 * roll," and with no RAW-specified order between them the acting player
 * chooses it - *before* any of those rolls happen, not after (picking after
 * would be picking a known result, not declaring an order). `reorderFirst
 * AttackTarget`, a `WeaponAttackFlow` step (inserted after `showAttackHUD`,
 * before `rollAttacks`), asks the player directly which target counts as
 * that first roll when there's 2+ of them (once per attack, shared between
 * both ranks) and reorders the target list so `hit_results[0]` - what
 * `aggressiveHeatBleedStep` / `fusionHemorrhageStep` read later, once
 * `DamageRollFlow` starts - ends up being that chosen target. With 0 or 1
 * target there's nothing to ask. Only that one target - not every target
 * the action hits - gets the rank's bonus, and only if that specific roll
 * hit. See the comment on `reorderFirstAttackTarget` for the full mechanism.
 *
 * Fusion Hemorrhage's damage-type conversion only rewrites a concretely
 * Kinetic or Explosive entry. If a Variable-type weapon's damage type is
 * still unresolved at this point, it is left alone rather than forced to
 * Energy - the talent only names Kinetic and Explosive as what it overrides,
 * and forcing an unresolved Variable choice would remove the player's pick
 * on the one weapon type built around that choice. The +1d6 Energy bonus
 * damage still applies regardless. This conversion only happens for 0-or-1
 * tracked targets - see the comment on `fusionHemorrhageStep` for why 2+
 * targets scopes it out.
 *
 * Multi-target bonus damage - how it actually gets shown: pushing to the
 * flow-wide `state.data.bonus_damage` (what a 0-or-1-target attack uses)
 * would, for 2+ targets, both get halved (round up) and applied to *every*
 * hit target by the system's own `rollNormalDamage`/`rollCritDamage`
 * (`multiTarget && dr.bonus && !dr.target`) - the base system's general
 * anti-stacking rule for any module's bonus damage, not something this
 * module controls - *and*, regardless of that halving, never actually
 * appear anywhere in the printed chat card. The card's per-target section
 * (`damageTarget()` in the system's `helpers/chat.ts`) only renders "BONUS"
 * rows sourced from `damage_results`/`crit_damage_results` entries that
 * carry a `.target` matching that specific target - an untargeted entry, or
 * one manually pushed to `state.data.targets[].damage` directly (an earlier
 * version of this module did that), never shows up there even though it's
 * real and would still be applied. `applyAggressiveHeatBleedBonus` /
 * `applyFusionHemorrhageBonus` instead push into `state.data.damage_hud
 * _data.targets[].bonusDamage` for the one chosen target - what
 * `_collectBonusDamage` (system's `damage.ts`) reads to build exactly those
 * target-tagged, non-halved, correctly crit-doubled `damage_results`
 * entries, and so what actually shows up as a "BONUS" row under that
 * target's name. See the comment on `applyAggressiveHeatBleedBonus` for the
 * full mechanism.
 *
 * Known limitations
 * ----------------
 *   - `DamageRollFlow` is only reached when a damage roll is actually
 *     started for an attack. If a mech's first attack of the turn misses and
 *     nobody rolls damage for it (nothing to roll), the "first attack" flag
 *     for that effect never gets marked, so a later attack that turn could
 *     still receive the trigger it should not, in one specific edge case.
 *   - Fusion Hemorrhage's "ranged or melee" restriction is enforced by
 *     requiring the flow's item to be a `mech_weapon` (excludes tech attacks
 *     / Invade damage rolls, which route through `DamageRollFlow` too but
 *     without a weapon item). Aggressive Heat Bleed has no such restriction,
 *     matching its unrestricted "the first attack roll" wording.
 *   - Like the sibling core-bonus module, the "first attack this turn" lock
 *     is only enforced inside a tracked encounter (`game.combat`); outside
 *     combat there's no round to key it to, so it is not enforced.
 *   - Fusion Hemorrhage's Kinetic/Explosive -> Energy conversion only
 *     applies for 0 or 1 tracked targets. On a 2+-target attack, the chosen
 *     target still gets the full +1d6 Energy bonus, visibly and un-halved,
 *     but keeps the weapon's normal (Kinetic/Explosive) type for their base
 *     damage, same as every other target - see the comment on
 *     `fusionHemorrhageStep` for why the type can't be overridden per
 *     target in the chat card's display.
 *   - The "which target is the first roll" prompt (`reorderFirstAttackTarget`)
 *     only runs in `WeaponAttackFlow`. A tech attack with 2+ targets
 *     (`TechAttackFlow`) doesn't get it and falls back to plain click order
 *     for `hit_results[0]` - moot for Fusion Hemorrhage (mech_weapon only
 *     anyway) but a gap for Aggressive Heat Bleed's broader "any attack
 *     roll" wording.
 */

const MODULE_ID = "lancer-enhanced-nuclear-cavalier";
const NUCLEAR_CAVALIER_LID = "t_nuclear_cavalier";
const AHB_FLAG = "ahb";
const FH_FLAG = "fh";
const ALLOW_SELF_HEAT_TRIGGER_SETTING = "allowSelfHeatTrigger";

/** v1.0.0 compatibility toggle - see the setting's hint text and the module doc comment. */
function allowSelfHeatTrigger() {
  return !!game.settings?.get(MODULE_ID, ALLOW_SELF_HEAT_TRIGGER_SETTING);
}

/* -------------------------------------------------------------------------- */
/*  Talent rank + Danger Zone lookups                                         */
/* -------------------------------------------------------------------------- */

/** The piloting pilot's Nuclear Cavalier rank (0-3), or 0 if not owned. */
function nuclearCavalierRank(mech) {
  const pilot = mech?.system?.pilot?.value;
  const talent = pilot?.itemTypes?.talent?.find(t => t?.system?.lid === NUCLEAR_CAVALIER_LID);
  return talent?.system?.curr_rank ?? 0;
}

/**
 * The Danger Zone is defined by heat (RAW: "half or more of heat is filled
 * in"), but the LANCER system does NOT compute `system.statuses.dangerzone`
 * from heat automatically - that flag only mirrors a `dangerzone` status
 * effect actually applied to the actor (native Foundry ActiveEffect-derived
 * status), which nothing in the base system ever applies on its own. Reading
 * that flag here would silently never trigger. Compute it directly instead.
 */
function inDangerZone(mech) {
  const heat = mech?.system?.heat;
  if (!heat || !heat.max) return false;
  return heat.value * 2 >= heat.max;
}

/* -------------------------------------------------------------------------- */
/*  "First attack this turn" tracking - one flag per effect                   */
/* -------------------------------------------------------------------------- */

/**
 * "First attack this turn" is tracked as "not yet used this combat round",
 * the same approximation the sibling module's 1/round locks use - in LANCER
 * a mech typically activates (and so takes its attacks) once per round.
 */
function usedThisRound(mech, key) {
  const combat = game.combat;
  if (!combat) return false;
  const used = mech.getFlag(MODULE_ID, key);
  return !!used && used.combat === combat.id && used.round === combat.round;
}

async function markUsedThisRound(mech, key) {
  const combat = game.combat;
  await mech.setFlag(MODULE_ID, key, {
    combat: combat?.id ?? null,
    round: combat?.round ?? null,
    at: Date.now(),
  });
}

const DANGER_ZONE_SNAPSHOT_FLAG = "dzSnapshot";

/**
 * Snapshot Danger Zone status before `WeaponAttackFlow`'s own `applySelfHeat`
 * step can apply this shot's self-heat - see the module doc comment for why.
 * Inserted after `showAttackHUD`, i.e. before `rollAttacks` and well before
 * self-heat resolves, so this reflects heat from anything *earlier* this
 * turn but never this attack's own self-heat.
 *
 * Stashed as an actor flag, NOT on `state.data` - despite `hit_results` and
 * `acc_diff.targets` visibly surviving from `WeaponAttackFlow`'s finished
 * state into the later, separately-started `DamageRollFlow` (the mechanism
 * `reorderFirstAttackTarget`'s doc comment describes), an arbitrary custom
 * field placed on `state.data` here does NOT make that trip - confirmed by
 * live testing: `data[DANGER_ZONE_SNAPSHOT_FLAG]` reads back `undefined` in
 * `aggressiveHeatBleedStep`/`fusionHemorrhageStep` every time, silently
 * falling through to a live check and reintroducing the exact bug this is
 * meant to fix. Whatever carries `hit_results` across evidently only
 * preserves fields the system's own damage-flow initializer already knows
 * about, not arbitrary extras. An actor flag has no such problem - it's real
 * persisted document state, trivially reachable from any later flow.
 *
 * Recorded with the weapon's uuid so `snapshotDangerZone` can refuse to use
 * a stale snapshot left by a different weapon's attack (e.g. a queued second
 * attack, or a tech attack's `TechAttackFlow` - which has no item and so
 * never matches - falling correctly through to a live check instead).
 */
async function captureDangerZoneBeforeSelfHeat(state) {
  try {
    const mech = state?.actor;
    if (!mech || mech.type !== "mech") return true;
    await mech.setFlag(MODULE_ID, DANGER_ZONE_SNAPSHOT_FLAG, {
      weaponUuid: state?.item?.uuid ?? null,
      inDangerZone: inDangerZone(mech),
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Danger Zone snapshot failed`, err);
  }
  return true; // never block the attack flow
}

/** The snapshot from `captureDangerZoneBeforeSelfHeat`, if it matches this weapon; `null` otherwise. */
function snapshotDangerZone(mech, weapon) {
  const snap = mech?.getFlag(MODULE_ID, DANGER_ZONE_SNAPSHOT_FLAG);
  if (!snap || !weapon?.uuid || snap.weaponUuid !== weapon.uuid) return null;
  return snap.inDangerZone;
}

/* -------------------------------------------------------------------------- */
/*  Shared: "first attack roll" target for multi-target attacks               */
/* -------------------------------------------------------------------------- */

/**
 * RAW for both ranks: "The first attack roll you make on your turn...". Per
 * the FAQ, a multi-target action (Blast/Burst/Cone/Line, or just targeting
 * several tokens) resolves as a separate attack roll per target, each one
 * counting individually as "an attack roll." With no RAW-specified order,
 * the FAQ's "word of Tom" ruling for unordered multi-roll actions puts the
 * choice on the acting player. Only that one target - not every target the
 * action hits - gets the rank's bonus, and only if that specific roll hit.
 *
 * The choice has to be made and locked in *before* any attack roll happens
 * - asking after would mean picking with the benefit of hindsight, which
 * isn't "declaring an order," it's picking a result. So this can't live in
 * DamageRollFlow (where the rest of this module's logic runs): by the time
 * a damage roll starts, `WeaponAttackFlow` has already rolled every
 * target's attack and printed the card. `reorderFirstAttackTarget` (below)
 * is a `WeaponAttackFlow` step instead, inserted after `showAttackHUD` -
 * once the target list is final - and before `rollAttacks` - before any
 * d20 is rolled. It prompts (once, if there's 2+ targets) and then reorders
 * `state.data.acc_diff.targets` so the chosen target is first.
 *
 * `rollAttacks` builds `state.data.attack_rolls.targeted` (and, from there,
 * `hit_results`) by mapping `acc_diff.targets` in array order via
 * `Promise.all`, which preserves input order regardless of which roll
 * resolves first - so moving the chosen target to the front here is
 * sufficient to make it `hit_results[0]` later, with no separate signal
 * needing to survive the gap between the (separate, printed-and-done)
 * attack flow and the (later, separately started from the attack card's
 * "Roll Damage" button) damage flow. `aggressiveHeatBleedStep` and
 * `fusionHemorrhageStep` just read `data.hit_results[0]` directly again.
 *
 * Only scoped to `WeaponAttackFlow` - a tech attack (`TechAttackFlow`) with
 * 2+ targets doesn't get this prompt and falls back to plain click order;
 * see the module's known-limitations note.
 */
async function reorderFirstAttackTarget(state) {
  try {
    const mech = state?.actor;
    const targets = state?.data?.acc_diff?.targets;
    if (!mech || mech.type !== "mech" || !Array.isArray(targets) || targets.length < 2) return true;

    const rank = nuclearCavalierRank(mech);
    if (rank < 1) return true;
    // Don't bother prompting if neither rank could possibly still trigger
    // this round - only relevant for a mech's 2nd+ attack in a round.
    const ahbAvailable = !usedThisRound(mech, AHB_FLAG);
    const fhAvailable = rank >= 2 && state?.item?.type === "mech_weapon" && !usedThisRound(mech, FH_FLAG);
    if (!ahbAvailable && !fhAvailable) return true;

    const idx = await promptFirstAttackTarget(targets);
    if (idx > 0) {
      const [chosen] = targets.splice(idx, 1);
      targets.unshift(chosen);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | first-attack-target reorder failed`, err);
  }
  return true; // never block the attack flow
}

/** Minimal HTML-escape for interpolating token names into dialog markup. */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Asks the player which target should count as their first attack roll this
 * turn, before any attack roll happens - mirrors the system's own
 * `DialogV2.prompt` radio-button pattern (e.g. its pilot-loadout-selection
 * prompt on import). Falls back to index 0 (first-targeted, by click order)
 * if DialogV2 isn't available or the dialog is dismissed without a choice.
 */
async function promptFirstAttackTarget(targets) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.prompt) return 0;

  const choices = targets
    .map((t, i) => {
      const name = escapeHtml(t?.targetName || `Target ${i + 1}`);
      return `<label style="display:block;"><input type="radio" name="choice" value="${i}" ${i === 0 ? "checked" : ""}> ${name}</label>`;
    })
    .join("");

  try {
    const result = await DialogV2.prompt({
      window: { title: "Nuclear Cavalier - Choose Your Target" },
      content: `
        <p>This attack hits multiple targets. Pick the one whose roll counts as your
        first attack this turn - only that target can trigger Nuclear Cavalier.</p>
        <details style="margin-bottom:0.75em;">
          <summary style="cursor:pointer;">Why do I have to pick?</summary>
          <p style="margin-top:0.5em;">Nuclear Cavalier triggers on <em>the first attack
          roll you make</em> each turn. A multi-target attack is actually a separate
          attack roll against each target, and the rules don't specify which one goes
          "first" - so by FAQ ruling, you as the attacking player choose which target's
          roll counts as first. Only that target can get Nuclear Cavalier's bonus
          damage; the rest resolve normally, with no bonus, regardless of hit or
          miss.</p>
        </details>
        ${choices}
      `,
      ok: {
        label: "Confirm",
        callback: (_event, button) => button.form?.elements?.choice?.value,
      },
      rejectClose: false,
    });
    const idx = Number(result);
    return Number.isInteger(idx) && idx >= 0 && idx < targets.length ? idx : 0;
  } catch (err) {
    console.error(`${MODULE_ID} | first-attack-target prompt failed`, err);
    return 0;
  }
}

/** The first entry of `data.hit_results` - see `reorderFirstAttackTarget` for why this is already the player's chosen target. */
function firstRollTarget(data) {
  const firstRoll = data?.hit_results?.[0];
  return {
    targetUuid: firstRoll?.target?.document?.uuid ?? null,
    willHit: !!(firstRoll?.hit || firstRoll?.crit),
  };
}

/**
 * The chosen target's entry in the Damage HUD's own per-target data, once
 * `showDamageHUD` has built it. See the comment on `applyAggressiveHeatBleed
 * Bonus` for why this - not `state.data.targets[]` - is where a rank's bonus
 * needs to land to actually show up anywhere.
 */
function findHudTargetEntry(data, targetUuid) {
  return data?.damage_hud_data?.targets?.find(t => t?.targetUuid === targetUuid);
}

/* -------------------------------------------------------------------------- */
/*  Damage flow - Rank 1: Aggressive Heat Bleed                               */
/* -------------------------------------------------------------------------- */

/**
 * See `reorderFirstAttackTarget` above for the multi-target ordering this
 * relies on - by the time this runs, `data.hit_results[0]` is already the
 * player's chosen (or, for a single target, only) first roll.
 *
 * That can't be done with `data.bonus_damage` (see the comment on
 * `applyAggressiveHeatBleedBonus` for the full reasoning) - an untargeted
 * bonus_damage entry gets applied to *every* hit target, halved once
 * there's 2+ of them (`rollNormalDamage`/`rollCritDamage`'s `multiTarget &&
 * dr.bonus && !dr.target` check), and is also invisible in the printed
 * chat card's per-target section either way. So this step only records
 * which target should get it; `applyAggressiveHeatBleedBonus` (after
 * `showDamageHUD`) adds the full, un-halved, visible +2 Heat to only that
 * one target.
 *
 * With 0 or 1 tracked targets there's no ordering ambiguity (a target-less
 * roll has nothing to declare an order among; a single target is trivially
 * "first"), so that case keeps the simple flow-wide bonus_damage push -
 * same as `fusionHemorrhageStep`'s 0-or-1-target path, and with the same
 * nice side effect of previewing in the Damage HUD before rolling.
 */
async function aggressiveHeatBleedStep(state) {
  try {
    const mech = state?.actor;
    const data = state?.data;
    if (!mech || mech.type !== "mech" || !data) return true;
    if (nuclearCavalierRank(mech) < 1) return true;
    const wasInDangerZone = allowSelfHeatTrigger() ? inDangerZone(mech) : (snapshotDangerZone(mech, state?.item) ?? inDangerZone(mech));
    if (!wasInDangerZone) return true;
    if (usedThisRound(mech, AHB_FLAG)) return true;

    // This is the first qualifying attack roll this turn - the trigger is
    // consumed now, hit or miss.
    await markUsedThisRound(mech, AHB_FLAG);

    if ((data.hit_results?.length ?? 0) <= 1) {
      const hit = data.has_normal_hit || data.has_crit_hit;
      if (!hit) return true;
      data.bonus_damage = data.bonus_damage ?? [];
      data.bonus_damage.push({ type: "Heat", val: "2" });
      ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.ahb.applied`));
      return true;
    }

    state._ahbTarget = firstRollTarget(data);
  } catch (err) {
    console.error(`${MODULE_ID} | Aggressive Heat Bleed step failed`, err);
  }
  return true; // never block the damage flow
}

/**
 * Give the +2 Heat to only the first-targeted roll's target.
 *
 * This has to land in `state.data.damage_hud_data.targets[].bonusDamage`,
 * not `state.data.targets[]` (an earlier version of this pushed there
 * directly - it's the array actually used to apply damage, but the printed
 * chat card's per-target section (`damageTarget()` in the system's
 * `helpers/chat.ts`) doesn't read it at all for display: it only renders
 * "BONUS" rows sourced from `damage_results`/`crit_damage_results` entries
 * that carry a matching `.target`. So a `targets[]`-only push is invisible
 * in the chat card even though it's real - it silently "isn't there" as far
 * as anyone reading the roll can tell). Pushing into `damage_hud_data
 * .targets[].bonusDamage` instead is what `_collectBonusDamage` (system's
 * `damage.ts`) reads to build exactly those target-tagged `damage_results`
 * entries - so this one push gets rolled through the normal pipeline,
 * tagged to only this target (which also exempts it from the multi-target
 * halving - see the module doc comment), correctly crit-doubled if this
 * target's roll was a crit, and rendered as a visible "BONUS" row under
 * this target's name, all for free.
 *
 * Inserted after `showDamageHUD` (once `damage_hud_data` exists) and before
 * `rollReliable` (which is what first reads the per-target bonus lists).
 */
async function applyAggressiveHeatBleedBonus(state) {
  try {
    const pending = state?._ahbTarget;
    if (!pending) return true;
    delete state._ahbTarget;
    if (!pending.willHit || !pending.targetUuid) return true;

    const hudTarget = findHudTargetEntry(state?.data, pending.targetUuid);
    if (!hudTarget) return true;

    hudTarget.bonusDamage = hudTarget.bonusDamage ?? [];
    hudTarget.bonusDamage.push({ type: "Heat", val: "2" });
    ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.ahb.applied`));
  } catch (err) {
    console.error(`${MODULE_ID} | Aggressive Heat Bleed target application failed`, err);
  }
  return true; // never block the damage flow
}

/* -------------------------------------------------------------------------- */
/*  Damage flow - Rank 2: Fusion Hemorrhage                                   */
/* -------------------------------------------------------------------------- */

/**
 * The Damage HUD does NOT read its displayed/rolled base damage type from
 * `state.data.damage` (that array is empty at this point in the flow, and
 * only ever seeds a separate HUD-only "extra base damage" list) - it reads
 * `weapon.system.active_profile.damage` straight off the weapon item
 * (`DamageHudData.fromParams` in the system's own `data.svelte.ts`).
 * Mutating `state.data.damage` here is therefore a no-op for the type the
 * player actually sees and rolls.
 *
 * For 0 or 1 tracked targets there's no ambiguity, so this performs a real
 * (but self-reverting) update to the weapon's active profile before the HUD
 * opens, converting only concretely Kinetic/Explosive entries - this also
 * gets the nicer side effect of the Damage HUD previewing "Energy" before
 * the player rolls. The revert is done from the `lancer.postFlow
 * .DamageRollFlow` hook (below), not a later flow step - a flow step would
 * never run if the player cancels the attack or damage HUD (`Flow.begin`
 * stops at the first step that returns false), but `postFlow` fires on both
 * the success and abort paths.
 *
 * For 2+ tracked targets, per the same FAQ ordering `reorderFirstAttackTarget`
 * documents for Aggressive Heat Bleed: only the first-targeted roll's
 * target gets Fusion Hemorrhage's damage, not every target the attack hits.
 * The weapon's shared active_profile is left untouched entirely in this
 * case - every target's base damage keeps rolling as Kinetic/Explosive.
 * That's not just "simpler," it's the only option that can actually show up
 * anywhere: the printed chat card's per-target damage-type icons come from
 * `damage_results` entries with no `.target` (i.e. the shared base roll) or
 * a matching one, with no per-target *override* of an untargeted entry's
 * type - so there's no way to make the shared Kinetic/Explosive roll read
 * as Energy for one target's icon without also changing it for every other
 * target's, which is exactly what only-the-first-target is trying to avoid.
 * `applyFusionHemorrhageBonus` (after `showDamageHUD`) still gives that one
 * target the full, un-halved +1d6 Energy bonus - visibly, correctly
 * crit-doubled, the same mechanism `applyAggressiveHeatBleedBonus` uses -
 * it just doesn't attempt the type conversion in this case. A rank-2 pilot
 * whose first ranged/melee roll in a multi-target attack lands on a
 * Kinetic/Explosive weapon keeps that base type for every target, Energy
 * bonus die included, in that specific scenario.
 */
async function fusionHemorrhageStep(state) {
  try {
    const mech = state?.actor;
    const data = state?.data;
    const weapon = state?.item;
    if (!mech || mech.type !== "mech" || !data) return true;
    if (weapon?.type !== "mech_weapon") return true; // ranged/melee only
    if (nuclearCavalierRank(mech) < 2) return true;
    const wasInDangerZone = allowSelfHeatTrigger() ? inDangerZone(mech) : (snapshotDangerZone(mech, weapon) ?? inDangerZone(mech));
    if (!wasInDangerZone) return true;
    if (usedThisRound(mech, FH_FLAG)) return true;

    await markUsedThisRound(mech, FH_FLAG);

    if ((data.hit_results?.length ?? 0) > 1) {
      state._fhTarget = firstRollTarget(data);
      return true;
    }

    // Kinetic/Explosive -> Energy. An unresolved Variable entry is left
    // alone (see module doc comment) rather than forced to Energy.
    const profileIndex = weapon.system?.selected_profile_index ?? 0;
    const damage = weapon.system?.active_profile?.damage ?? [];
    const updates = {};
    const revertUpdates = {};
    damage.forEach((entry, i) => {
      if (entry?.type === "Kinetic" || entry?.type === "Explosive") {
        updates[`system.profiles.${profileIndex}.damage.${i}.type`] = "Energy";
        revertUpdates[`system.profiles.${profileIndex}.damage.${i}.type`] = entry.type;
      }
    });
    if (Object.keys(updates).length) {
      await weapon.update(updates);
      state._fhRevert = { itemUuid: weapon.uuid, updates: revertUpdates };
    }

    const hit = data.has_normal_hit || data.has_crit_hit;
    if (!hit) return true;

    data.bonus_damage = data.bonus_damage ?? [];
    data.bonus_damage.push({ type: "Energy", val: "1d6" });
    ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.fh.applied`));
  } catch (err) {
    console.error(`${MODULE_ID} | Fusion Hemorrhage step failed`, err);
  }
  return true; // never block the damage flow
}

/**
 * Give Fusion Hemorrhage's +1d6 Energy to only the first-targeted roll's
 * target - the 2+-target counterpart to the weapon-profile mutation
 * `fusionHemorrhageStep` uses for 0-or-1 targets. See the comment on
 * `applyAggressiveHeatBleedBonus` for why `damage_hud_data.targets[]
 * .bonusDamage` (not `state.data.targets[]`) is where this has to land to
 * actually be visible, un-halved, and correctly crit-doubled - all of which
 * that mechanism handles automatically once the entry is tagged to a
 * target. No type conversion happens here; see the comment on
 * `fusionHemorrhageStep` for why that's scoped out for 2+ targets.
 */
async function applyFusionHemorrhageBonus(state) {
  try {
    const pending = state?._fhTarget;
    if (!pending) return true;
    delete state._fhTarget;
    if (!pending.willHit || !pending.targetUuid) return true;

    const hudTarget = findHudTargetEntry(state?.data, pending.targetUuid);
    if (!hudTarget) return true;

    hudTarget.bonusDamage = hudTarget.bonusDamage ?? [];
    hudTarget.bonusDamage.push({ type: "Energy", val: "1d6" });
    ui.notifications?.info(game.i18n.localize(`${MODULE_ID}.fh.applied`));
  } catch (err) {
    console.error(`${MODULE_ID} | Fusion Hemorrhage target application failed`, err);
  }
  return true; // never block the damage flow
}

/** Restore a weapon's damage type after a Fusion Hemorrhage conversion, win or cancel. */
async function revertFusionHemorrhage(flow) {
  try {
    const revert = flow?.state?._fhRevert;
    if (!revert) return;
    delete flow.state._fhRevert;
    const item = await fromUuid(revert.itemUuid);
    if (item) await item.update(revert.updates);
  } catch (err) {
    console.error(`${MODULE_ID} | Fusion Hemorrhage revert failed`, err);
  }
}

/* -------------------------------------------------------------------------- */
/*  Flow registration                                                         */
/* -------------------------------------------------------------------------- */

function registerFlowSteps(flowSteps, flows) {
  const dangerZoneSnapshotKey = `${MODULE_ID}.captureDangerZoneBeforeSelfHeat`;
  const reorderKey = `${MODULE_ID}.reorderFirstAttackTarget`;
  const ahbKey = `${MODULE_ID}.aggressiveHeatBleed`;
  const ahbApplyKey = `${MODULE_ID}.aggressiveHeatBleedApply`;
  const fhKey = `${MODULE_ID}.fusionHemorrhage`;
  const fhApplyKey = `${MODULE_ID}.fusionHemorrhageApply`;
  flowSteps.set(dangerZoneSnapshotKey, captureDangerZoneBeforeSelfHeat);
  flowSteps.set(reorderKey, reorderFirstAttackTarget);
  flowSteps.set(ahbKey, aggressiveHeatBleedStep);
  flowSteps.set(ahbApplyKey, applyAggressiveHeatBleedBonus);
  flowSteps.set(fhKey, fusionHemorrhageStep);
  flowSteps.set(fhApplyKey, applyFusionHemorrhageBonus);

  const weaponAttackFlow = flows.get("WeaponAttackFlow");
  if (weaponAttackFlow?.insertStepAfter) {
    weaponAttackFlow.insertStepAfter("showAttackHUD", dangerZoneSnapshotKey);
    weaponAttackFlow.insertStepAfter("showAttackHUD", reorderKey);
    console.log(`${MODULE_ID} | inserted "${dangerZoneSnapshotKey}" and "${reorderKey}" into WeaponAttackFlow`);
  } else {
    console.warn(`${MODULE_ID} | WeaponAttackFlow not available - multi-target first-roll prompt disabled`);
  }

  const damageRollFlow = flows.get("DamageRollFlow");
  if (damageRollFlow?.insertStepAfter) {
    damageRollFlow.insertStepAfter("initDamageData", ahbKey);
    damageRollFlow.insertStepAfter("initDamageData", fhKey);
    damageRollFlow.insertStepAfter("showDamageHUD", ahbApplyKey);
    damageRollFlow.insertStepAfter("showDamageHUD", fhApplyKey);
    console.log(`${MODULE_ID} | inserted Nuclear Cavalier steps into DamageRollFlow`);
  } else {
    console.warn(`${MODULE_ID} | DamageRollFlow not available - Nuclear Cavalier automation disabled`);
  }
}

/* -------------------------------------------------------------------------- */
/*  Wiring                                                                    */
/* -------------------------------------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, ALLOW_SELF_HEAT_TRIGGER_SETTING, {
    name: `${MODULE_ID}.settings.allowSelfHeatTrigger.name`,
    hint: `${MODULE_ID}.settings.allowSelfHeatTrigger.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  console.log(`${MODULE_ID} | init`);
});
Hooks.once("lancer.registerFlows", registerFlowSteps);
Hooks.on("lancer.postFlow.DamageRollFlow", revertFusionHemorrhage);

Hooks.once("ready", () => {
  if (game.system?.id !== "lancer") {
    console.warn(`${MODULE_ID} | active system is "${game.system?.id}", not "lancer" - module is inert`);
  }
});

// Exposed for debugging / other modules.
globalThis.lancerEnhancedNuclearCavalier = {
  MODULE_ID,
  NUCLEAR_CAVALIER_LID,
  nuclearCavalierRank,
  inDangerZone,
  usedThisRound,
};
