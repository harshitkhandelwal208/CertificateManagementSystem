const DATABASE_NAME = "certificate-management"
const STORE_NAME = "custom-pdf-templates"
const DATABASE_VERSION = 1

interface StoredTemplate {
  key: string
  name: string
  blob: Blob
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Could not open template storage"))
  })
}

export async function saveCustomTemplate(key: string, file: File) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    transaction.objectStore(STORE_NAME).put({ key, name: file.name, blob: file } satisfies StoredTemplate)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save PDF template"))
  })
  database.close()
}

export async function getCustomTemplate(key: string): Promise<StoredTemplate | null> {
  const database = await openDatabase()
  const template = await new Promise<StoredTemplate | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve((request.result as StoredTemplate | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error("Could not read PDF template"))
  })
  database.close()
  return template
}

export async function deleteCustomTemplate(key: string) {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    transaction.objectStore(STORE_NAME).delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove PDF template"))
  })
  database.close()
}