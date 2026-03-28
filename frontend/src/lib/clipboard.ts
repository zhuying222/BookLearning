export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('Failed to read image data.'))
    }

    reader.onerror = () => reject(new Error('Failed to read image data.'))
    reader.readAsDataURL(blob)
  })
}

export async function writeImageBlobToClipboard(blob: Blob): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('Current browser does not support image copy.')
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type || 'image/png']: blob,
    }),
  ])
}

export async function writeImageDataUrlToClipboard(dataUrl: string): Promise<void> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  await writeImageBlobToClipboard(blob)
}
