import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
const sourcePath = join(buildDir, 'icon-source.png')
const pngPath = join(buildDir, 'icon.png')
const floatingPath = join(buildDir, 'icon-floating.png')
const trayPath = join(buildDir, 'icon-tray.png')
const rendererFloatingPath = join(root, 'src/renderer/src/assets/icon-floating.png')
const icoPath = join(buildDir, 'icon.ico')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const OUTPUT_SIZE = 1024
/** Slight zoom into circle center; hammer/anvil stay balanced */
const CONTENT_ZOOM = 1.08

function isOrangePixel(r, g, b) {
  return r > 130 && g > 60 && b < 120 && r > b + 40
}

function isCircleBackground(r, g, b) {
  if (r + g + b < 30) return false
  if (isOrangePixel(r, g, b)) return false
  return b > 55 && b >= r
}

async function detectCircle(image) {
  const { data, info } = await image.clone().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info

  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let sumX = 0
  let sumY = 0
  let count = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]

      if (!isCircleBackground(r, g, b)) continue

      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      sumX += x
      sumY += y
      count++
    }
  }

  const cx = Math.round(sumX / count)
  const cy = Math.round(sumY / count)
  const bboxW = maxX - minX + 1
  const bboxH = maxY - minY + 1
  const diameter = Math.max(bboxW, bboxH)

  return { cx, cy, diameter, minX, minY, maxX, maxY }
}

async function buildFromSource() {
  const source = sharp(sourcePath)
  const meta = await source.metadata()
  const { cx, cy, diameter } = await detectCircle(source)

  const cropSize = Math.max(1, Math.round(diameter / CONTENT_ZOOM))
  let left = Math.round(cx - cropSize / 2)
  let top = Math.round(cy - cropSize / 2)

  const imgW = meta.width ?? OUTPUT_SIZE
  const imgH = meta.height ?? OUTPUT_SIZE

  left = Math.max(0, Math.min(left, imgW - cropSize))
  top = Math.max(0, Math.min(top, imgH - cropSize))

  const resized = await source
    .extract({ left, top, width: cropSize, height: cropSize })
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3
    })
    .sharpen({ sigma: 0.5, m1: 0.35, m2: 2.0, x1: 2, y2: 10, y3: 20 })
    .modulate({ saturation: 1.05, brightness: 1.01 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { data, info } = resized
  const out = Buffer.alloc(info.width * info.height * 4)
  const cxOut = info.width / 2
  const cyOut = info.height / 2
  const radiusSq = (info.width / 2) ** 2

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const srcI = (y * info.width + x) * 4
      const dstI = srcI
      const dx = x + 0.5 - cxOut
      const dy = y + 0.5 - cyOut
      const inside = dx * dx + dy * dy <= radiusSq

      if (inside) {
        out[dstI] = data[srcI]
        out[dstI + 1] = data[srcI + 1]
        out[dstI + 2] = data[srcI + 2]
        out[dstI + 3] = data[srcI + 3]
      } else {
        out[dstI] = 0
        out[dstI + 1] = 0
        out[dstI + 2] = 0
        out[dstI + 3] = 0
      }
    }
  }

  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 }
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

  const circle = await detectCircle(sharp(sourcePath))
  console.log('Circle detected:', circle)

  const png = await buildFromSource()
  await writeFile(pngPath, png)
  const floatingPng = await sharp(png).resize(128, 128, { kernel: sharp.kernel.lanczos3 }).png().toBuffer()
  await writeFile(floatingPath, floatingPng)
  await writeFile(rendererFloatingPath, floatingPng)
  await writeFile(
    trayPath,
    await sharp(png).resize(32, 32, { kernel: sharp.kernel.lanczos3 }).png().toBuffer()
  )
  await writeIco(png)

  console.log('Generated from source:', pngPath)
  console.log('Generated floating icon:', floatingPath)
  console.log('Generated renderer floating icon:', rendererFloatingPath)
  console.log('Generated tray icon:', trayPath)
  console.log('Generated:', icoPath)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
