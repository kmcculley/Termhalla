import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto'

export interface EncryptedBlob { v: 1; salt: string; iv: string; tag: string; ct: string }

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const

function keyFrom(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, SCRYPT_PARAMS)
}

/** AES-256-GCM encrypt JSON under a passphrase-derived (scrypt) key. */
export function encryptJSON(data: unknown, passphrase: string): EncryptedBlob {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = keyFrom(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data), 'utf8')), cipher.final()])
  return {
    v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), ct: ct.toString('base64')
  }
}

/** Decrypt; throws on a wrong passphrase or tampering (GCM auth failure). */
export function decryptJSON(blob: EncryptedBlob, passphrase: string): unknown {
  const key = keyFrom(passphrase, Buffer.from(blob.salt, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
  const pt = Buffer.concat([decipher.update(Buffer.from(blob.ct, 'base64')), decipher.final()])
  return JSON.parse(pt.toString('utf8'))
}
