# Unreal UHT Macro Companion (VS Code)

Flags common UnrealHeaderTool (UHT) macro mistakes in Unreal Engine
C++ headers — as you type, no build required.

**v0.1, new niche.** Not a port from the Gap Hunter Labs IntelliJ-
family catalog. Evidence, from the original research into VS Code's
Unreal Engine support: *"while JetBrains Rider integrates seamlessly
with UnrealHeaderTool… this integration is not found in VS Code. This
appears to be a significant limitation of VS Code compared to other
IDEs for Unreal Engine development."*

**Deliberately narrow scope**: this does not attempt to replicate UHT
itself (that would need a real C++ parser). It's three well-documented,
text-checkable mistakes — verified against Epic's own official
documentation, not assumed from memory (see the citations at the top
of `src/uhtChecker.ts`):

1. **Missing `.generated.h` include.** A header using `UCLASS()`/
   `USTRUCT()`/`UENUM()` needs `#include "<FileName>.generated.h"` —
   without it, UHT fails to compile the header at all.
2. **Missing `GENERATED_BODY()`.** A reflected class/struct body needs
   `GENERATED_BODY()` (or the older `GENERATED_UCLASS_BODY()` /
   `GENERATED_USTRUCT_BODY()`) — another hard compile requirement.
3. **Unprotected `UObject`-derived raw pointer members.** A pointer
   member whose type follows Unreal's `U`/`A` naming convention, with
   no preceding `UPROPERTY()`, is invisible to the garbage collector —
   per Epic's own docs: *"An Object reference stored in a raw pointer
   will be unknown to the Unreal Engine, and will not be automatically
   nulled, nor will it prevent garbage collection."* This is a warning,
   not an error — it compiles fine, but risks a dangling-pointer crash
   at runtime.

## What it does

Lints every open `.h`/`.c`/`.cpp`-language header as you type (300ms
debounce) and reports findings as regular Problems-panel diagnostics —
errors for the two compile-blocking mistakes, a warning for the
unprotected-pointer risk.

## v0.1 scope, honestly noted

- **Text/regex analysis, not real C++ parsing.** A member declared via
  a macro (`TArray<UObject*>`, arrays, etc.) or through preprocessor
  conditionals isn't recognized — only a direct `Type* name;` pattern
  is.
- **Include *presence*, not *ordering*.** Checked for primary-source
  evidence of a strict "`.generated.h` must be the last include" rule
  and didn't find one to confirm — so only presence of the include is
  checked, not where it sits relative to other includes.
- Comments (`//` and `/* */`) are stripped before scanning member
  declarations, but a macro that expands to a pointer declaration
  isn't seen through.

## Development

```bash
npm install
npm run compile   # or: npm run watch
npm test
```

To build an installable package without publishing:

```bash
npx @vscode/vsce package
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
