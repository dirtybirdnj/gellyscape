# Security Policy

## Reported Vulnerabilities

### Current Status

The `npm audit` report shows 4 vulnerabilities (2 moderate, 2 high) in the dependency tree:

- **braces** <3.0.3 (High severity)
- **micromatch** <=4.0.7 (Depends on vulnerable braces)
- **webpack** 4.0.0-alpha.0 - 5.0.0-rc.6 (Depends on vulnerable micromatch)
- **terser-webpack-plugin** <=2.2.1 (Depends on vulnerable webpack)

### Risk Assessment: LOW

These vulnerabilities are in **Electron's build-time dependencies**, not in our application's runtime code. Specifically:

1. **webpack** and **terser-webpack-plugin** are only used during Electron's build process
2. These packages are **not executed** when the application runs
3. They are **not exposed** to user input or network requests
4. The vulnerabilities relate to resource consumption during build/compilation, not runtime exploits

### Why These Are Low Risk

#### braces vulnerability (GHSA-grv7-fg5c-xmjg)
- **Type**: Uncontrolled resource consumption
- **Impact**: Could cause high CPU usage during glob pattern matching
- **Context**: Only used by webpack during build time
- **Runtime exposure**: None - webpack doesn't run when the app is used

#### Transitive Dependencies
The other three packages (micromatch, webpack, terser-webpack-plugin) depend on braces and inherit the same build-time-only limitation.

### Production Dependencies

Our production dependencies are clean:
- **pdf-lib** - PDF manipulation
- **pdf-parse** - PDF parsing
- **proj4** - Coordinate transformations
- **georaster** - Raster data handling
- **geotiff** - GeoTIFF support

None of these have reported vulnerabilities.

### Electron Security

Electron itself is actively maintained and receives regular security updates. The version we're using (^38.4.0) is current and secure.

Our implementation follows Electron security best practices:
- ✅ Context isolation enabled
- ✅ Node integration disabled in renderer
- ✅ Secure IPC communication via contextBridge
- ✅ No arbitrary code execution from user input
- ✅ File system access properly sandboxed

## Mitigation Strategy

While these vulnerabilities pose minimal risk, we can address them when:

1. **Electron updates its dependencies** - The next Electron release may include updated webpack/terser versions
2. **Network connectivity improves** - Current network issues prevent running `npm audit fix`
3. **Breaking changes are acceptable** - `npm audit fix --force` could update packages but may introduce breaking changes

## Reporting Security Issues

If you discover a security vulnerability in GellyScape itself (not transitive dependencies), please:

1. **Do NOT** open a public GitHub issue
2. Email the maintainers directly
3. Provide detailed information about the vulnerability
4. Allow reasonable time for a fix before public disclosure

## Security Best Practices for Users

When using GellyScape:

1. **Only process trusted PDF files** - Don't open PDFs from unknown sources
2. **Keep the application updated** - Install updates when available
3. **Review exported data** - Verify exported files before sharing
4. **Use in secure environment** - Run on systems with up-to-date OS and antivirus

## Update Policy

We monitor security advisories and will:
- Update dependencies when patches are available
- Release security updates promptly for critical vulnerabilities
- Notify users of security-related releases
- Follow Electron's security update schedule

---

**Last Updated**: 2025-10-22
**Next Review**: Upon next dependency update or Electron version bump
