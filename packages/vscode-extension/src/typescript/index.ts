export {
  scanBlocks,
  findScriptBlocks,
  getTypeScriptBlock,
  isTeloceComponent,
  getAttr,
  type Block,
  type ScriptBlock,
} from './blocks.js';
export { createVirtualFile, OffsetMap, virtualNameFor, type VirtualFile, type Segment } from './virtual.js';
export {
  TeloceTsService,
  prettifyMessage,
  type TeloceTsServiceOptions,
  type MappedDiagnostic,
  type MappedHover,
  type MappedCompletion,
  type MappedLocation,
  type DiagnosticCategory,
} from './service.js';
export { TELOCE_ENV_DTS, ENV_FILE_NAME, COMPONENT_WRAPPER } from './env.js';
