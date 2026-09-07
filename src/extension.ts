import * as vscode from 'vscode';
import * as path from 'path';
import { findUhtIssues, type UhtFinding } from './uhtChecker';

function messageFor(finding: UhtFinding): string {
  switch (finding.kind) {
    case 'missing-generated-include':
      return `Unreal UHT Macro Companion: file uses UCLASS/USTRUCT/UENUM but does not #include "${finding.detail}" -- UHT will fail to compile this header.`;
    case 'missing-generated-body':
      return `Unreal UHT Macro Companion: "${finding.detail}" is reflected (UCLASS/USTRUCT) but has no GENERATED_BODY() -- UHT will fail to compile this header.`;
    case 'unprotected-uobject-pointer':
      return `Unreal UHT Macro Companion: raw pointer "${finding.detail}" to a UObject-derived type has no preceding UPROPERTY() -- the garbage collector cannot see it and may leave it dangling.`;
  }
}

function severityFor(finding: UhtFinding): vscode.DiagnosticSeverity {
  return finding.kind === 'unprotected-uobject-pointer' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error;
}

function lintDocument(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
  if (document.languageId !== 'cpp' && document.languageId !== 'c') return;
  if (!document.fileName.toLowerCase().endsWith('.h')) return; // UHT reflection only applies to headers

  const baseName = path.basename(document.fileName, path.extname(document.fileName));
  const findings = findUhtIssues(baseName, document.getText());
  const diagnostics = findings.map((finding) => {
    const line = Math.min(finding.line - 1, Math.max(document.lineCount - 1, 0));
    const range = document.lineAt(Math.max(line, 0)).range;
    const diagnostic = new vscode.Diagnostic(range, messageFor(finding), severityFor(finding));
    diagnostic.source = 'Unreal UHT Macro Companion';
    return diagnostic;
  });
  collection.set(document.uri, diagnostics);
}

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('unrealUhtMacroCompanion');
  context.subscriptions.push(collection);

  const lintAndDebounce = (() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    return (document: vscode.TextDocument) => {
      const key = document.uri.toString();
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          lintDocument(document, collection);
        }, 300)
      );
    };
  })();

  for (const document of vscode.workspace.textDocuments) lintDocument(document, collection);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => lintDocument(document, collection)),
    vscode.workspace.onDidChangeTextDocument((event) => lintAndDebounce(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => collection.delete(document.uri))
  );
}

export function deactivate(): void {
  // no-op: the debounce timers above are short-lived (300ms) and harmless if the extension host tears down mid-flight; the diagnostic collection itself is disposed via context.subscriptions
}
