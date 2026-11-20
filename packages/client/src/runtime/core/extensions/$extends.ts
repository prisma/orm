import { Client } from '../../getPrismaClient'
import { applyModelsAndClientExtensions } from '../model/applyModelsAndClientExtensions'
import { ExtensionArgs } from '../types/exported'

/**
 * @param this
 */
export function $extends(this: Client, extension: ExtensionArgs | ((client: Client) => Client)): Client {
  if (typeof extension === 'function') {
    return extension(this)
  }

  const newClient = Object.create(this._originalClient, {
    _extensions: { value: this._extensions.append(extension) },
    _appliedParent: { value: this, configurable: true },
    $on: { value: undefined },
  }) as Client

  return applyModelsAndClientExtensions(newClient)
}
