# Patchwork Theme

The theme uses the retained GitHub Theme stylesheet without additional visual
customizations. Its installation name remains Patchwork for compatibility.

## Sources

- `github.theme.css`: the original retained GitHub Theme stylesheet, unchanged.
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
