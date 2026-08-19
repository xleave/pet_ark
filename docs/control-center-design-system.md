# PET ARK Control Center Design System

The control center uses one industrial visual contract. All new pages, fleet cards, interaction settings, and reusable controls must consume tokens from `control-center/src/design-tokens.css`; page styles must not introduce raw color values, control heights, motion durations, or new corner geometry.

## Visual language

- **Shape:** square, clipped, mechanical geometry. Rounded white browser-native controls are not part of the product language.
- **Hierarchy:** charcoal surfaces, thin steel borders, warm yellow for deliberate actions and exact values, cyan for live/connected state, red only for destructive or failed state.
- **Typography:** Noto Sans SC for readable UI text, Barlow Condensed for telemetry and display labels, the centralized mono stack for logs and identifiers.
- **Motion:** fast feedback uses `--motion-fast`, ordinary transitions use `--motion-standard`, and page entry uses `--motion-page`. Reduced-motion remains mandatory.
- **Density:** exact numeric entry always accompanies a range control. A slider is a shortcut, never the only input mechanism.

## Token ownership

`design-tokens.css` is the only source of truth for:

- raw palette and semantic surface/content/status colors;
- spacing scale and standard control heights;
- focus treatment, border widths, and industrial clipping;
- timing and easing;
- reusable translucent overlays and shadows.

`styles.css` owns composition and component recipes. `App.svelte` owns state and accessible markup. A future extracted component may add local layout CSS, but it still references the same semantic tokens.

`npm run check:design` enforces the contract by rejecting raw colors and motion durations outside the token file.

## Reusable control rules

1. Interactive elements expose an accessible name and a visible focus state.
2. Browser-native chrome is reset when it conflicts with the visual contract, then rebuilt with keyboard behavior preserved.
3. Disabled state is functional, not decorative; status colors cannot be the only carrier of meaning.
4. Fleet/multi-pet UI represents each running pet as an instance card with the same status vocabulary as the overview, rather than inventing another control style.
5. Desktop-integration permissions are shown as explicit capabilities (observe windows, react to focus, portal-controlled input), not a single ambiguous “interaction” switch.
