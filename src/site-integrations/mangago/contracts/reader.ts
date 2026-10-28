export interface MangagoReaderProtocol {
  key: Uint8Array<ArrayBuffer>
  iv: Uint8Array<ArrayBuffer>
  orderPositions: number[]
  columns: number
  defaultGrid: number[]
  grids: Map<string, number[]>
}
