# Patchwork Theme

Patchwork is based on the retained GitHub Theme stylesheet. The installation
name and Style Settings heading are Patchwork. Upstream setting identifiers
remain unchanged to preserve existing preferences.

## Sources

- `patchwork.css`: the GitHub-derived stylesheet with Patchwork branding.
- `src/theme.scss`: the minimal entry point required by the existing packager.
- `manifest.json`, `versions.json`, and `package.psd1`: installation metadata.

The previous Maple-derived modules, embedded Maple Mono fonts, Islands Dark
adaptation, and baseline image have been removed. Companion plugins remain
independent and retain their own styles. The original GitHub stylesheet also
retains its upstream optional plugin styling.

The GitHub Theme MIT attribution is preserved in the repository root `LICENSE`.

## Packaging

When theme build and deployment are explicitly requested, use the existing
installer from the repository root:

```powershell
npm run build -- -ThemeOnly
```

This packages and installs the theme only. Source cleanup does not update an
already installed theme or remove previously generated distribution files.
