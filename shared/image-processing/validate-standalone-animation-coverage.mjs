#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_GROUPS,
  STATE_THRESHOLDS,
  TRANSITION_THRESHOLDS,
  auditVariant,
  readJson,
} from './standalone-animation-audit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROSTER_PATH = path.join(ROOT, 'shared/character-data/standalone-roster.json');
const OPERATORS_PATH = path.join(ROOT, 'shared/character-data/operators.json');
const GENERATED_PATH = path.join(ROOT, 'standalone/assets/generated/manifest.json');
const RUNTIME_ROOT = path.join(ROOT, 'standalone/assets/runtime');
const CLEANED_ROOT = path.join(ROOT, 'standalone/assets/cleaned');
const CODEX_COVERAGE_PATH = path.join(ROOT, 'codex/dist/coverage-manifest.json');
const OUTPUT_PATH = path.join(ROOT, 'standalone/dist/animation-coverage.json');

function option(name, fallback = null) {
  const args = process.argv.slice(2);
  const inline = args.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function flag(name) {
  return process.argv.slice(2).includes(name);
}

function variantId(variant) {
  return variant.variant_id || variant.id || variant.skin_id || 'default';
}

function relative(file) {
  return path.relative(ROOT, file);
}

function safePart(value) {
  return String(value).normalize('NFKC').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'selection';
}

async function rosterReconciliation(roster) {
  const [operators, codexCoverage] = await Promise.all([
    readJson(OPERATORS_PATH),
    readJson(CODEX_COVERAGE_PATH),
  ]);
  const operatorIds = new Set(operators.map((entry) => entry.id));
  const codexEntries = [];
  for (const entry of await fs.readdir(path.join(ROOT, 'codex/dist'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestFile = path.join(ROOT, 'codex/dist', entry.name, 'manifest.json');
    const manifest = await readJson(manifestFile, false);
    if (manifest?.character?.id) codexEntries.push(manifest.character);
  }
  const extras = codexEntries.filter((character) => !operatorIds.has(character.id));
  const missingOfficialCodex = operators.filter((operator) => !codexEntries.some((character) => character.id === operator.id));
  const priestess = extras.find((character) => character.id === 'priestess-chibi');
  const explained = codexCoverage.expected_characters === operators.length + 1 &&
    roster.characters.length === operators.length && extras.length === 1 && Boolean(priestess) &&
    priestess.source_id === 'regression-priestess' && priestess.profession === 'story' && missingOfficialCodex.length === 0;
  return {
    codex_roster: codexCoverage.expected_characters,
    codex_validated: codexCoverage.validated_characters,
    standalone_official_roster: roster.characters.length,
    shared_official_operator_entries: operators.length,
    extra_fan_or_original_entries: extras.length,
    difference: codexCoverage.expected_characters - roster.characters.length,
    extra_entries: extras.map((entry) => ({
      id: entry.id,
      display_name: entry.display_name,
      localized_name: entry.localized_name,
      source_id: entry.source_id,
      profession: entry.profession,
    })),
    missing_official_codex_entries: missingOfficialCodex.map((entry) => entry.id),
    explained,
    reason: explained
      ? 'Codex includes the Priestess story-character regression baseline in addition to the 425 official playable/operator entries. Standalone contains the 425 official entries and does not omit an operator.'
      : 'The Codex/standalone roster difference is not fully explained by the checked manifests.',
    evidence: [
      relative(CODEX_COVERAGE_PATH),
      relative(OPERATORS_PATH),
      relative(ROSTER_PATH),
      'codex/dist/*/manifest.json',
    ],
  };
}

function generatedSummary(generated, selectedIdentities = null) {
  const sequences = (generated?.sequences || []).filter((sequence) =>
    (['image2', 'image2-equivalent'].includes(sequence.generator_kind) || /image2|image-to-image|optical-flow/i.test(sequence.generator || '')) &&
    (!selectedIdentities || selectedIdentities.has(`${sequence.character}/${sequence.variant || sequence.skin || 'default'}`)));
  const accepted = sequences.filter((sequence) => sequence.accepted);
  const rejected = sequences.filter((sequence) => !sequence.accepted);
  return {
    accepted_image2_sequences: accepted.length,
    accepted_image2_frames: accepted.reduce((total, sequence) => total + (sequence.generated_frames?.length || 0), 0),
    rejected_image2_sequences: rejected.length,
  };
}

function duplicateSummary(variants) {
  const all = variants.flatMap((variant) => variant.duplicates.map((duplicate) => ({
    character_id: variant.character_id,
    variant_id: variant.variant_id,
    ...duplicate,
  })));
  const exact = all.filter((entry) => entry.signals.includes('exact_duplicate_animation'));
  const staticReused = all.filter((entry) => entry.signals.includes('static_reused_state'));
  const suspicious = all.filter((entry) => entry.signals.includes('suspicious_duplicate_sequence'));
  const sameFrameFallback = all.filter((entry) => entry.signals.includes('exact_duplicate_animation') && entry.states.some((state) => {
    const audit = variants.find((variant) => variant.character_id === entry.character_id && variant.variant_id === entry.variant_id)?.states[state];
    return audit?.fallback.used;
  }));
  const classifications = {};
  for (const duplicate of all) classifications[duplicate.classification] = (classifications[duplicate.classification] || 0) + 1;
  return {
    exact_duplicate_animations: exact.length,
    same_frame_fallbacks: sameFrameFallback.length,
    static_reused_states: staticReused.length,
    suspicious_duplicate_sequences: suspicious.length,
    intentional_duplicate_relations: all.filter((entry) => entry.intentional).length,
    unresolved_semantic_duplicates: all.filter((entry) => !entry.intentional).length,
    classifications: Object.fromEntries(Object.entries(classifications).sort(([left], [right]) => left.localeCompare(right))),
    details: all,
  };
}

function groupCounts(variants) {
  const counts = Object.fromEntries(Object.keys(REQUIRED_GROUPS).map((group) => [
    `${group}_complete`,
    variants.filter((variant) => variant.groups[group].complete).length,
  ]));
  counts.rest_sleep_complete = variants.filter((variant) => variant.groups.rest.complete && variant.groups.sleep.complete).length;
  return counts;
}

function originCounts(variants) {
  return variants.reduce((counts, variant) => ({
    source_animations: counts.source_animations + variant.counts.source_animation_sets,
    direct_runtime_animations: counts.direct_runtime_animations + variant.counts.direct,
    derived_animations: counts.derived_animations + variant.counts.derived,
    derived_animation_asset_sets: counts.derived_animation_asset_sets + variant.counts.derived_animation_sets,
    image2_generated_animations: counts.image2_generated_animations + variant.counts.generated,
    fallback_animations: counts.fallback_animations + variant.counts.fallback,
    derived_frames_total: counts.derived_frames_total + variant.derived_frames.total,
    derived_frames_referenced: counts.derived_frames_referenced + variant.derived_frames.referenced,
    derived_frames_unreferenced: counts.derived_frames_unreferenced + variant.derived_frames.unreferenced,
    derived_runtime_frames_referenced: counts.derived_runtime_frames_referenced + variant.derived_frames.runtime_referenced,
    derived_provenance_frames_declared: counts.derived_provenance_frames_declared + variant.derived_frames.provenance_declared,
    derived_provenance_frames_unreferenced: counts.derived_provenance_frames_unreferenced + variant.derived_frames.provenance_unreferenced,
    derived_frames_missing_provenance: counts.derived_frames_missing_provenance + variant.derived_frames.missing_provenance,
    derived_frames_invalid_provenance: counts.derived_frames_invalid_provenance + variant.derived_frames.invalid_provenance,
    derived_atlas_frames_untracked: counts.derived_atlas_frames_untracked + variant.derived_frames.untracked_atlas_frames,
  }), {
    source_animations: 0,
    direct_runtime_animations: 0,
    derived_animations: 0,
    derived_animation_asset_sets: 0,
    image2_generated_animations: 0,
    fallback_animations: 0,
    derived_frames_total: 0,
    derived_frames_referenced: 0,
    derived_frames_unreferenced: 0,
    derived_runtime_frames_referenced: 0,
    derived_provenance_frames_declared: 0,
    derived_provenance_frames_unreferenced: 0,
    derived_frames_missing_provenance: 0,
    derived_frames_invalid_provenance: 0,
    derived_atlas_frames_untracked: 0,
  });
}

function blankFrameCounts(variants) {
  return variants.reduce((counts, variant) => ({
    transparent_source_frames: counts.transparent_source_frames + variant.blank_frames.transparent,
    intentional_blank_source_frames: counts.intentional_blank_source_frames + variant.blank_frames.intentional,
    unexpected_transparent_source_frames: counts.unexpected_transparent_source_frames + variant.blank_frames.unexpected,
    invalid_intentional_blank_declarations: counts.invalid_intentional_blank_declarations + variant.blank_frames.invalid_declarations,
  }), {
    transparent_source_frames: 0,
    intentional_blank_source_frames: 0,
    unexpected_transparent_source_frames: 0,
    invalid_intentional_blank_declarations: 0,
  });
}

function transitionCounts(variants) {
  const initial = {
    total: 0,
    warnings: 0,
    warning_only: 0,
    severe: 0,
    intentional: 0,
    invalid_intentional_declarations: 0,
  };
  const summary = variants.reduce((counts, variant) => {
    for (const key of Object.keys(initial)) counts[key] += variant.transition_boundaries[key];
    return counts;
  }, { ...initial });
  summary.thresholds = TRANSITION_THRESHOLDS;
  summary.severe_details = variants.flatMap((variant) => variant.transition_boundaries.details
    .filter((transition) => transition.detected_severity === 'severe' && !transition.policy.intentional)
    .map((transition) => ({
      character_id: variant.character_id,
      variant_id: variant.variant_id,
      ...transition,
    })));
  return summary;
}

function transitionBridgeCounts(variants) {
  const summary = variants.reduce((counts, variant) => ({
    total: counts.total + variant.transition_bridges.total,
    invalid_structure: counts.invalid_structure + variant.transition_bridges.invalid_structure,
    endpoint_mismatches: counts.endpoint_mismatches + variant.transition_bridges.endpoint_mismatches,
    double_exposure_candidates: counts.double_exposure_candidates + variant.transition_bridges.double_exposure_candidates,
  }), { total: 0, invalid_structure: 0, endpoint_mismatches: 0, double_exposure_candidates: 0 });
  summary.problem_details = variants.flatMap((variant) => variant.transition_bridges.details
    .filter((bridge) => !bridge.structurally_valid || !bridge.endpoint_exact || bridge.double_exposure_candidates.length)
    .map((bridge) => ({ character_id: variant.character_id, variant_id: variant.variant_id, ...bridge })));
  return summary;
}

function validateCoverageShape(coverage) {
  if (coverage.total_character_variants !== coverage.variants.length) {
    throw new Error('animation coverage variant total does not match variant details');
  }
  if (coverage.animation_complete_variants + coverage.animation_partial_variants + coverage.static_only_variants !== coverage.total_character_variants) {
    throw new Error('animation coverage completion buckets do not add up');
  }
  for (const variant of coverage.variants) {
    if (!['animation-complete', 'animation-partial', 'static-only'].includes(variant.status)) {
      throw new Error(`${variant.character_id}:${variant.variant_id}: invalid animation coverage status`);
    }
    for (const [group, requiredStates] of Object.entries(REQUIRED_GROUPS)) {
      if (!variant.groups[group] || !Array.isArray(variant.groups[group].states)) {
        throw new Error(`${variant.character_id}:${variant.variant_id}: missing ${group} coverage group`);
      }
      if (requiredStates.some((state) => !variant.groups[group].states.includes(state))) {
        throw new Error(`${variant.character_id}:${variant.variant_id}: ${group} coverage omits a required state`);
      }
    }
    for (const [state, audit] of Object.entries(variant.states)) {
      if (!audit.source || !['direct', 'derived', 'generated'].includes(audit.provenance) ||
          !Number.isInteger(audit.frame_count) || !Number.isInteger(audit.unique_frame_count) ||
          audit.frame_count !== audit.core_frame_count || !Number.isInteger(audit.displayed_frame_count) ||
          !Number.isInteger(audit.transition_bridge_frame_count) ||
          audit.displayed_frame_count !== audit.core_frame_count + audit.transition_bridge_frame_count ||
          !(audit.duration_seconds > 0) || !['loop', 'once', 'once-hold-last'].includes(audit.loop_mode) ||
          typeof audit.fallback?.used !== 'boolean' || typeof audit.visual_uniqueness?.unique !== 'boolean') {
        throw new Error(`${variant.character_id}:${variant.variant_id}:${state}: incomplete animation audit record`);
      }
    }
    if (!variant.transition_boundaries || !Number.isInteger(variant.transition_boundaries.total) ||
        variant.transition_boundaries.total !== variant.transition_boundaries.details.length) {
      throw new Error(`${variant.character_id}:${variant.variant_id}: transition boundary audit is incomplete`);
    }
    if (!variant.transition_bridges || !Number.isInteger(variant.transition_bridges.total) ||
        variant.transition_bridges.total !== variant.transition_bridges.details.length) {
      throw new Error(`${variant.character_id}:${variant.variant_id}: transition bridge audit is incomplete`);
    }
    if (!variant.derived_frames || variant.derived_frames.total !== variant.derived_frames.referenced + variant.derived_frames.unreferenced ||
        !Number.isInteger(variant.derived_frames.missing_provenance) ||
        !Number.isInteger(variant.derived_frames.provenance_unreferenced) ||
        !Number.isInteger(variant.derived_frames.untracked_atlas_frames)) {
      throw new Error(`${variant.character_id}:${variant.variant_id}: derived-frame usage audit is incomplete`);
    }
    if (!variant.blank_frames || variant.blank_frames.transparent !== variant.blank_frames.intentional + variant.blank_frames.unexpected ||
        !Number.isInteger(variant.blank_frames.invalid_declarations)) {
      throw new Error(`${variant.character_id}:${variant.variant_id}: transparent-frame provenance audit is incomplete`);
    }
  }
  for (const duplicate of coverage.duplicate_detection.details) {
    if (!Array.isArray(duplicate.states) || duplicate.states.length !== 2 || !Array.isArray(duplicate.signals) || duplicate.signals.length === 0) {
      throw new Error('duplicate audit record is incomplete');
    }
  }
}

async function main() {
  const roster = await readJson(ROSTER_PATH);
  const generated = await readJson(GENERATED_PATH, false);
  const selectedCharacter = option('--character');
  const selectedVariant = option('--variant', option('--skin'));
  if (selectedVariant && !selectedCharacter) throw new Error('--variant/--skin requires --character');
  const work = [];
  for (const character of roster.characters) {
    if (selectedCharacter && character.character_id !== selectedCharacter) continue;
    for (const variant of character.variants) {
      if (variant.status !== 'source-available') continue;
      const id = variantId(variant);
      if (selectedVariant && id !== selectedVariant && variant.skin_id !== selectedVariant) continue;
      work.push({ character, variant, id });
    }
  }
  if (!work.length) throw new Error('no roster variants match the requested filters');
  const concurrency = Number(option('--concurrency', '4'));
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error('--concurrency must be an integer from 1 to 16');
  }
  const variants = new Array(work.length);
  let cursor = 0;
  async function worker() {
    while (cursor < work.length) {
      const index = cursor++;
      const { character, variant, id } = work[index];
      const manifestFile = path.join(RUNTIME_ROOT, character.character_id, id, 'manifest.json');
      const cleanedFile = path.join(CLEANED_ROOT, character.character_id, id, 'manifest.json');
      const [manifest, cleanedManifest] = await Promise.all([
        readJson(manifestFile),
        readJson(cleanedFile, false),
      ]);
      const audit = await auditVariant({ manifest, manifestFile, cleanedManifest });
      variants[index] = {
        character_id: character.character_id,
        character_name: character.character_name,
        localized_name: character.localized_name,
        variant_id: id,
        variant_type: variant.variant_type,
        skin_id: variant.skin_id || null,
        skin_name: variant.skin_name || null,
        runtime_manifest: relative(manifestFile),
        ...audit,
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, () => worker()));
  const duplicates = duplicateSummary(variants);
  const selectedIdentities = selectedCharacter
    ? new Set(variants.map((variant) => `${variant.character_id}/${variant.variant_id}`))
    : null;
  const generatedCounts = generatedSummary(generated, selectedIdentities);
  const reconciliation = await rosterReconciliation(roster);
  const coverage = {
    schema_version: 1,
    generated_on: new Date().toISOString().slice(0, 10),
    roster_source: relative(ROSTER_PATH),
    runtime_source: 'standalone/assets/runtime/<character>/<variant>/manifest.json',
    completion_definition: {
      required_groups: REQUIRED_GROUPS,
      minimum_frames: STATE_THRESHOLDS,
      rules: [
        'Every required state must meet its core (non-transition-bridge) frame and visually-unique visible-frame minimum.',
        'Transition-bridge suffix frames are audited separately and never contribute to core frame-count or uniqueness completeness.',
        'Every transparent source frame requires an explicit canonical cleaned-manifest intentional_blank_frames declaration with a concrete reason.',
        'A semantic fallback (for example special -> Interact or sleep -> Relax) is incomplete.',
        'A semantic duplicate impairs the fallback state; if neither side is a fallback, it impairs both states.',
        'Directional mirrors, intentional reverse transitions, and timing-only run/walk relations are audited but do not impair completeness.',
        'Every declared state->next boundary is measured by ground anchor, bounding-box center, alpha-mask IoU, and mean absolute RGBA difference.',
        'Warning transition boundaries remain review findings; severe unexplained boundaries make the source state and variant incomplete.',
        'Derived transition bridges must have valid provenance, end on the next state exact pixels, and contain no double-exposure geometry.',
        'Derived frame coverage is bidirectional: every runtime-referenced derived frame has provenance and every provenance frame is referenced by runtime.',
        'An intentionalCut or teleport declaration is accepted only when the manifest provides a concrete reason.',
        'A variant is static-only only when every present required state contains at most one visually unique frame.',
      ],
    },
    total_character_variants: variants.length,
    animation_complete_variants: variants.filter((variant) => variant.status === 'animation-complete').length,
    animation_partial_variants: variants.filter((variant) => variant.status === 'animation-partial').length,
    static_only_variants: variants.filter((variant) => variant.status === 'static-only').length,
    ...groupCounts(variants),
    ...originCounts(variants),
    ...blankFrameCounts(variants),
    ...generatedCounts,
    transition_boundaries: transitionCounts(variants),
    transition_bridges: transitionBridgeCounts(variants),
    exact_duplicate_fallback_states_remaining: duplicates.same_frame_fallbacks,
    duplicate_detection: duplicates,
    roster_reconciliation: reconciliation,
    variants,
    incomplete_variants: variants.filter((variant) => variant.status !== 'animation-complete').map((variant) => ({
      character_id: variant.character_id,
      variant_id: variant.variant_id,
      status: variant.status,
      incomplete_groups: Object.entries(variant.groups).filter(([, group]) => !group.complete).map(([group]) => group),
      incomplete_states: Object.values(variant.states).filter((state) => !state.complete).map((state) => ({
        state: state.state,
        issues: state.issues,
      })),
      variant_issues: variant.issues || [],
    })),
  };
  validateCoverageShape(coverage);
  const requestedOutput = option('--write');
  const output = requestedOutput
    ? path.resolve(ROOT, requestedOutput)
    : selectedCharacter ? null : OUTPUT_PATH;
  if (output) {
    if (output !== ROOT && !output.startsWith(`${ROOT}${path.sep}`)) throw new Error('--write must stay inside the repository');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(coverage, null, 2)}\n`);
  }
  console.log(`animation coverage: complete ${coverage.animation_complete_variants}/${coverage.total_character_variants}, partial ${coverage.animation_partial_variants}, static-only ${coverage.static_only_variants}`);
  console.log(`animation origins: source ${coverage.source_animations}, derived ${coverage.derived_animations}, image2 ${coverage.image2_generated_animations}, fallback ${coverage.fallback_animations}`);
  console.log(`duplicates: exact ${duplicates.exact_duplicate_animations}, fallback ${duplicates.same_frame_fallbacks}, suspicious ${duplicates.suspicious_duplicate_sequences}`);
  console.log(`transparent source frames: intentional ${coverage.intentional_blank_source_frames}, unexpected ${coverage.unexpected_transparent_source_frames}, invalid declarations ${coverage.invalid_intentional_blank_declarations}`);
  console.log(`derived frame provenance: runtime ${coverage.derived_runtime_frames_referenced}, declared ${coverage.derived_provenance_frames_declared}, missing ${coverage.derived_frames_missing_provenance}, unreferenced ${coverage.derived_provenance_frames_unreferenced}`);
  console.log(`rosters: Codex ${reconciliation.codex_roster}, standalone ${reconciliation.standalone_official_roster}, explained=${reconciliation.explained}`);
  console.log(output ? `wrote ${relative(output)}` : 'selection report not persisted (pass --write to keep it)');
  if (flag('--require-roster-reconciled') && !reconciliation.explained) {
    throw new Error('Codex/standalone roster difference is not reconciled');
  }
  if ((flag('--require-animation-complete') || flag('--require-complete')) && coverage.animation_complete_variants !== coverage.total_character_variants) {
    throw new Error(`${coverage.animation_partial_variants + coverage.static_only_variants} variant(s) are not animation-complete`);
  }
}

main().catch((error) => {
  console.error(`standalone animation coverage: ${error.message}`);
  process.exitCode = 1;
});
