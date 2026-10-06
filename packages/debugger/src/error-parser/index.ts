/**
 * Error Parser - Translates TypeScript/runtime errors into plain English
 */

import { findSourceLocation, type SourceKind } from '../source';

export type ErrorCategory =
  | 'type_error'
  | 'reference_error'
  | 'syntax_error'
  | 'runtime_error'
  | 'undefined_error'
  | 'null_error'
  | 'property_error'
  | 'function_error'
  | 'import_error'
  | 'template_error'
  | 'binding_error'
  | 'unknown';

export interface ParsedError {
  /**
   * Original error message
   */
  original: string;

  /**
   * Error category
   */
  category: ErrorCategory;

  /**
   * Error code (if available)
   */
  code?: string;

  /**
   * File where error occurred
   */
  file?: string;

  /**
   * What kind of file it was: a `.vel` or `.html` component, etc.
   */
  sourceKind?: SourceKind;

  /**
   * Line number
   */
  line?: number;

  /**
   * Column number
   */
  column?: number;

  /**
   * Variable or function name involved
   */
  name?: string;

  /**
   * Expected type (for type errors)
   */
  expected?: string;

  /**
   * Received type (for type errors)
   */
  received?: string;

  /**
   * Available properties (for property errors)
   */
  available?: string[];

  /**
   * Context information
   */
  context?: Record<string, any>;

  /**
   * Stack trace
   */
  stack?: string;
}

export interface ErrorTranslation {
  /**
   * Human-readable title
   */
  title: string;

  /**
   * Human-readable description
   */
  description: string;

  /**
   * Suggested fix
   */
  fix?: string;

  /**
   * Example of correct code
   */
  example?: string;

  /**
   * Related documentation
   */
  docs?: string;
}

export interface Suggestion {
  /**
   * Suggestion text
   */
  text: string;

  /**
   * Priority (1-5, 5 is highest)
   */
  priority: number;

  /**
   * Code example
   */
  code?: string;

  /**
   * Whether this is a fix
   */
  isFix?: boolean;
}

/**
 * Error pattern mappings
 */
const errorPatterns: Array<{
  pattern: RegExp;
  category: ErrorCategory;
  translate: (match: RegExpMatchArray, parsed: ParsedError) => ErrorTranslation;
}> = [
  // TypeScript Type Errors
  {
    pattern: /Type '(.+)' is not assignable to type '(.+)'/,
    category: 'type_error',
    translate: (match, _parsed) => ({
      title: 'Type Mismatch',
      description: `You're using a value of type "${match[1]}" where "${match[2]}" is expected.`,
      fix: `Change the value to match type "${match[2]}"`,
      example: `// Instead of using ${match[1]}, use ${match[2]}`,
      docs: 'Check the expected type in the function or variable definition.',
    }),
  },
  // Reference Errors
  {
    pattern: /Cannot find name '(.+)'/,
    category: 'reference_error',
    translate: (match, _parsed) => ({
      title: 'Undefined Variable',
      description: `The variable "${match[1]}" is not defined.`,
      fix: `Define "${match[1]}" before using it, or check for typos.`,
      example: `// Define the variable:\nconst ${match[1]} = value;`,
      docs: 'Make sure the variable is declared or imported.',
    }),
  },
  // `x is not defined` - what browsers and Node actually throw (ReferenceError)
  {
    pattern: /^(?:Uncaught )?(?:ReferenceError: )?([A-Za-z_$][\w$.]*) is not defined/,
    category: 'reference_error',
    translate: (match, _parsed) => ({
      title: 'Undefined Variable',
      description: `"${match[1]}" is used but was never defined.`,
      fix: `Declare "${match[1]}" (in data(), props, or an import), or check the spelling. In a component, use "this.${match[1]}" for data and methods.`,
      example: `export default {\n  data() { return { ${match[1]}: null }; },\n};`,
      docs: 'Make sure the variable is declared or imported before it is used.',
    }),
  },
  // Modern wording: "Cannot read properties of undefined (reading 'x')"
  {
    pattern: /Cannot (?:read|set) propert(?:y|ies) of (?:undefined|null) \((?:reading|setting) '(.+?)'\)/,
    category: 'property_error',
    translate: (match, parsed) => {
      const empty = /of (undefined|null)/.exec(parsed.original)?.[1] ?? 'undefined';
      return {
        title: 'Property Access on Empty Value',
        description: `Tried to use property "${match[1]}" on ${empty}.`,
        fix: `Make sure the object exists before using "${match[1]}". If it comes from data(), give it an initial value; if it is loaded later, guard it with v-if or ?.`,
        example: `// Guard it:\nthis.item?.${match[1]}\n// or give data() a default:\ndata() { return { item: {} }; }`,
        docs: 'Add a null check, or make sure the data is loaded before it is read.',
      };
    },
  },
  // Property Errors
  {
    pattern: /Cannot read property '(.+)' of (undefined|null)/,
    category: 'property_error',
    translate: (match, _parsed) => ({
      title: 'Property Access on Empty Value',
      description: `Tried to read property "${match[1]}" from ${match[2]}.`,
      fix: `Make sure the object exists before accessing "${match[1]}".`,
      example: `// Check if the object exists:\nif (obj) {\n  obj.${match[1]}\n}`,
      docs: 'Add a null check or ensure the data is loaded.',
    }),
  },
  // Function Call Errors
  {
    pattern: /(.+) is not a function/,
    category: 'function_error',
    translate: (match, _parsed) => ({
      title: 'Not a Function',
      description: `"${match[1]}" is being called as a function but is not a function.`,
      fix: `Check if "${match[1]}" is defined correctly.`,
      example: `// "${match[1]}" should be a function:\n${match[1]} = () => { ... }`,
      docs: 'Make sure the value is a function before calling it.',
    }),
  },
  // Import Errors
  {
    pattern: /Cannot find module '(.+)'/,
    category: 'import_error',
    translate: (match, _parsed) => ({
      title: 'Module Not Found',
      description: `The module "${match[1]}" could not be found.`,
      fix: `Install the module: npm install ${match[1]}`,
      example: `// Check the import path:\nimport from '${match[1]}'`,
      docs: 'Make sure the module is installed and the path is correct.',
    }),
  },
  // Syntax Errors
  {
    pattern: /Unexpected token (.+)/,
    category: 'syntax_error',
    translate: (match, _parsed) => ({
      title: 'Syntax Error',
      description: `Unexpected token "${match[1]}" in your code.`,
      fix: `Check the syntax around "${match[1]}".`,
      example: `// Make sure you have matching brackets and quotes.`,
      docs: 'Check your syntax for missing brackets, quotes, or semicolons.',
    }),
  },
  // Template Errors
  {
    pattern: /Template parse error: (.+)/,
    category: 'template_error',
    translate: (match, _parsed) => ({
      title: 'Template Error',
      description: `Error in template: "${match[1]}"`,
      fix: `Check the template syntax around the error.`,
      example: `// Make sure you use correct Teloce directives:\n{{ variable }}\n<for item in items>`,
      docs: 'Check the Teloce template documentation.',
    }),
  },
  // Binding Errors
  {
    pattern: /Cannot bind to '(.+)' because it isn't a known property/,
    category: 'binding_error',
    translate: (match, _parsed) => ({
      title: 'Unknown Binding',
      description: `Cannot bind to "${match[1]}" - it's not a known property.`,
      fix: `Check the spelling of "${match[1]}" or use a different binding.`,
      example: `// Use a valid binding:\n:class="className"\n:style="styleObject"`,
      docs: 'Make sure you\'re using a valid Teloce binding.',
    }),
  },
];

/**
 * Parse an error message
 */
export function parseError(error: Error | string): ParsedError {
  const message = typeof error === 'string' ? error : error.message;
  const stack = typeof error === 'string' ? undefined : error.stack;

  // Where did it happen? Reads .vel, .html and .teloce components from stack
  // traces (Chrome/Node and Firefox/Safari) or from the message itself.
  const location = findSourceLocation(stack, message);
  const file = location?.file;
  const line = location?.line;
  const column = location?.column;
  const sourceKind = location?.kind;

  // Try to match patterns
  for (const pattern of errorPatterns) {
    const match = message.match(pattern.pattern);
    if (match) {
      const name = match[1];
      return {
        original: message,
        category: pattern.category,
        name,
        file,
        sourceKind,
        line,
        column,
        stack,
      };
    }
  }

  // Unknown error
  return {
    original: message,
    category: 'unknown',
    file,
    sourceKind,
    line,
    column,
    stack,
  };
}

/**
 * Translate an error to human-readable format
 */
export function translateError(error: Error | string): ErrorTranslation {
  const parsed = parseError(error);

  // Try to find matching translation
  for (const pattern of errorPatterns) {
    const match = parsed.original.match(pattern.pattern);
    if (match) {
      return pattern.translate(match, parsed);
    }
  }

  // Generic translation
  return {
    title: 'Something went wrong',
    description: parsed.original,
    fix: 'Check your code for errors.',
    docs: 'See the Teloce documentation for help.',
  };
}

/**
 * Get suggestions for an error
 */
export function getSuggestion(error: Error | string): Suggestion[] {
  const parsed = parseError(error);
  const suggestions: Suggestion[] = [];

  switch (parsed.category) {
    case 'type_error':
      suggestions.push({
        text: `Check the type of "${parsed.name}" and make sure it matches the expected type.`,
        priority: 5,
        isFix: true,
      });
      suggestions.push({
        text: 'Use TypeScript or JSDoc annotations for better type safety.',
        priority: 3,
      });
      break;

    case 'reference_error':
      suggestions.push({
        text: `Define "${parsed.name}" before using it.`,
        priority: 5,
        isFix: true,
        code: `const ${parsed.name} = value;`,
      });
      suggestions.push({
        text: `Check for typos in "${parsed.name}".`,
        priority: 4,
      });
      break;

    case 'property_error':
      suggestions.push({
        text: `Add a null check before accessing "${parsed.name}".`,
        priority: 5,
        isFix: true,
        code: `if (obj) {\n  obj.${parsed.name}\n}`,
      });
      suggestions.push({
        text: `Make sure the data is loaded before accessing properties.`,
        priority: 4,
      });
      break;

    case 'function_error':
      suggestions.push({
        text: `Make sure "${parsed.name}" is defined as a function.`,
        priority: 5,
        isFix: true,
        code: `const ${parsed.name} = () => { ... }`,
      });
      break;

    default:
      suggestions.push({
        text: 'Check the error message for clues.',
        priority: 3,
      });
      suggestions.push({
        text: 'Use the Teloce debugger for more information.',
        priority: 2,
      });
  }

  return suggestions;
}