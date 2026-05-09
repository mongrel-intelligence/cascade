// biome-ignore lint/suspicious/noExplicitAny: oclif flag generics do not compose safely for dynamic factories
export type AnyFlagsRecord = Record<string, any>;

export type ParsedFlags = Record<string, unknown>;
