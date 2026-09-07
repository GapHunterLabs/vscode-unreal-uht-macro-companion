/**
 * Pure logic -- no `vscode` dependency. New niche, not a port.
 *
 * v0.1 scope, deliberately narrow: text/regex checks over a C++
 * header for a handful of well-documented UnrealHeaderTool (UHT)
 * mistakes -- NOT an attempt to replicate UHT's real C++ parsing.
 * Evidence for this niche: "while JetBrains Rider integrates
 * seamlessly with UnrealHeaderTool... this integration is not found
 * in VS Code" (per the original niche research). Three checks, each
 * verified against Epic's own official documentation (WebSearch,
 * 2026-09-07), not assumed from memory:
 *
 * 1. A file using UCLASS()/USTRUCT()/UENUM() needs an `#include` of
 *    its own "<basename>.generated.h" -- confirmed against Epic's
 *    "Objects in Unreal Engine" docs (a basic UObject header includes
 *    its own generated header).
 * 2. A UCLASS()/USTRUCT() body needs GENERATED_BODY() (or the older
 *    GENERATED_UCLASS_BODY()/GENERATED_USTRUCT_BODY()) -- a hard UHT
 *    compile requirement, described across Epic's reflection-system
 *    docs.
 * 3. A raw pointer member to a UObject-derived type (Unreal naming
 *    convention: a type name prefixed with U or A) inside such a body, with no
 *    preceding UPROPERTY() macro, risks the garbage collector
 *    silently invalidating it -- confirmed against Epic's own "Object
 *    Pointers in Unreal Engine" docs: "An Object reference stored in
 *    a raw pointer will be unknown to the Unreal Engine, and will not
 *    be automatically nulled, nor will it prevent garbage collection."
 *
 * Not checked (deliberately, v0.1): include *ordering* relative to
 * other includes -- searched for evidence of a strict "must be last"
 * UHT requirement and did not find primary-source confirmation, so
 * it's left out rather than asserted.
 */

export interface UhtFinding {
  kind: 'missing-generated-include' | 'missing-generated-body' | 'unprotected-uobject-pointer';
  detail: string; // class/struct name, or pointer declaration text
  line: number; // 1-based
}

const REFLECTION_MACRO = /\b(UCLASS|USTRUCT|UENUM)\s*\(/;
const GENERATED_MACRO = /\bGENERATED_(BODY|UCLASS_BODY|USTRUCT_BODY)\s*\(\s*\)/;
// Combines the reflection macro and the class/struct declaration into
// one match -- deliberately, so a plain (non-reflected) class or
// struct elsewhere in the same file is never mistaken for a UHT type
// just because the file happens to use UCLASS/USTRUCT somewhere else.
// UCLASS/USTRUCT args (e.g. "BlueprintType, Blueprintable") are plain
// comma-separated identifiers with no nested parens, so `[^)]*` is
// safe here.
const REFLECTED_CLASS_OR_STRUCT_DECL = /\b(?:UCLASS|USTRUCT)\s*\([^)]*\)\s*(class|struct)\s+(?:\w+_API\s+)?(\w+)\b[^{;]*\{/g;
// Unreal naming convention: U-prefixed = UObject-derived, A-prefixed = AActor-derived (a UObject subclass).
// Requires the pointer+identifier to be immediately followed by `;` so
// function parameters/returns (which have `(`/`)` in between) don't match.
const RAW_UOBJECT_POINTER_MEMBER = /\b([UA]\w+)\s*\*\s*(\w+)\s*;/g;

/** Strips `//` and `/* *\/` comments, replacing removed characters
 * with spaces (never removing newlines) so line numbers computed
 * afterward still line up with the original source. */
function stripComments(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') {
        result += ' ';
        i++;
      }
    } else if (text[i] === '/' && text[i + 1] === '*') {
      result += '  ';
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        result += text[i] === '\n' ? '\n' : ' ';
        i++;
      }
      result += '  ';
      i += 2;
    } else {
      result += text[i];
      i++;
    }
  }
  return result;
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

/** Finds the index just after the `{` matching the one at `openIndex`,
 * i.e. the index of the corresponding `}` -- scans by character
 * position across the whole text (not line-by-line), so a brace
 * sharing a line with other content is still tracked correctly. */
function findMatchingCloseBrace(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1; // unbalanced -- malformed or truncated input
}

export function findUhtIssues(fileBaseName: string, rawText: string): UhtFinding[] {
  const findings: UhtFinding[] = [];
  const usesReflection = REFLECTION_MACRO.test(rawText);
  if (!usesReflection) return findings; // not an Unreal reflection header -- nothing to check

  const expectedInclude = new RegExp(`#include\\s+["<]${fileBaseName}\\.generated\\.h[">]`);
  if (!expectedInclude.test(rawText)) {
    findings.push({ kind: 'missing-generated-include', detail: `${fileBaseName}.generated.h`, line: 1 });
  }

  const text = stripComments(rawText);

  for (const match of text.matchAll(REFLECTED_CLASS_OR_STRUCT_DECL)) {
    const declEndIndex = match.index + match[0].length; // just past the opening '{'
    const openBraceIndex = declEndIndex - 1;
    const closeBraceIndex = findMatchingCloseBrace(text, openBraceIndex);
    if (closeBraceIndex === -1) continue; // malformed/truncated -- skip rather than guess
    const name = match[2];
    const body = text.slice(openBraceIndex + 1, closeBraceIndex);
    const bodyStartLine = lineNumberAt(text, openBraceIndex);

    if (!GENERATED_MACRO.test(body)) {
      findings.push({ kind: 'missing-generated-body', detail: name, line: bodyStartLine });
    }

    const bodyLines = body.split('\n');
    for (const memberMatch of body.matchAll(RAW_UOBJECT_POINTER_MEMBER)) {
      const [, typeName, fieldName] = memberMatch;
      if (typeName === 'UPROPERTY' || typeName === 'UFUNCTION') continue; // not a type name -- avoids self-matching the macro's own text
      const lineInBody = body.slice(0, memberMatch.index).split('\n').length - 1; // 0-based index into bodyLines
      let precedingLine = '';
      for (let li = lineInBody - 1; li >= 0; li--) {
        const trimmed = bodyLines[li].trim();
        if (trimmed.length > 0) {
          precedingLine = trimmed;
          break;
        }
      }
      if (!precedingLine.startsWith('UPROPERTY')) {
        findings.push({
          kind: 'unprotected-uobject-pointer',
          detail: `${typeName}* ${fieldName}`,
          line: bodyStartLine + lineInBody,
        });
      }
    }
  }

  return findings;
}
