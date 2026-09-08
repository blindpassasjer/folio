# Changelog

All notable changes to Gigboy are documented here. The version shown in the
footer comes from `package.json`, injected at build time.

This project uses [semantic versioning](https://semver.org/) loosely while
pre-1.0: minor bumps for features, patch bumps for fixes.

## [Unreleased]

## [0.1.1] - 2026-09-08

Design system and cleanup pass. No changes to features or data.

### Changed
- Moved the version number under the footer tagline.
- Login page: dropped the animated backdrop decoration (glows, rings,
  sparks, grid); the drifting music notes remain, calmer, and now respect
  `prefers-reduced-motion`.
- Page-header borders unified — list/setlist headers now match the plain
  border used elsewhere instead of an accent-tinted one.
- Small UI labels are no longer set in all caps.
- Buttons are consolidated onto one style vocabulary; non-primary buttons
  no longer carry a faint accent drop-shadow.

### Fixed
- Pill-shaped controls rendered with square corners after a token change
  collided with a Radix Themes variable.

### Internal
- Removed ~1,700 lines of dead CSS and two unused self-hosted webfonts.
- `border-radius` and elevation now run through a small token scale.
- Added a shared `Button` component and folded the ad-hoc button classes
  into it.
- `npm run dev:demo` runs the app against the in-browser demo backend with
  a login screen — no database needed for local UI work.

## [0.1.0] - 2026-09-07

- First tracked version. Introduces a visible version number (footer) and
  this changelog. No functional change to existing features.
