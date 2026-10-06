/**
 * Ambient declarations injected into the TypeScript program as an in-memory
 * `.d.ts` file. Nothing is written to the user's disk.
 *
 * `__teloceComponent()` is what the virtual file wraps `export default {...}`
 * in. It has no runtime effect (the wrapper only exists in the virtual file);
 * its declared type is what teaches TypeScript that `this` inside `data()`,
 * `methods`, `computed`, lifecycle hooks and `watch` is the component
 * instance: props + data + computed + methods + `$` members.
 *
 * Note the `const` type parameter on props (TypeScript >= 5.0). It keeps
 * `required: true` as the literal `true` so required props are typed without
 * `| undefined`.
 */
export const ENV_FILE_NAME = '__teloce_env__.d.ts';

export const TELOCE_ENV_DTS = `
declare module '*.vel' {
  const component: any;
  export default component;
}
declare module '*.teloce' {
  const component: any;
  export default component;
}

interface __TeloceInstanceBase {
  readonly $el: HTMLElement | null;
  readonly $refs: Record<string, any>;
  readonly $props: Record<string, any>;
  readonly $data: Record<string, any>;
  readonly $slots: Record<string, any>;
  readonly $parent: any;
  readonly $root: any;
  $emit(event: string, ...args: any[]): void;
  $nextTick(callback?: () => void): Promise<void>;
  $watch(
    source: string | ((...args: any[]) => any),
    callback: (newValue: any, oldValue: any) => void,
    options?: { immediate?: boolean; deep?: boolean }
  ): () => void;
  $forceUpdate(): void;
  /** Plugins add their own \`$\` members (\`$router\`, \`$store\`, ...). */
  [key: \`$\${string}\`]: any;
}

// A \`Function as PropType<fn>\` cast keeps the exact function type; a plain
// FunctionConstructor falls through to a generic function.
type __InferCtor<C> =
  C extends { (): infer R; new (): any; readonly prototype: any }
    ? (R extends (...args: any[]) => any ? R : __InferCtorBase<C>)
    : __InferCtorBase<C>;

type __InferCtorBase<C> =
  C extends null | undefined ? any :
  C extends StringConstructor ? string :
  C extends NumberConstructor ? number :
  C extends BooleanConstructor ? boolean :
  C extends ArrayConstructor ? any[] :
  C extends ObjectConstructor ? Record<string, any> :
  C extends DateConstructor ? Date :
  C extends FunctionConstructor ? (...args: any[]) => any :
  C extends SymbolConstructor ? symbol :
  C extends BigIntConstructor ? bigint :
  C extends { new (...args: any[]): infer I } ? I :
  C extends (...args: any[]) => infer R ? R :
  any;

/** Annotate a runtime constructor with a TypeScript type: \`Object as PropType<User>\`. */
type PropType<T> = __PropConstructor<T> | __PropConstructor<T>[];
type __PropConstructor<T> =
  | { new (...args: any[]): T & {} }
  | { (): T }
  | ((...args: any[]) => T)
  | __PropMethod<T>;
/** Lets \`Function as PropType<(id: number) => void>\` type-check. */
type __PropMethod<T> = [T] extends [((...args: any[]) => any) | undefined]
  ? { new (): any; (): T; readonly prototype: any }
  : never;

type __InferType<T> = T extends readonly (infer U)[] ? __InferCtor<U> : __InferCtor<T>;

type __WithPresence<P, T> =
  P extends { required: true } ? T :
  P extends { default: any } ? T :
  [T] extends [boolean] ? T :
  T | undefined;

type __InferProp<P> =
  [P] extends [null | undefined] ? any :
  P extends { type: infer T } ? __WithPresence<P, __InferType<T>> :
  __WithPresence<P, __InferType<P>>;

type __Props<P> =
  P extends readonly string[] ? { readonly [K in P[number]]: any } :
  P extends Record<string, any> ? { readonly [K in keyof P]: __InferProp<P[K]> } :
  {};

type __ComputedOption =
  | ((...args: any[]) => any)
  | { get: (...args: any[]) => any; set?: (...args: any[]) => any };

type __ComputedValues<C> = {
  readonly [K in keyof C]:
    C[K] extends (...args: any[]) => infer R ? R :
    C[K] extends { get: (...args: any[]) => infer R } ? R :
    never;
};

type __Watcher =
  | string
  | ((newValue: any, oldValue: any) => void)
  | { handler: string | ((newValue: any, oldValue: any) => void); immediate?: boolean; deep?: boolean };

type __SetupState<S> = Awaited<S> extends object ? Awaited<S> : {};

interface __TeloceOptions<P, D, C, M, S> {
  name?: string;
  props?: P;
  data?: (this: __Props<P> & __TeloceInstanceBase) => D;
  computed?: C;
  methods?: M;
  setup?: (props: __Props<P>, context: any) => S;
  watch?: Record<string, __Watcher>;
  emits?: readonly string[] | Record<string, any>;
  components?: Record<string, any>;
  directives?: Record<string, any>;
  filters?: Record<string, (...args: any[]) => any>;
  template?: string;
  render?: (...args: any[]) => any;
  mixins?: any[];
  extends?: any;
  provide?: any;
  inject?: any;
  expose?: string[];
  inheritAttrs?: boolean;
  model?: any;
  beforeCreate?(): void;
  created?(): void;
  beforeMount?(): void;
  mounted?(): void;
  beforeUpdate?(): void;
  updated?(): void;
  beforeUnmount?(): void;
  unmounted?(): void;
  activated?(): void;
  deactivated?(): void;
  errorCaptured?(error: unknown, instance: any, info: string): boolean | void;
}

type __TeloceInstance<P, D, C, M, S> =
  __Props<P> & D & __ComputedValues<C> & M & __SetupState<S> & __TeloceInstanceBase;

declare function __teloceComponent<
  const P extends readonly string[] | Record<string, any> = {},
  D extends Record<string, any> = {},
  C extends Record<string, __ComputedOption> = {},
  M extends Record<string, (...args: any[]) => any> = {},
  S = {}
>(
  options: __TeloceOptions<P, D, C, M, S> & ThisType<__TeloceInstance<P, D, C, M, S>>
): __TeloceOptions<P, D, C, M, S>;
`;

/** Name of the wrapper function the virtual file uses. */
export const COMPONENT_WRAPPER = '__teloceComponent';
