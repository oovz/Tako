# Dependency patches

`istanbul-lib-source-maps@5.0.6.patch` applies the range-end fix shipped by
[Vitest 4.1.10](https://github.com/vitest-dev/vitest/blob/v4.1.10/patches/istanbul-lib-source-maps.patch)
from [upstream PR 837](https://github.com/istanbuljs/istanbuljs/pull/837).
It resolves generated ranges whose closing lines have no mapping by finding
the preceding mapped line. This keeps compiled TSX statement and function coverage
and browser coverage aligned with the runtime Istanbul profile.

The patch contains only the published `lib/get-mapping.js` change and provenance
comment. The dependency's BSD notices remain intact.

Remove this patch after an upstream release includes PR 837 and the compiled TSX
range regression in `tests/unit/tooling/coverage-source-map.spec.js` passes with
the unpatched release.
