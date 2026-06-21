import { describe, it, expect } from 'vitest'
import { imageExt, isImageUrl, findImagePaths, resolveImageSrc } from '@shared/terminal-links'

describe('imageExt', () => {
  it('returns the lowercased extension for image files', () => {
    expect(imageExt('a.PNG')).toBe('png')
    expect(imageExt('shot.jpeg')).toBe('jpeg')
  })
  it('returns null for non-images and bare names', () => {
    expect(imageExt('notes.txt')).toBeNull()
    expect(imageExt('README')).toBeNull()
  })
})

describe('isImageUrl', () => {
  it('detects image URLs ignoring query/hash', () => {
    expect(isImageUrl('https://x.io/a.png')).toBe(true)
    expect(isImageUrl('https://x.io/p/a.jpg?v=2#frag')).toBe(true)
  })
  it('is false for non-image URLs', () => {
    expect(isImageUrl('https://x.io/page')).toBe(false)
    expect(isImageUrl('https://x.io/a.html')).toBe(false)
  })
})

describe('findImagePaths', () => {
  it('finds an absolute POSIX image path with correct indices', () => {
    const line = 'saved to /home/u/out.png done'
    const m = findImagePaths(line)
    expect(m).toEqual([{ start: 9, end: 24, text: '/home/u/out.png' }])
    expect(line.slice(m[0].start, m[0].end)).toBe('/home/u/out.png')
  })
  it('finds windows, UNC, relative, dot-relative and home paths', () => {
    expect(findImagePaths('C:\\tmp\\a.png').map(m => m.text)).toEqual(['C:\\tmp\\a.png'])
    expect(findImagePaths('\\\\srv\\share\\b.jpg').map(m => m.text)).toEqual(['\\\\srv\\share\\b.jpg'])
    expect(findImagePaths('see ./out/c.gif now').map(m => m.text)).toEqual(['./out/c.gif'])
    expect(findImagePaths('img dir/d.webp').map(m => m.text)).toEqual(['dir/d.webp'])
    expect(findImagePaths('at ~/pics/e.svg').map(m => m.text)).toEqual(['~/pics/e.svg'])
  })
  it('trims surrounding quotes/parens and trailing punctuation', () => {
    expect(findImagePaths('"C:\\a b\\x.png"').map(m => m.text)).toEqual(['C:\\a b\\x.png'])
    expect(findImagePaths('(see ./a.png).').map(m => m.text)).toEqual(['./a.png'])
    expect(findImagePaths('path: /tmp/a.png, ok').map(m => m.text)).toEqual(['/tmp/a.png'])
  })
  it('ignores URLs (handled by the web-links addon) and non-images', () => {
    expect(findImagePaths('https://x.io/a.png')).toEqual([])
    expect(findImagePaths('notes.txt and a.tar.gz')).toEqual([])
  })
})

describe('resolveImageSrc', () => {
  const home = '/home/u'
  it('passes absolute paths through', () => {
    expect(resolveImageSrc('/a/b.png', '/cwd', home)).toBe('/a/b.png')
    expect(resolveImageSrc('C:\\a\\b.png', 'C:\\cwd', home)).toBe('C:\\a\\b.png')
  })
  it('expands ~ against home', () => {
    expect(resolveImageSrc('~/pics/e.svg', '/cwd', home)).toBe('/home/u/pics/e.svg')
  })
  it('joins relative paths against cwd, stripping a leading ./', () => {
    expect(resolveImageSrc('./out/c.gif', '/cwd', home)).toBe('/cwd/out/c.gif')
    expect(resolveImageSrc('dir/d.webp', 'C:\\cwd', home)).toBe('C:\\cwd\\dir/d.webp')
  })
})
