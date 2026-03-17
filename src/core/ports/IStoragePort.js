/**
 * @interface IStoragePort
 * Key-value persistence abstraction.
 */
export class IStoragePort {
  /** @returns {Promise<void>} */
  async save(key, value) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<*>} stored value or null */
  async load(key) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<void>} */
  async remove(key) {
    throw new Error('Not implemented');
  }

  /** @returns {Promise<void>} */
  async clear() {
    throw new Error('Not implemented');
  }
}
