# Character registry

`operators.json` is the checked-in source of truth for playable operator builds. It is compiled from the sources and scope in `sources.json`; the separate Priestess definition is the project's preserved regression baseline.

Each entry contains stable source identifiers, names, implementation state, renderer selection, a human-auditable `visual_signature`, and the hair/face/outfit/palette/species/equipment/directional data consumed by the renderer. Source portraits are temporary analysis inputs only and are never copied into this repository or into generated pets.

To reproduce a registry refresh from locally retrieved source inputs:

```bash
python3 scripts/registry/compile-roster.py \
  --index-html /tmp/prts-operators.html \
  --character-table /tmp/arknights-character-table-current.json \
  --portraits /tmp/arknights-avatar-refs \
  --output characters/registry/operators.json
```

The compiler fails if any indexed operator lacks a game-data mapping or visual-analysis input. A refresh must update the retrieval date and normalization counts in `sources.json`, then pass the full build and validation suite.
