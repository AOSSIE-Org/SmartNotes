// Type declarations for gray-matter (no official types available)
declare module "gray-matter" {
  interface GrayMatterOption<
    I extends gray.Input,
    O extends gray.GrayMatterOption<I, O>
  > {
    excerpt?: boolean | ((input: I, options: O) => string)
    excerpt_separator?: string
    engines?: {
      [index: string]: (input: string) => object
    }
    language?: string
    delimiters?: string | [string, string]
  }

  interface GrayMatterFile<I extends gray.Input> {
    data: { [key: string]: any }
    content: string
    excerpt?: string
    orig: Buffer | I
    language: string
    matter: string
    stringify(lang: string): string
  }

  namespace gray {
    type Input = string | Buffer
    type GrayMatterOption<
      I extends Input,
      O extends GrayMatterOption<I, O>
    > = GrayMatterOption<I, O>
    type GrayMatterFile<I extends Input> = GrayMatterFile<I>

    function stringify(
      content: string | { content: string },
      data?: object,
      options?: GrayMatterOption<string, GrayMatterOption<string, any>>
    ): string

    function read(
      fp: string,
      options?: GrayMatterOption<string, GrayMatterOption<string, any>>
    ): GrayMatterFile<string>

    function test(str: string | Buffer): boolean

    const engines: {
      [key: string]: (input: string) => object
    }
  }

  function gray<I extends gray.Input, O extends gray.GrayMatterOption<I, O>>(
    input: I,
    options?: O
  ): gray.GrayMatterFile<I>

  namespace gray {}

  export = gray
}
