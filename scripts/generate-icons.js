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
  const pngs = await Promise.all(
    sizes.map(s => resize(source, s).toBuffer())
  )

  // ICO header: reserved(2) + type(2) + count(2)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)

  // Directory entries: 16 bytes each
  const entries = Buffer.alloc(16 * sizes.length)
  let offset = 6 + 16 * sizes.length

  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i]
    const pos = i * 16
    entries.writeUInt8(s < 256 ? s : 0, pos)       // width (0 = 256)
    entries.writeUInt8(s < 256 ? s : 0, pos + 1)   // height
    entries.writeUInt8(0, pos + 2)                   // colors
    entries.writeUInt8(0, pos + 3)                   // reserved
    entries.writeUInt16LE(1, pos + 4)                // planes
    entries.writeUInt16LE(32, pos + 6)               // bpp
    entries.writeUInt32LE(pngs[i].length, pos + 8)   // size
    entries.writeUInt32LE(offset, pos + 12)           // offset
    offset += pngs[i].length
  }

  fs.writeFileSync(outPath, Buffer.concat([header, entries, ...pngs]))
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
