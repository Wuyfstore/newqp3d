declare module 'pg-cursor' {
  export default class Cursor<Row = unknown> {
    constructor(text: string)
    read(rowCount: number): Promise<Row[]>
    close(): Promise<void>
  }
}
