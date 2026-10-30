export function isImageBitmapRenderingAvailable(): boolean {
  return (
    typeof createImageBitmap === "function" &&
    typeof OffscreenCanvas !== "undefined"
  )
}
