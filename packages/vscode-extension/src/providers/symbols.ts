/**
 * Symbol Provider - Provides document symbols for Teloce templates
 */

import * as vscode from 'vscode';
import { isComponentDocument } from '../documents.js';

export class TeloceSymbolProvider implements vscode.DocumentSymbolProvider {
  async provideDocumentSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentSymbol[]> {
    if (!isComponentDocument(document)) return [];
    const content = document.getText();
    const symbols: vscode.DocumentSymbol[] = [];

    // Find component definitions
    const componentRegex = /export\s+default\s+{\s*name:\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = componentRegex.exec(content)) !== null) {
      const name = match[1];
      const range = new vscode.Range(
        document.positionAt(match.index),
        document.positionAt(match.index + match[0].length)
      );
      
      const symbol = new vscode.DocumentSymbol(
        name,
        'Component',
        vscode.SymbolKind.Class,
        range,
        range
      );
      symbols.push(symbol);
    }

    // Find data properties
    const dataRegex = /data\s*\(\s*\)\s*{\s*return\s*{([^}]+)}/g;
    while ((match = dataRegex.exec(content)) !== null) {
      const props = match[1].trim().split(',').map(p => p.trim().split(':')[0]).filter(Boolean);
      for (const prop of props) {
        const range = new vscode.Range(
          document.positionAt(match.index + match[0].indexOf(prop)),
          document.positionAt(match.index + match[0].indexOf(prop) + prop.length)
        );
        const symbol = new vscode.DocumentSymbol(
          prop,
          'Data property',
          vscode.SymbolKind.Property,
          range,
          range
        );
        symbols.push(symbol);
      }
    }

    // Find methods
    const methodRegex = /(\w+)\s*\(\s*\)\s*{/g;
    while ((match = methodRegex.exec(content)) !== null) {
      const name = match[1];
      const range = new vscode.Range(
        document.positionAt(match.index),
        document.positionAt(match.index + match[0].length)
      );
      const symbol = new vscode.DocumentSymbol(
        name,
        'Method',
        vscode.SymbolKind.Method,
        range,
        range
      );
      symbols.push(symbol);
    }

    return symbols;
  }
}