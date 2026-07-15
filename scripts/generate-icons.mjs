import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
const sourcePath = join(root, 'src/renderer/src/assets/logo-mark.png')
const pngPath = join(buildDir, 'icon.png')
const icoPath = join(buildDir, 'icon.ico')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const OUTPUT_SIZE = 1024

async function buildFromSource() {
  return sharp(sourcePath)
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3
    })
    .png({ compressionLevel: 9, quality: 100 })
    .toBuffer()
}

async function writeIco(pngBuffer) {
  const icoBuffers = await Promise.all(
    ICO_SIZES.map((size) =>
      sharp(pngBuffer)
        .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
        .png()
        .toBuffer()
    )
  )

  await writeFile(icoPath, await pngToIco(icoBuffers))
}

async function main() {
  await mkdir(buildDir, { recursive: true })

  const png = await buildFromSource()
  await writeFile(pngPath, png)
  await writeIco(png)

  console.log('Generated from source:', pngPath)
  console.log('Generated:', icoPath)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
