import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id parameters, from the OWASP Password Storage Cheat Sheet.
 *
 * The cost is the point. Hashing is deliberately slow and memory-hungry so that
 * an attacker who steals the database cannot test billions of guesses per second
 * on a GPU. `memoryCost` is what defeats GPU/ASIC cracking specifically —
 * a GPU has thousands of cores but not thousands of spare 19 MiB blocks.
 *
 * Argon2id is preferred over bcrypt: bcrypt silently truncates at 72 bytes and
 * is far less memory-hard.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2, // iterations
  parallelism: 1,
};

export function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Returns false rather than throwing on a malformed hash, so a corrupted record
 * behaves like a wrong password instead of a 500 that reveals it exists.
 *
 * Argon2 encodes its parameters inside the hash string, so verification uses the
 * parameters the hash was created with. Raising the cost later does not
 * invalidate existing passwords.
 */
export async function verifyPassword(storedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
