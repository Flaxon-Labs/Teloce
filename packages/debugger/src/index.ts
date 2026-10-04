/**
 * @teloce/debugger - Human-Friendly Debugger
 * 
 * This is the debugger for Teloce.
 * It translates cryptic JavaScript errors into plain English
 * and provides a local dashboard for debugging.
 */

import {
  parseError,
  translateError,
  getSuggestion,
} from './error-parser';
export {
  findSourceLocation,
  findLocationInMessage,
  parseStackFrames,
  getSourceKind,
  normalizeSourcePath,
  isComponentKind,
  type SourceKind,
  type SourceLocation,
} from './source';

import {
  generateSuggestions,
  getFixSuggestions,
} from './suggestions';

import {
  analyzePerformance,
  analyzeMemory,
  analyzeCompileTime,
  analyzeBundleSize,
} from './analyzer';

import {
  createDebugWebSocket,
  sendError,
  sendState,
  sendPerformance,
} from './websocket';

import {
  inspectNode,
  trackNodes,
  getNodeTree,
  findNode,
} from './inspector';

import {
  serveDashboard,
  createDashboardServer,
} from './dashboard';

// Export error parser
export {
  parseError,
  translateError,
  getSuggestion,
  type ParsedError,
  type ErrorTranslation,
  type Suggestion,
  type ErrorCategory,
} from './error-parser';

// Export suggestions engine
export {
  generateSuggestions,
  getFixSuggestions,
  type SuggestionEngine,
  type FixSuggestion,
  type SuggestionPriority,
} from './suggestions';

// Export analyzer
export {
  analyzePerformance,
  analyzeMemory,
  analyzeCompileTime,
  analyzeBundleSize,
  type PerformanceReport,
  type MemoryReport,
  type CompileTimeReport,
  type BundleReport,
  type AnalyzerOptions,
} from './analyzer';

// Export websocket
export {
  createDebugWebSocket,
  sendError,
  sendState,
  sendPerformance,
  type DebugWebSocket,
  type DebugMessage,
  type DebugMessageType,
} from './websocket';

// Export inspector
export {
  inspectNode,
  trackNodes,
  getNodeTree,
  findNode,
  type NodeTree,
  type NodeInspection,
  type NodeState,
  type InspectorOptions,
} from './inspector';

// Export dashboard
export {
  serveDashboard,
  createDashboardServer,
  type DashboardOptions,
  type DashboardData,
  type DashboardServer,
} from './dashboard';

// Default export
export default {
  parseError,
  translateError,
  getSuggestion,
  generateSuggestions,
  getFixSuggestions,
  analyzePerformance,
  analyzeMemory,
  analyzeCompileTime,
  analyzeBundleSize,
  createDebugWebSocket,
  sendError,
  sendState,
  sendPerformance,
  inspectNode,
  trackNodes,
  getNodeTree,
  findNode,
  serveDashboard,
  createDashboardServer,
};