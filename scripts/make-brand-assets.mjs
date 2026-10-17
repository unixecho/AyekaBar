// Generates the share image (public/assets/og-image.png, 1200x630) and the icon set (icon-16/32/48/192/512.png and
// public/favicon.ico) from public/assets/logo.svg + favicon.svg (the bronze coin).
//   OG_PATH=<copy of node_modules/next/dist/compiled/@vercel/og>/index.node.js node scripts/make-brand-assets.mjs
// Uses the renderer that ships inside Next (no extra dependency). Output is committed, so this only needs
// re-running when the logo changes. apple-touch-icon.png is not made here.
//
// Why OG_PATH and not a direct import: on Windows, Next's bundle builds file URLs with path.join and breaks when
// the project folder has a non-ASCII name (this one is Hebrew). Copy that folder to an ASCII path and change
// `join(import.meta.url, "../x")` to `new URL("./x", import.meta.url)` in the copy.
//
// The renderer has no fonts for SVG <text>, so the coin arrives without its lettering; the lettering is drawn on top
// as real text (positions below are the SVG's own, scaled). If the logo changes shape, these overlays change with it.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const { ImageResponse } = await import(pathToFileURL(process.env.OG_PATH).href)

const dataUri = (file) => 'data:image/svg+xml;base64,' + readFileSync(file).toString('base64')
const logo = dataUri('public/assets/logo.svg')
const favicon = dataUri('public/assets/favicon.svg')
const font = readFileSync('C:/Windows/Fonts/arialbd.ttf')
const BG = '#0a0a0f'
const fonts = [{ name: 'Arial', data: font, weight: 700, style: 'normal' }]

const h = (type, style, children, props = {}) => ({ type, props: { style, children, ...props } })
const img = (src, size) => h('img', { width: size, height: size }, undefined, { src, width: size, height: size })
// Arial's baseline sits ~0.846 of the font size below the top of a line-height:1 box
const letter = (box, baseline, fs, color, text, extra = {}) =>
  h('div', { position: 'absolute', left: 0, width: box, top: baseline - fs * 0.846, display: 'flex', justifyContent: 'center', fontSize: fs, lineHeight: 1, fontWeight: 700, color, ...extra }, text)

async function png(element, width, height, file) {
  const buf = Buffer.from(await new ImageResponse(element, { width, height, fonts }).arrayBuffer())
  writeFileSync(file, buf)
  return buf
}

// ---- icons: the coin on the dark background, with its "א"
const square = (size, pad) => {
  const inner = Math.round(size - pad * 2)
  return h('div', { width: size, height: size, background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    h('div', { position: 'relative', width: inner, height: inner, display: 'flex' }, [
      img(favicon, inner),
      letter(inner, inner * (43.5 / 64), inner * 0.53, '#6b3f18', 'א'),
    ]))
}
const made = {}
for (const size of [16, 32, 48, 192, 512]) made[size] = await png(square(size, Math.round(size * 0.06)), size, size, `public/assets/icon-${size}.png`)

// favicon.ico = three PNG images in an ICO container (every current browser reads PNG-in-ICO)
const sizes = [16, 32, 48]
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4)
let offset = 6 + 16 * sizes.length
const dirs = sizes.map((s) => {
  const d = Buffer.alloc(16)
  d[0] = s; d[1] = s; d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6)
  d.writeUInt32LE(made[s].length, 8); d.writeUInt32LE(offset, 12)
  offset += made[s].length
  return d
})
writeFileSync('public/favicon.ico', Buffer.concat([head, ...dirs, ...sizes.map((s) => made[s])]))

// ---- share image
// satori lays text out left-to-right only, so Hebrew is given reversed.
const rtl = (s) => [...s].reverse().join('')
const og = h('div', {
  width: 1200, height: 630, background: 'linear-gradient(135deg, #0a0a0f 0%, #1d1d2b 100%)', color: '#f5f3ef',
  display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial',
}, [
  h('div', { position: 'relative', width: 380, height: 380, display: 'flex' }, [
    img(logo, 380),
    letter(380, 259 * (380 / 480), 70 * (380 / 480), '#5a3410', rtl('אייכה בר')),
    letter(380, 306 * (380 / 480), 27 * (380 / 480), '#5d3a1a', 'AYEKA BAR', { letterSpacing: 5 }),
  ]),
  h('div', { display: 'flex', flexDirection: 'column', marginLeft: 64 }, [
    h('div', { fontSize: 104, fontWeight: 700, display: 'flex' }, 'Ayeka Bar'),
    h('div', { fontSize: 64, fontWeight: 700, color: '#ff8a5c', marginTop: 4, display: 'flex' }, rtl('אייכה בר')),
    h('div', { fontSize: 40, color: '#a8a5b0', marginTop: 14, display: 'flex' }, 'Harish · Israel'),
    h('div', { width: 120, height: 6, background: '#ff5e3a', borderRadius: 3, marginTop: 26, display: 'flex' }, ''),
  ]),
])
await png(og, 1200, 630, 'public/assets/og-image.png')
console.log('done')
