/**
 * Diagnostic Provider - Provides real-time validation for Teloce templates
 */

import * as vscode from 'vscode';
import { getDiagnostics, type Diagnostic } from '@teloce/language-service';
import { isComponentDocument } from '../documents.js';

export class TeloceDiagnosticProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;
  /** One pending validation per document, so editing file B doesn't cancel file A's. */
  private timers = new Map<string, NodeJS.Timeout>();
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('teloce');
  }

  /** `teloce.validate.enable` (on by default). */
  private get enabled(): boolean {
    return vscode.workspace.getConfiguration('teloce.validate').get<boolean>('enable', true) !== false;
  }

  /**
   * Validates a document and publishes the results. Only Teloce components
   * are validated: `.vel` files and component-style `.html` files, never page
   * shells. `force` runs even when the setting is off (the explicit
   * "Teloce: Validate" command).
   */
  async provideDiagnostics(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
    force = false
  ): Promise<vscode.Diagnostic[]> {
    if (!isComponentDocument(document)) {
      this.diagnosticCollection.delete(document.uri);
      return [];
    }
    if (!force && !this.enabled) {
      this.diagnosticCollection.delete(document.uri);
      return [];
    }

    try {
      const content = document.getText();
      const diagnostics = getDiagnostics(content, document.uri.toString());
      const vsCodeDiagnostics = diagnostics.map(d => this.convertDiagnostic(d, document));
      
      this.diagnosticCollection.set(document.uri, vsCodeDiagnostics);
      return vsCodeDiagnostics;
    } catch (error) {
      console.error('Diagnostic error:', error);
      return [];
    }
  }

  private convertDiagnostic(
    diagnostic: Diagnostic,
    document: vscode.TextDocument
  ): vscode.Diagnostic {
    const severity = this.convertSeverity(diagnostic.severity);
    const range = new vscode.Range(
      new vscode.Position(diagnostic.range.start.line, diagnostic.range.start.character),
      new vscode.Position(diagnostic.range.end.line, diagnostic.range.end.character)
    );

    const vsDiagnostic = new vscode.Diagnostic(
      range,
      diagnostic.message,
      severity
    );

    vsDiagnostic.code = diagnostic.code;
    vsDiagnostic.source = diagnostic.source || 'teloce';

    if (diagnostic.fix) {
      vsDiagnostic.relatedInformation = [
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(document.uri, range),
          `💡 Fix: ${diagnostic.fix}`
        )
      ];
    }

    return vsDiagnostic;
  }

  private convertSeverity(severity: string): vscode.DiagnosticSeverity {
    const map: Record<string, vscode.DiagnosticSeverity> = {
      error: vscode.DiagnosticSeverity.Error,
      warning: vscode.DiagnosticSeverity.Warning,
      info: vscode.DiagnosticSeverity.Information,
      hint: vscode.DiagnosticSeverity.Hint,
    };
    // `??` not `||`: DiagnosticSeverity.Error is 0, which is falsy.
    return map[severity] ?? vscode.DiagnosticSeverity.Information;
  }

  startMonitoring() {
    const d = this.disposables;

    // Everything already open (not just the active editor)
    for (const document of vscode.workspace.textDocuments) {
      this.scheduleDiagnostics(document, 0);
    }
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && !vscode.workspace.textDocuments.includes(activeEditor.document)) {
      this.scheduleDiagnostics(activeEditor.document, 0);
    }

    d.push(
      vscode.workspace.onDidChangeTextDocument((event) => this.scheduleDiagnostics(event.document)),
      vscode.workspace.onDidOpenTextDocument((document) => this.scheduleDiagnostics(document)),
      vscode.workspace.onDidSaveTextDocument((document) => this.scheduleDiagnostics(document)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.cancel(document);
        this.diagnosticCollection.delete(document.uri);
      }),
      // Turning validation on/off applies straight away
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('teloce.validate')) return;
        for (const document of vscode.workspace.textDocuments) this.scheduleDiagnostics(document, 0);
      })
    );
  }

  private cancel(document: vscode.TextDocument) {
    const key = document.uri.toString();
    const pending = this.timers.get(key);
    if (pending) clearTimeout(pending);
    this.timers.delete(key);
  }

  private scheduleDiagnostics(document: vscode.TextDocument, delay = 500) {
    if (!isComponentDocument(document) && !this.diagnosticCollection.has(document.uri)) return;
    this.cancel(document);
    this.timers.set(
      document.uri.toString(),
      setTimeout(() => {
        this.timers.delete(document.uri.toString());
        void this.provideDiagnostics(document, new vscode.CancellationTokenSource().token);
      }, delay)
    );
  }

  dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const d of this.disposables.splice(0)) d.dispose();
    this.diagnosticCollection.dispose();
  }
}
