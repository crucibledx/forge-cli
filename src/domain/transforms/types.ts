export interface TransformContext {
  filename: string
  content: string
}

export interface TransformStep {
  transformer: string
  params: Record<string, string>
}

export type Transformer = (context: TransformContext, params: Record<string, string>) => TransformContext

export interface TransformerEntry {
  id: string
  apply: Transformer
}
