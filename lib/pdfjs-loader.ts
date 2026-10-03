declare global {
  interface Window {
    pdfjsLib?: any
  }
}

let pdfjsLoadingPromise: Promise<any> | null = null

export function loadPdfJs(): Promise<any> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("PDF.js cannot be loaded on the server"))
  }
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.js"
    return Promise.resolve(window.pdfjsLib)
  }
  if (pdfjsLoadingPromise) {
    return pdfjsLoadingPromise
  }

  pdfjsLoadingPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="/pdfjs/pdf.min.js"]') as HTMLScriptElement | null
    if (existing) {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.js"
        resolve(window.pdfjsLib)
        return
      }
      existing.addEventListener("load", () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.js"
          resolve(window.pdfjsLib)
        } else {
          reject(new Error("pdfjsLib not available on window after script load"))
        }
      })
      existing.addEventListener("error", (err) => {
        pdfjsLoadingPromise = null
        reject(err)
      })
      return
    }

    const script = document.createElement("script")
    script.src = "/pdfjs/pdf.min.js"
    script.async = true
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.js"
        resolve(window.pdfjsLib)
      } else {
        reject(new Error("pdfjsLib not found on window"))
      }
    }
    script.onerror = (err) => {
      pdfjsLoadingPromise = null
      reject(err)
    }
    document.head.appendChild(script)
  })

  return pdfjsLoadingPromise
}
