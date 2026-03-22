const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const SOURCE = process.argv[2]
if (!SOURCE) {
  console.error('Usage: node scripts/generate-icons.js <source-image.png>')
  process.exit(1)
}

const OUT = path.join(__dirname, '..', 'packages', 'desktop', 'build')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

function resize(source, size) {
  return sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ quality: 100 })
}

async function createIco(source, outPath, sizes) {
  // Use 32-bit BMP format inside ICO for best Windows transparency support
  const images = await Promise.all(
    sizes.map(async s => {
      const raw = await sharp(source)
        .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .raw()
        .ensureAlpha()
        .toBuffer()
      return { size: s, rgba: raw }
    })
  )

  const bmpEntries = images.map(({ size, rgba }) => {
    // Convert RGBA to BGRA, flip rows bottom-to-top (BMP row order)
    const pixelData = Buffer.alloc(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const src = (y * size + x) * 4
        const dst = ((size - 1 - y) * size + x) * 4
        pixelData[dst] = rgba[src + 2]       // B
        pixelData[dst + 1] = rgba[src + 1]   // G
        pixelData[dst + 2] = rgba[src]       // R
        pixelData[dst + 3] = rgba[src + 3]   // A
      }
    }

    // AND mask: 1-bit per pixel, rows padded to 4 bytes, bottom-to-top
    const maskRowBytes = Math.ceil(size / 8)
    const maskRowPadded = Math.ceil(maskRowBytes / 4) * 4
    const andMask = Buffer.alloc(maskRowPadded * size, 0)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const alpha = rgba[((size - 1 - y) * size + x) * 4 + 3]
        if (alpha === 0) {
          andMask[y * maskRowPadded + Math.floor(x / 8)] |= (1 << (7 - (x % 8)))
        }
      }
    }

    // BITMAPINFOHEADER (40 bytes)
    const bmpHeader = Buffer.alloc(40)
    bmpHeader.writeUInt32LE(40, 0)                                   // biSize
    bmpHeader.writeInt32LE(size, 4)                                  // biWidth
    bmpHeader.writeInt32LE(size * 2, 8)                              // biHeight (XOR + AND)
    bmpHeader.writeUInt16LE(1, 12)                                   // biPlanes
    bmpHeader.writeUInt16LE(32, 14)                                  // biBitCount
    bmpHeader.writeUInt32LE(0, 16)                                   // biCompression
    bmpHeader.writeUInt32LE(pixelData.length + andMask.length, 20)   // biSizeImage

    return { size, data: Buffer.concat([bmpHeader, pixelData, andMask]) }
  })

  // ICO file header
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(bmpEntries.length, 4)

  // Directory entries
  const dir = Buffer.alloc(16 * bmpEntries.length)
  let offset = 6 + 16 * bmpEntries.length

  for (let i = 0; i < bmpEntries.length; i++) {
    const s = bmpEntries[i].size
    const pos = i * 16
    dir.writeUInt8(s < 256 ? s : 0, pos)
    dir.writeUInt8(s < 256 ? s : 0, pos + 1)
    dir.writeUInt8(0, pos + 2)
    dir.writeUInt8(0, pos + 3)
    dir.writeUInt16LE(1, pos + 4)
    dir.writeUInt16LE(32, pos + 6)
    dir.writeUInt32LE(bmpEntries[i].data.length, pos + 8)
    dir.writeUInt32LE(offset, pos + 12)
    offset += bmpEntries[i].data.length
  }

  fs.writeFileSync(outPath, Buffer.concat([header, dir, ...bmpEntries.map(e => e.data)]))
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })

  // Main icon (512x512) — macOS auto-converts to ICNS on CI
  await resize(SOURCE, 1024).toFile(path.join(OUT, 'icon.png'))
  console.log('  icon.png (1024x1024)')

  // Windows ICO (multi-resolution)
  await createIco(SOURCE, path.join(OUT, 'icon.ico'), ICO_SIZES)
  console.log('  icon.ico (%s sizes)', ICO_SIZES.join(', '))

  // Linux PNGs
  const iconsDir = path.join(OUT, 'icons')
  fs.mkdirSync(iconsDir, { recursive: true })
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512]) {
    await resize(SOURCE, s).toFile(path.join(iconsDir, `${s}x${s}.png`))
  }
  console.log('  icons/ (8 sizes for Linux)')

  console.log('Done!')
}

main().catch(e => { console.error(e); process.exit(1) })
