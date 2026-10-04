/**
 * Which documents are Teloce components?
 *
 * - `.vel` / `.teloce` files (language id `teloce`) always are.
 * - `.html` files only are when they are component-style: a top-level
 *   `<template>` or a `<script lang="ts">`, and not a full page
 *   (`<!doctype>`, `<html>`, `<head>`, `<body>`). Flask/Django page templates
 *   are therefore never touched by this extension.
 */

import type * as vscode from 'vscode';
import { isTeloceComponent } from './typescript/blocks.js';

type DocumentLike = Pick<vscode.TextDocument, 'languageId' | 'getText'> & {
  uri: Pick<vscode.Uri, 'scheme'>;
};

export function isComponentDocument(document: DocumentLike): boolean {
  if (document.languageId === 'teloce') return true;
  if (document.languageId !== 'html' || document.uri.scheme !== 'file') return false;
  return isTeloceComponent(document.getText(), 'html');
}
