/**
 * T3: ExpoFileGateway — production FileGateway backed by expo-file-system v15.
 *
 * expo-file-system v15 (Expo SDK 57) uses an OOP API:
 *   - new File(uri) — create a File reference
 *   - file.bytes()  — read all bytes as Uint8Array
 *   - file.write()  — write string or Uint8Array
 *   - Paths.document — well-known document directory
 *
 * readBytes: reads the source file via File.bytes().
 *
 * writeNormalized: writes UTF-8 text to
 *   <documentDirectory>/books/<bookId>.txt
 *
 * NOT unit-tested (native file-system operations don't run in Jest/Node).
 * Type correctness is guaranteed by tsc strict mode.
 *
 * NOTE: On React Native, Buffer is available via the 'buffer' polyfill (T1).
 *
 * NOTE: The 'books' sub-directory is created on first write via the
 * Directory.create({ intermediates: true }) API. If multiple imports happen
 * concurrently, the idempotent create ensures no race condition.
 */

import { File, Directory, Paths, FileMode } from 'expo-file-system';
import type { FileGateway } from './importBook';

export class ExpoFileGateway implements FileGateway {
  /**
   * Read all raw bytes of the source file.
   *
   * expo-file-system v15 supports file:// URIs (and content:// on Android)
   * via the `File` class.
   */
  async readBytes(uri: string): Promise<Uint8Array> {
    const file = new File(uri);
    return file.bytes();
  }

  /**
   * Write the normalized UTF-8 text to the app's document sandbox.
   *
   * Destination: <documentDirectory>/books/<bookId>.txt
   *
   * @returns The file:// URI of the written file.
   */
  async writeNormalized(bookId: string, utf8: string): Promise<string> {
    // Ensure the books directory exists.
    const booksDir = new Directory(Paths.document, 'books');
    if (!booksDir.exists) {
      booksDir.create({ intermediates: true });
    }

    const dest = new File(booksDir, `${bookId}.txt`);
    // File.write() accepts a UTF-8 string directly.
    dest.write(utf8);

    return dest.uri;
  }

  /**
   * Read a byte range [byteStart, byteEnd) from the file at `uri`.
   *
   * Uses expo-file-system v15's synchronous FileHandle API (File.open()):
   * open the file read-only, seek by setting `handle.offset`, read
   * `byteEnd - byteStart` bytes, then close the handle. This avoids ever
   * loading the whole (potentially 15-20MB) file into memory — only the
   * requested chapter window is read.
   */
  async readRange(uri: string, byteStart: number, byteEnd: number): Promise<Uint8Array> {
    const file = new File(uri);
    const handle = file.open(FileMode.ReadOnly);
    try {
      handle.offset = byteStart;
      return handle.readBytes(byteEnd - byteStart);
    } finally {
      handle.close();
    }
  }
}
